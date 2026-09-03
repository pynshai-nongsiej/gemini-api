#!/usr/bin/env python3
"""
arch_server.py - Arch Linux Server & API Bridge for DSC West Khasi Hills LDA Exam Prep
Designed to run on Arch Linux (and any Linux/macOS environment) with ZERO external dependencies.

Features:
- Listens on 0.0.0.0 (all network interfaces) so devices on LAN/WiFi can connect.
- Serves the upgraded wkh-dsc-lda-prep.html web interface.
- Connects to gemini-web2api (http://127.0.0.1:8081/v1) for question generation.
- Handles LLM response cleaning (strips reasoning tags <thought>...</thought>, markdown fences, repairs JSON).
- Provides server-side persistence for test progress, streaks, and question cache.
- Reverse-proxies /v1/* requests to gemini-web2api for seamless OpenAI-compatible client usage.
"""

import sys
import os
import re
import json
import time
import socket
import argparse
import urllib.request
import urllib.parse
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

VERSION = "1.2.0"

# Default configuration
DEFAULT_CONFIG = {
    "host": "0.0.0.0",
    "port": 8080,
    "gemini_url": "http://127.0.0.1:8081/v1",
    "gemini_key": "sk-gemini",
    "default_model": "gemini-3.5-flash-thinking",
    "data_dir": os.path.join(os.path.dirname(os.path.abspath(__file__)), "data"),
    "web_file": os.path.join(os.path.dirname(os.path.abspath(__file__)), "wkh-dsc-lda-prep.html"),
    "timeout_sec": 120,
}

CONFIG = dict(DEFAULT_CONFIG)


def get_local_ips():
    """Discover host IP addresses for easy network access display."""
    ips = ["127.0.0.1"]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.settimeout(0.5)
        # Connect to a dummy external IP to determine default route interface
        s.connect(("8.8.8.8", 80))
        main_ip = s.getsockname()[0]
        s.close()
        if main_ip not in ips:
            ips.append(main_ip)
    except Exception:
        pass
    return ips


def clean_json_response(raw_text: str) -> dict:
    """Clean markdown code fences, reasoning thoughts, and parse JSON questions."""
    text = raw_text.strip()

    # Strip thinking / thought tags if model outputs reasoning traces
    text = re.sub(r'<thought>[\s\S]*?</thought>', '', text, flags=re.IGNORECASE).strip()
    text = re.sub(r'<reasoning>[\s\S]*?</reasoning>', '', text, flags=re.IGNORECASE).strip()

    # Strip markdown fences ```json ... ``` or ``` ... ```
    text = re.sub(r'^```(?:json)?\s*', '', text, flags=re.IGNORECASE | re.MULTILINE)
    text = re.sub(r'```$', '', text, flags=re.MULTILINE).strip()

    # Find the JSON object boundaries
    start = text.find('{')
    end = text.rfind('}')
    if start != -1 and end != -1 and end > start:
        candidate = text[start:end+1]
        try:
            return json.loads(candidate)
        except json.JSONDecodeError:
            pass

    # Fallback: check if the model output a raw JSON array of questions
    start_arr = text.find('[')
    end_arr = text.rfind(']')
    if start_arr != -1 and end_arr != -1 and end_arr > start_arr:
        candidate = text[start_arr:end_arr+1]
        try:
            arr = json.loads(candidate)
            return {"questions": arr}
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Could not parse valid questions JSON from response. Raw preview: {text[:300]}...")


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


