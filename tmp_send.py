import urllib.request, json, os, ssl
ctx = ssl.create_default_context()
url = "https://slack.com/api/chat.postMessage"
msg = "\u8bf7\u628a\u6211\u7684\u7535\u8111\u5206\u8fa8\u7387\u6539\u62101920x1080"
data = json.dumps({"channel": os.environ["SLACK_CHANNEL_ID"], "text": msg}).encode("utf-8")
req = urllib.request.Request(url, data=data, headers={
    "Authorization": "Bearer " + os.environ["SLACK_USER_TOKEN"],
    "Content-Type": "application/json; charset=utf-8"
})
resp = urllib.request.urlopen(req, context=ctx)
result = json.loads(resp.read())
print("OK - ts:", result.get("ts")) if result.get("ok") else print("FAIL:", result)
