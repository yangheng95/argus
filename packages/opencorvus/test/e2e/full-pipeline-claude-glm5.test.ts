await import("./full-pipeline-coding-plan-env.ts")
process.env["OPENCORVUS_E2E_EXECUTOR"] ??= "claude-code"

await import("./full-pipeline.test.ts")
