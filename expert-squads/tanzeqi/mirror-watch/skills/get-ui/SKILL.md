---
name: get-ui
description: Use a browser to capture a screenshot of a website from a given URL. Use this when the user wants to experience, research, or analyze a website's functionality. Generates a UI screenshot of the specified website. Optionally answers questions about the captured UI. Requires a URL as input. Outputs a link to the screenshot image and optionally an answer.
---

# Get UI of a Website

This skill enables automated capture of a website's UI given the URL. Optionally, it can answer questions about the captured UI.

Input:
- **url**: Target website URL to experience (required)
- **query**: Optional question about the captured UI (optional)

Output:
- A link to the screenshot image of the website's UI.
- If a query is provided, AI will review the screenshot to answer the question, and the answer will also be printed to the console.


# Usage

## Capture only (no question) (Low cost; Use freely.)

```bash
python3 scripts/capture_ui --url "<url>" --api-endpoint "<exact-browser-agent-base>/api/browser-agent"
```

This will print a link to the screenshot image of the specified website's UI in the console.

## Capture and ask a question using AI (Medium cost)

```bash
python3 scripts/capture_ui --url "<url>" --query "What are the headlines on this page?" --api-endpoint "<exact-browser-agent-base>/api/browser-agent"
```

This will capture the UI screenshot and output an answer to the question about the page content.
