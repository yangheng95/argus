if (!process.env["CODING_DASHSCOPE_API_KEY"]) throw new Error("CODING_DASHSCOPE_API_KEY env var is required")
process.env["DASHSCOPE_API_URL"] ??= "https://coding.dashscope.aliyuncs.com/v1"
process.env["CODING_MODEL"] ??= "qwen3.5-plus"

process.env["ALIBABA_CODING_PLAN_API_KEY"] ??= process.env["CODING_DASHSCOPE_API_KEY"]
process.env["OPENCORVUS_CONFIG_CONTENT"] ??= JSON.stringify({
  provider: {
    "alibaba-coding-plan": {
      options: {
        baseURL: process.env["DASHSCOPE_API_URL"],
      },
    },
  },
})
process.env["OPENCORVUS_E2E_MODEL"] ??= `alibaba-coding-plan/${process.env["CODING_MODEL"]}`
