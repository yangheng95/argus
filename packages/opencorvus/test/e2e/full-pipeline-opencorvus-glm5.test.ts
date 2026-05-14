await import("./full-pipeline-coding-plan-env.ts")
process.env["OPENCORVUS_E2E_EXECUTOR"] ??= "opencorvus"

await import("./full-pipeline.test.ts")
