from openai import OpenAI
client = OpenAI(base_url="http://localhost:8081/v1", api_key="anything")
resp = client.chat.completions.create(
    model="gemini-3.5-flash-thinking",
    messages=[{"role": "user", "content": "define machine learning in one sentence"}]
)
print(resp.choices[0].message.content)