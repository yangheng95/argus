process.env["OPENCORVUS_E2E_MODEL"] ??= "alibaba-cn/glm-5"
process.env["OPENCORVUS_E2E_EXECUTOR"] ??= "codex"

await import("./full-pipeline.test.ts")
