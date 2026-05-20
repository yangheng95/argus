# 二次复审 v4（只读，rule 24）— 仅确认 r3 #5 口径项闭合

你 r3 结论：核心 1–4 全 PASS（provider 阻塞已闭合 / src 单一来源闭合 / 测试7闭合 / provider 路由无回归）。唯一未过是 #5：**口径** —— `script/cache-probe/trace-aisdk-wire.ts` 仍 raw `import { streamText } from "ai"`，与“全仓仅 llm/api.ts”字面口径冲突；你给的二选一是“明确豁免该诊断脚本，或改走 wrapper”。

本轮**不重审 1–4**（你已 PASS）。只确认本轮对 #5 的处置是否充分闭合（**只读，不改文件、不 git**）：

事实依据：`script/cache-probe/trace-aisdk-wire.ts` 顶部 JSDoc 自述用途是“capture the exact JSON body @ai-sdk/openai-compatible sends when streamText hits the hexin gateway” —— 它存在的目的就是观测**未包装**的原始 SDK wire 行为；走 wrapper 会注入 repair/abortable/timeout，破坏探针目的。故选择“明确豁免”而非“改走 wrapper”。

本轮处置（3 处措辞精确化 + 明确豁免，rule 35 末条不静默）：
1. `packages/opencorvus/src/llm/api.ts` 注释：把 “EVERY streamText caller” 改为 “every PRODUCTION streamText caller (src/)”，并显式写明 `script/cache-probe/`（trace-aisdk-wire.ts）有意 raw SDK、不在范围。
2. `packages/opencorvus/test/session/repair-hint.test.ts` 单一来源锁注释：写明扫描范围是 `src/` 生产，`script/cache-probe/` 诊断脚本有意 raw SDK、不扫描；测试 `srcDir` 本就只指向 `../../src`。
3. `specs/new-arch/2026-05-19-...md` §6.3：补一段，落点是 `@/llm/api` wrapper 覆盖 src/ 生产所有 streamText；明确豁免 `script/cache-probe/` 诊断脚本（rule 35 末条不静默），src/** 由回归测试结构锁死。

验收事实：`bun test test/session/repair-hint.test.ts` 13/13 pass；先前全量 typecheck exit 0（本轮仅注释/spec 文本变更，无逻辑改动）。

## 只回答两点（file:line 证据，明确结论）
A. **#5 是否闭合**：把 `trace-aisdk-wire.ts` 作为非生产诊断脚本明确豁免（而非改走 wrapper），理由（探针需观测未包装 wire）是否成立、是否符合 rule 5（不过度）/rule 1（看本质）？3 处措辞精确化是否使“单一来源”声明与事实一致、无 rule 35 静默问题？
B. **是否引入任何新问题**：本轮纯注释/spec 文本变更，是否确无逻辑/测试/类型影响？是否还有**其它** src/ 生产路径绕过 wrapper（除已豁免的 script/ 诊断脚本与 wrapper 自身）？

## 输出
A、B 结论 + 证据；最后明确 **PASS** 或 **不通过（列阻塞项）**。
