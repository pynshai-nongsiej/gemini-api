import os
import sys
import time
import random
import ctypes
import subprocess
import urllib.request
import json

# --- CONFIGURATION ---
API_BASE_URL = "http://127.0.0.1:8000/v1/chat/completions"
TARGET_WORKSPACE = os.path.expanduser("~/Desktop/HumanAutomationWorkspace")
TARGET_WPM = 42  # Target typing speed (~40-45 WPM)

# Calculate inter-key delay range (seconds) based on average 5 chars/word
KEY_DELAY_MIN = 0.23
KEY_DELAY_MAX = 0.32

os.makedirs(TARGET_WORKSPACE, exist_ok=True)


def prevent_sleep():
    """Keep system awake without looking like a synthetic bot loop."""
    if sys.platform == "darwin":
        subprocess.Popen(["caffeinate", "-s", "-u", "-t", "86400"])
    elif sys.platform == "win32":
        ctypes.windll.kernel32.SetThreadExecutionState(0x80000000 | 0x00000001 | 0x00000002)


def human_type_writer(filepath, content):
    """Simulates realistic human typing directly into a file char by char."""
    with open(filepath, "w") as f:
        for char in content:
            f.write(char)
            f.flush()
            sys.stdout.write(char)
            sys.stdout.flush()

            delay = random.uniform(KEY_DELAY_MIN, KEY_DELAY_MAX)
            if char in [".", ",", "!", "?", ";"]:
                delay += random.uniform(0.3, 0.7)
            elif char == "\n":
                delay += random.uniform(0.5, 1.4)
            if random.random() < 0.03:
                time.sleep(random.uniform(0.5, 1.2))

            time.sleep(delay)
    print()


def query_gemini_api(prompt):
    """Interacts with local gemini-web2api server."""
    payload = json.dumps({
        "model": "gemini-2.5-flash",
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.7
    }).encode("utf-8")

    req = urllib.request.Request(
        API_BASE_URL,
        data=payload,
        headers={"Content-Type": "application/json"}
    )

    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"# Backup task fallback due to API error: {e}"

# --- EXTENDED WORKSPACE TASKS ---

def task_solve_competitive_programming():
    topics = ["Dynamic Programming", "Graph Theory", "Segment Trees", "Trie & Strings", "Network Flow"]
    topic = random.choice(topics)
    prompt = f"Generate a Hard Competitive Programming problem on {topic}, along with a full Python 3 solution, detailed comments, and complexity analysis."
    print(f"\n--- [TASK]: Competitive Programming ({topic}) ---")
    response = query_gemini_api(prompt)
    filepath = os.path.join(TARGET_WORKSPACE, f"cp_solution_{int(time.time())}.py")
    human_type_writer(filepath, response)


def task_build_daily_webapp():
    apps = ["Pomodoro & Habit Tracker", "Markdown Live Editor", "Audio Visualizer Canvas", "Interactive Physics Sandbox", "Kanban Task Board"]
    app_type = random.choice(apps)
    prompt = f"Create a complete, fully functional single-file HTML/CSS/JS web app for a '{app_type}'. Return valid HTML code."
    print(f"\n--- [TASK]: Daily Web Application ({app_type}) ---")
    response = query_gemini_api(prompt)
    filepath = os.path.join(TARGET_WORKSPACE, f"webapp_{int(time.time())}.html")
    human_type_writer(filepath, response)


def task_write_tech_journal():
    topics = ["System Design for Scalable APIs", "Understanding Microservices Communication", "Rust vs Go Performance Benchmarks", "Clean Code Refactoring Techniques"]
    topic = random.choice(topics)
    prompt = f"Write a detailed technical dev blog article about '{topic}'. Include code blocks and bullet points."
    print(f"\n--- [TASK]: Writing Tech Journal Entry ({topic}) ---")
    response = query_gemini_api(prompt)
    filepath = os.path.join(TARGET_WORKSPACE, f"dev_journal_{int(time.time())}.md")
    human_type_writer(filepath, response)


def task_create_unit_tests():
    prompt = "Write comprehensive PyTest unit tests for a custom LRU Cache implementation in Python, covering edge cases."
    print("\n--- [TASK]: Writing Unit Test Suite ---")
    response = query_gemini_api(prompt)
    filepath = os.path.join(TARGET_WORKSPACE, f"test_suite_{int(time.time())}.py")
    human_type_writer(filepath, response)


def task_refactor_codebase():
    prompt = "Provide an unoptimized Python snippet followed by a fully refactored, highly optimized version with detailed comments explaining the clean-code changes."
    print("\n--- [TASK]: Refactoring Codebase ---")
    response = query_gemini_api(prompt)
    filepath = os.path.join(TARGET_WORKSPACE, f"refactored_code_{int(time.time())}.py")
    human_type_writer(filepath, response)


def main_loop():
    prevent_sleep()
    print(f"Human Automation Engine active. Workspace directory: {TARGET_WORKSPACE}")
    print("Running continuous full-day activity loop. Press Ctrl+C to stop.\n")

    all_tasks = [
        task_solve_competitive_programming,
        task_solve_competitive_programming,
        task_solve_competitive_programming,
        task_build_daily_webapp,
        task_write_tech_journal,
        task_create_unit_tests,
        task_refactor_codebase
    ]

    task_count = 0
    while True:
        task_count += 1
        task = random.choice(all_tasks)
        print(f"\n==================== [SESSION TASK #{task_count}] ====================")
        task()

        # Simulates natural breaks between work sessions (3 to 8 minutes)
        break_time = random.randint(180, 480)
        print(f"\n[Rest/Coffee Break]: Reviewing code & resting eyes... ({break_time // 60}m {break_time % 60}s pause)")
        time.sleep(break_time)


if __name__ == "__main__":
    try:
        main_loop()
    except KeyboardInterrupt:
        print("\n[Automation Stopped]: Session terminated by user.")
