import type { Config } from "../config/config"

/**
 * 内置测试 LLM provider（固化在源码中）。
 *
 * 这些 OpenAI-compatible 网关是内部测试端点，固化进源码后，测试 / 开发
 * 环境无需在每个项目的 opencorvus.jsonc 里重复声明 `provider` 即可直接使用。
 *
 * 注入方式：`Provider.state()` 把本表拼到 config provider 之前，走与用户
 * 配置完全相同的解析路径（单一来源，见 rule 8/9）。因此：
 *   - 用户 opencorvus.jsonc 里的同名 `provider` 条目会整体覆盖此处默认值；
 *   - `disabled_providers` / `enabled_providers` 同样可禁用 / 过滤这些 provider。
 *
 * 缩写说明：
 *   - CZ   = 内部测试集群代号；网关默认开启 thinking，响应携带 reasoning_content。
 */
export const BUILTIN_TEST_PROVIDERS: Record<string, Config.Provider> = {
  glm51: {
    name: "GLM 5.1 (CZ Gateway)",
    npm: "@ai-sdk/openai-compatible",
    api: "http://117.50.195.92:8080/gpt-oss-120b/glm5.1/v1",
    env: [],
    options: {
      // 该网关要的是带 Bearer 前缀的整条头（见 curl: -H "Authorization: Bearer sk-glm51-cz-a"）。
      headers: {
        Authorization: "Bearer sk-glm51-cz-a",
      },
    },
    models: {
      glm51: {
        id: "glm51",
        name: "GLM 5.1",
        release_date: "2026-05-21",
        attachment: false,
        // 网关默认开启 thinking，响应携带 reasoning_content。
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: { input: ["text"], output: ["text"] },
        limit: { context: 202752, output: 131072 },
        options: {},
      },
    },
  },

  kimik26: {
    name: "Kimi K2.6 (CZ Gateway)",
    npm: "@ai-sdk/openai-compatible",
    api: "http://117.50.195.92:8080/gpt-oss-120b/kimik2/v1",
    env: [],
    // 该网关 curl 未带 Authorization——无需鉴权头。
    options: {},
    models: {
      kimik26: {
        id: "kimik26",
        name: "Kimi K2.6",
        release_date: "2026-05-21",
        attachment: true,
        // 网关默认开启 thinking，响应携带 reasoning_content。
        reasoning: true,
        temperature: true,
        tool_call: true,
        modalities: { input: ["text", "image"], output: ["text"] },
        limit: { context: 262144, output: 131072 },
        options: {},
      },
    },
  },
}