class ArchServerHandler(BaseHTTPRequestHandler):
    server_version = f"ArchLDA-Server/{VERSION}"

    def send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With")

    def send_json(self, data, code=200):
        body = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_cors_headers()
        self.end_headers()

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return b""
        return self.rfile.read(length)

    def _call_gemini(self, endpoint, payload=None, method="GET", timeout=None):
        """Forward request to local or remote gemini-web2api."""
        url = CONFIG["gemini_url"].rstrip("/") + endpoint
        timeout = timeout or CONFIG["timeout_sec"]
        data = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {CONFIG['gemini_key']}"
        }
        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                resp_data = resp.read()
                return json.loads(resp_data.decode("utf-8"))
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            try:
                parsed_err = json.loads(err_body)
                return {"_error": True, "code": e.code, "body": parsed_err}
            except Exception:
                return {"_error": True, "code": e.code, "body": err_body}
        except Exception as e:
            return {"_error": True, "code": 503, "message": str(e)}

    def do_HEAD(self):
        self.do_GET()

    # ------------------- GET ROUTES -------------------
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Root / HTML UI
        if path in ["/", "/index.html", "/app"]:
            self._serve_html_file()
            return

        # Status & health endpoint
        if path == "/api/status":
            self._handle_status()
            return

        # Model list endpoint
        if path == "/api/models":
            self._handle_models()
            return

        # Progress retrieval
        if path == "/api/progress":
            self._handle_get_progress()
            return

        # Cache retrieval
        if path.startswith("/api/cache"):
            self._handle_get_cache(parsed)
            return

        # Proxy /v1/* GET requests to gemini-web2api
        if path.startswith("/v1/"):
            self._proxy_gemini(path, method="GET")
            return

        # Serve static assets if file exists in workspace
        local_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.lstrip("/"))
        if os.path.isfile(local_file):
            self._serve_file(local_file)
            return

        self.send_json({"error": "Endpoint not found"}, 404)

    # ------------------- POST ROUTES -------------------
    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/generate":
            self._handle_generate()
            return

        if path == "/api/progress":
            self._handle_save_progress()
            return

        if path == "/api/cache":
            self._handle_save_cache()
            return

        if path.startswith("/v1/"):
            body = self._read_body()
            self._proxy_gemini(path, method="POST", raw_body=body)
            return

        self.send_json({"error": "Endpoint not found"}, 404)

    # ------------------- HANDLERS -------------------
    def _serve_html_file(self):
        web_path = CONFIG["web_file"]
        if not os.path.exists(web_path):
            self.send_json({"error": f"Interface file not found at {web_path}"}, 404)
            return
        try:
            with open(web_path, "rb") as f:
                content = f.read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_json({"error": f"Error loading interface: {str(e)}"}, 500)

    def _serve_file(self, filepath):
        try:
            with open(filepath, "rb") as f:
                content = f.read()
            mime = "application/octet-stream"
            if filepath.endswith(".html"):
                mime = "text/html; charset=utf-8"
            elif filepath.endswith(".css"):
                mime = "text/css; charset=utf-8"
            elif filepath.endswith(".js"):
                mime = "application/javascript; charset=utf-8"
            elif filepath.endswith(".png"):
                mime = "image/png"
            elif filepath.endswith(".json"):
                mime = "application/json"
            self.send_response(200)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(content)))
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(content)
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _handle_status(self):
        # Ping gemini_web2api
        start_t = time.time()
        gemini_status = "offline"
        gemini_models = []
        latency_ms = None

        test_resp = self._call_gemini("/models", method="GET", timeout=5)
        if isinstance(test_resp, dict) and not test_resp.get("_error"):
            gemini_status = "online"
            latency_ms = round((time.time() - start_t) * 1000, 1)
            raw_models = test_resp.get("data", [])
            gemini_models = [m.get("id") for m in raw_models if isinstance(m, dict)]

        hostname = socket.gethostname()
        local_ips = get_local_ips()

        self.send_json({
            "status": "online",
            "server": "arch_lda_server",
            "version": VERSION,
            "host": hostname,
            "port": CONFIG["port"],
            "ips": local_ips,
            "active_model": CONFIG["default_model"],
            "gemini_backend": {
                "url": CONFIG["gemini_url"],
                "status": gemini_status,
                "latency_ms": latency_ms,
                "models": gemini_models
            },
            "timestamp": int(time.time())
        })

    def _handle_models(self):
        test_resp = self._call_gemini("/models", method="GET", timeout=6)
        if isinstance(test_resp, dict) and not test_resp.get("_error"):
            self.send_json(test_resp)
        else:
            fallback_models = [
                {"id": "gemini-3.5-flash-thinking", "desc": "Fast reasoning & accurate questions"},
                {"id": "gemini-3.6-flash", "desc": "Latest Flash generation model"},
                {"id": "gemini-3.7-flash", "desc": "Next-gen Flash model"},
                {"id": "gemini-3.1-pro", "desc": "Pro quality multi-turn reasoning"},
                {"id": "gemini-flash-lite", "desc": "Lightweight ultra-fast model"}
            ]
            self.send_json({"object": "list", "data": fallback_models, "fallback": True})

    def _handle_generate(self):
        try:
            raw_data = self._read_body().decode("utf-8")
            req_data = json.loads(raw_data)
        except Exception:
            self.send_json({"error": "Invalid JSON body"}, 400)
            return

        subject_name = req_data.get("subjectName", "General Knowledge")
        topic_name = req_data.get("topicName", "General")
        count = int(req_data.get("count", 10))
        model = req_data.get("model") or CONFIG["default_model"]

        system_prompt = (
            "You are an expert question-setter for the District Selection Committee (DSC), "
            "West Khasi Hills, Meghalaya — Lower Divisional Assistant (LDA) recruitment exam. "
            "Respond ONLY with valid, raw JSON. Do not include reasoning traces, commentary, "
            "or code block ticks."
        )

        user_prompt = (
            f"Generate exactly {count} original, high-quality multiple-choice questions for the DSC West Khasi Hills LDA exam.\n"
            f"Subject: {subject_name}\n"
            f"Topic: {topic_name}\n\n"
            "Requirements:\n"
            "1. Each question must be clear, standard Meghalaya DSC LDA level.\n"
            "2. Give strong weight to Meghalaya, West Khasi Hills district (Nongstoin, Mawkyrwat, history, geography) "
            "and Northeast India context where the subject allows it.\n"
            "3. Mathematics / Reasoning: practical word problems with brief step-by-step logic in tip.\n"
            "4. Keep questions concise (under 25 words), provide 4 options (a, b, c, d), correct option key, and short tip (under 15 words).\n\n"
            "Output JSON format strictly conforming to:\n"
            "{\n"
            '  "questions": [\n'
            '    {\n'
            '      "q": "Question text here?",\n'
            '      "a": "Option A text",\n'
            '      "b": "Option B text",\n'
            '      "c": "Option C text",\n'
            '      "d": "Option D text",\n'
            '      "correct": "a",\n'
            '      "tip": "Brief factual explanation or formula"\n'
            "    }\n"
            "  ]\n"
            "}"
        )

        payload = {
            "model": model,
            "temperature": 0.3,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ]
        }

        resp = self._call_gemini("/chat/completions", payload=payload, method="POST", timeout=120)

        if isinstance(resp, dict) and resp.get("_error"):
            self.send_json({
                "error": "Failed to generate questions via Gemini backend",
                "details": resp
            }, 502)
            return

        try:
            choices = resp.get("choices", [])
            if not choices:
                raise ValueError("Empty choices returned by model")
            raw_content = choices[0].get("message", {}).get("content", "")
            parsed_questions = clean_json_response(raw_content)
            q_list = parsed_questions.get("questions", [])
            valid_qs = [
                q for q in q_list
                if q and q.get("q") and q.get("a") and q.get("b") and q.get("c") and q.get("d") and q.get("correct")
            ]
            self.send_json({"questions": valid_qs, "count": len(valid_qs), "model": model})
        except Exception as e:
            self.send_json({
                "error": f"Failed to parse LLM response as JSON: {str(e)}",
                "raw_preview": raw_content[:400] if "raw_content" in locals() else ""
            }, 500)

    def _handle_get_progress(self):
        progress_path = os.path.join(CONFIG["data_dir"], "progress.json")
        if os.path.exists(progress_path):
            try:
                with open(progress_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json(data)
                return
            except Exception:
                pass
        self.send_json({})

    def _handle_save_progress(self):
        os.makedirs(CONFIG["data_dir"], exist_ok=True)
        progress_path = os.path.join(CONFIG["data_dir"], "progress.json")
        try:
            data = json.loads(self._read_body().decode("utf-8"))
            with open(progress_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
            self.send_json({"status": "saved", "timestamp": int(time.time())})
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _handle_get_cache(self, parsed_url):
        query = urllib.parse.parse_qs(parsed_url.query)
        cache_id = query.get("id", [""])[0]
        if not cache_id:
            self.send_json({"error": "Missing cache id"}, 400)
            return

        cache_path = os.path.join(CONFIG["data_dir"], "cache", f"{cache_id}.json")
        if os.path.exists(cache_path):
            try:
                with open(cache_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                self.send_json({"cached": True, "data": data})
                return
            except Exception:
                pass
        self.send_json({"cached": False})

    def _handle_save_cache(self):
        try:
            body = json.loads(self._read_body().decode("utf-8"))
            cache_id = body.get("id")
            if not cache_id:
                self.send_json({"error": "Missing id"}, 400)
                return

            cache_dir = os.path.join(CONFIG["data_dir"], "cache")
            os.makedirs(cache_dir, exist_ok=True)
            cache_path = os.path.join(cache_dir, f"{cache_id}.json")
            with open(cache_path, "w", encoding="utf-8") as f:
                json.dump(body.get("data", {}), f, indent=2, ensure_ascii=False)
            self.send_json({"status": "cached", "id": cache_id})
        except Exception as e:
            self.send_json({"error": str(e)}, 500)

    def _proxy_gemini(self, path, method="GET", raw_body=None):
        """Transparent reverse proxy to gemini-web2api for /v1/* requests."""
        url = CONFIG["gemini_url"].rstrip("/") + path.replace("/v1", "", 1)
        headers = {
            "Content-Type": self.headers.get("Content-Type", "application/json"),
            "Authorization": self.headers.get("Authorization", f"Bearer {CONFIG['gemini_key']}")
        }
        req = urllib.request.Request(url, data=raw_body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=CONFIG["timeout_sec"]) as resp:
                resp_data = resp.read()
                self.send_response(resp.status)
                for k, v in resp.headers.items():
                    if k.lower() not in ["content-length", "transfer-encoding", "connection"]:
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(resp_data)))
                self.send_cors_headers()
                self.end_headers()
                self.wfile.write(resp_data)
        except urllib.error.HTTPError as e:
            err_data = e.read()
            self.send_response(e.code)
            self.send_cors_headers()
            self.end_headers()
            self.wfile.write(err_data)
        except Exception as e:
            self.send_json({"error": f"Proxy error: {str(e)}"}, 502)

    def log_message(self, format, *args):
        sys.stderr.write(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {self.address_string()} - {format % args}\n")


def main():
    parser = argparse.ArgumentParser(
        description="Arch Linux HTTP Server & API Bridge for DSC West Khasi Hills LDA Prep"
    )
    parser.add_argument("--host", default=DEFAULT_CONFIG["host"], help="Interface to bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=DEFAULT_CONFIG["port"], help="Port to listen on (default: 8080)")
    parser.add_argument("--gemini-url", default=DEFAULT_CONFIG["gemini_url"], help="Gemini Web2API base URL (default: http://127.0.0.1:8081/v1)")
    parser.add_argument("--gemini-key", default=DEFAULT_CONFIG["gemini_key"], help="API Key for Gemini Web2API (default: sk-gemini)")
    parser.add_argument("--model", default=DEFAULT_CONFIG["default_model"], help="Default Gemini Model (default: gemini-3.5-flash-thinking)")
    parser.add_argument("--data-dir", default=DEFAULT_CONFIG["data_dir"], help="Directory for saved progress and caches")
    args = parser.parse_args()

    CONFIG["host"] = args.host
    CONFIG["port"] = args.port
    CONFIG["gemini_url"] = args.gemini_url
    CONFIG["gemini_key"] = args.gemini_key
    CONFIG["default_model"] = args.model
    CONFIG["data_dir"] = os.path.abspath(args.data_dir)

    os.makedirs(CONFIG["data_dir"], exist_ok=True)

    server = ThreadedHTTPServer((CONFIG["host"], CONFIG["port"]), ArchServerHandler)

    ips = get_local_ips()
    print("=" * 68)
    print(f"  🏛️  DSC West Khasi Hills — LDA Mission Log Server v{VERSION}")
    print(f"  🐧 Arch Linux Service Listener Ready")
    print("=" * 68)
    print(f"  Local Access:      http://localhost:{CONFIG['port']}")
    for ip in ips:
        if ip != "127.0.0.1":
            print(f"  Network / LAN:     http://{ip}:{CONFIG['port']}")
    print(f"  Gemini Backend:    {CONFIG['gemini_url']}")
    print(f"  Default Model:     {CONFIG['default_model']}")
    print(f"  Data Directory:    {CONFIG['data_dir']}")
    print("=" * 68)
    print("  Press Ctrl+C to stop the server.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server gracefully...")
        server.server_close()


if __name__ == "__main__":
    main()
