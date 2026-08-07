---
name: get-ux
description: Use browser to capture and document user experience workflows on target URL. Use when user wants to experience, research, or analyze a website's functionality. Generates screenshot flows with detailed step-by-step descriptions of the interaction journey. Input requires a URL and brief intent description. Output includes thumbnail image URL, full storyboard image URL, and comprehensive text description of the user experience.
---

# Get UX

This skill enables automated capture and documentation of website user experiences. It generates a visual storyboard with screenshots and detailed step-by-step descriptions of user interactions.

Inputs:
- **url**: Target website URL
- **intent**: Brief description of what to explore (e.g., "体验 TradingView 选股器功能")
- **name**: A short name for the captured experience (e.g., "TradingView_StockScreener_UX")

# Usage

Use the cmd to trigger the browser agent and  (IMPORTANT: This command take several minutes, set BASH timeout = 10 mins).
```bash
python3 scripts/capture_ux --url "<url>" --intent "<intent>" --name "<name>" --api-endpoint "<exact-browser-agent-task-endpoint>"
```

### 3. Output Results

The cmd will output:
1. **Text Description**: Comprehensive text description of the user experience journey
2. **Flowchart**: A flowchart of the functionality explored in vis-chart code block format
3. **Thumbnail Image URL**: URL to the thumbnail image of the captured user experience
4. **Full Image URL**: URL to the full storyboard image
