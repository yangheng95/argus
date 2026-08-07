---
name: s3-share
description: Save generated content as a local Markdown file, upload it with `python3 scripts/s3_upload`, and return a Mirror-compatible markdown link payload. Use when the user asks to "share", "分享", "上传s3", 打包, 上传mirror平台, or otherwise wants a markdown report uploaded and returned as an S3 link.
---

# S3 Share

Write the content to a local Markdown file in the current working directory, upload that file with `python3 scripts/s3_upload`, and respond in the exact Mirror-compatible format below.

## Workflow

1. Create a Markdown file locally in the current working directory.
2. Choose a proper filename based on the content.
3. Upload the file with `python3 scripts/s3_upload <file_path>`.
4. Reply with a short summary and the Mirror-compatible `md_json` block.

## File Creation

- Always write the content to a `.md` file before uploading.
- Use a clear, filesystem-safe filename derived from the document title or topic.
- Prefer lowercase kebab-case filenames such as `market-overview.md` or `prediction-market-PRD.md`.
- If the user did not provide a title, create a short descriptive one.

## Upload

Run this command with Python 3 after the file is written:

```bash
python3 scripts/s3_upload <file_path>
```

- Use the uploaded file URL returned by the command.
- If upload fails, report the failure plainly instead of fabricating a link or repeating the upload.

## Response Format

Respond with exactly this structure, filling in the values:

"""
Here is the markdown file about:

[summary of the file content]

 ---

 Report content see:

 ```md_json
 {
     "title": "[file title]",
     "link": "https://s3-link-to-final_report_ref.md"
 }
 ```

"""

## Notes

- Keep the summary concise.
- The `title` should match the file's document title, not necessarily the filename.
- The `link` must be the real S3 URL returned by `python3 scripts/s3_upload`.
