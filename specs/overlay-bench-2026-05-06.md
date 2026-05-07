# Overlay Benchmark 执行方案 — 2026-05-06

> 落盘以满足 rule 32（方案落盘）。

## 范围

- 场景：`packages/opencorvus/script/benchmark/assets/scientific-calculator-request.txt`（一行 brief："创建一个科学计算器"），visual 烟测。
- 驱动：单跑一次拿 `qualityVerdict`；accepted 即收，rejected/超时/崩溃才进入 fix-iterate（rule 26-29）。
- 视觉：headed Chrome — 脚本默认 `headless: false`，符合 rule 25。
- 模型：`alibaba-coding-plan-cn/kimi-k2.5`（resolveBenchmarkModel 默认）。
- 执行器：mirrorcode（脚本默认）。

## 命令

```bash
cd packages/opencorvus
bun run script/benchmark/overlay-web-benchmark.ts \
  --request-file=script/benchmark/assets/scientific-calculator-request.txt \
  --title=scientific-calculator-smoke \
  --report=script/benchmark/runs/_smoke-<ts>.json
```

`.env` 在仓根，`loadBenchmarkEnv` 自动加载 `ALIBABA_CODING_PLAN_API_KEY` / `DASHSCOPE_API_KEY`。无需手动 prefix。

## 通过判据（quality-gates.ts）

```json
{ "qualityVerdict": "accepted", "localVerify": { "exitCode": 0 }, "required_check_pass_rate": 1.0 }
```

## 异常处理路径

- 超时（stall-timeout）→ 抓 stderr 尾部 + `_emergencyReportPath`，定位最后一个 stage，按 rule 27 深查根因。
- benchmark 脚本崩溃 → 修脚本本身，rule 23（先修工具）。
- overlay UI 报错（`[overlay-pageerror]` / `[overlay-console:error]` 行）→ 修 overlay 源码，commit + push。
- 每次 fix 配单测/e2e 测试（rule 28、36）。

## 已知工作树状态（不属于本次改动）

- `packages/sdk/openapi.json` + `packages/sdk/js/src/gen/types.gen.ts` 有未提交修改（task_signals / request_text_any 字段），系上一次 schema 改动遗留。本次 benchmark 不触碰它们。

## 附录 cron

session 设 `*/10 * * * *` cron，message 含 CLAUDE.md 规则文本（禁止引用），收尾时 CronDelete。
