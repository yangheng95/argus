# Benchmark

Benchmark 体系用于**端到端质量回归**。它模拟一次真实任务请求，从创建到交付全流程跑完，给出 `qualityVerdict`（accepted / rejected）作为通过判据。

## 主脚本

`packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`

Mission 模式使用独立 benchmark，因为根对象是 Mission session，不是直接创建的 task：

`packages/opencorvus/script/benchmark/mission-benchmark.ts`

## 最小运行示例

跑内置默认 case（chat-app 模板，不需 `--request-file`）：

```bash
cd packages/opencorvus

CODING_DASHSCOPE_API_KEY=sk-sp-... \
ALIBABA_CODING_PLAN_API_KEY=sk-sp-... \
DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1 \
bun run script/benchmark/overlay-web-benchmark.ts --executor=opencorvus
```

跑自定义 template：

```bash
bun run script/benchmark/overlay-web-benchmark.ts \
  --executor=opencorvus \
  "--request-file=D:/path/to/prd.txt" \
  "--title=My benchmark"
```

**注意**：flag 必须用 `=` 连接值或在下一参数位（脚本自身的 `KNOWN_FLAGS` 白名单校验，未知 flag 直接 `exit 2`）。

## Mission 模式

Mission benchmark 会调用 `POST /mission/wake`，等待 Mission 通过 `panel.create_task` 派发 Squad 任务，等待被派发任务到达终态，然后用同一个 missionID 再次 wake，要求 Mission 通过 `panel.query_task` 复核并更新 mission state。

默认流程是三段循环：

1. 简单调查 scratch project。
2. 写一个最小 TypeScript utility project。
3. 用 `bun test` 运行项目测试。

```bash
cd packages/opencorvus

CODING_DASHSCOPE_API_KEY=sk-sp-... \
ALIBABA_CODING_PLAN_API_KEY=sk-sp-... \
DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1 \
bun run script/benchmark/mission-benchmark.ts \
  "--report=.scratch/benchmark-runs/mission-report.json"
```

通过标准：mission state 四个文件有内容，至少一个 task 具有 `source=mission` 和 `metadata.mission.id`，被派发 task 终态为 completed，如有 evaluation 则必须 accepted，本地 verify 命令通过。

## 关键 flag

权威源：`overlay-web-benchmark.ts` 中的 `KNOWN_FLAGS` 集合（约 18 个，下面是常用项）。

| flag                                                                       | 说明                                                                                          |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--executor=opencorvus\|codex\|claude-code`                                | 执行器；**默认 `opencorvus`**                                                                 |
| `--request-file=PATH`                                                      | 任务描述文件（template）；不传则跑内置 case                                                   |
| `--request-attachment=PATH`                                                | 附件（图片 / 文件），不能与 `--request-file` 同时传                                           |
| `--reference-images=GLOB`                                                  | 视觉对比参考图路径（含空格请加引号）                                                          |
| `--figma-url=URL`                                                          | Figma 设计稿 URL                                                                              |
| `--title=TITLE`                                                            | 任务标题                                                                                      |
| `--report=PATH`                                                            | 输出报告 JSON                                                                                 |
| `--project-dir=PATH`                                                       | 工作仓库（默认临时目录）                                                                      |
| `--model`                                                                  | **不在 KNOWN_FLAGS**，请改用环境变量 / `cfg.model`；gateway 不读 `OPENCORVUS_BENCHMARK_MODEL` |
| `--max-runs=N`                                                             | 最大 Run 次数，默认 20                                                                        |
| `--max-fix-runs=N`                                                         | 最大回修次数，默认 8                                                                          |
| `--max-executor-groups=N`                                                  | 并行 goal/build 上限                                                                          |
| `--max-auto-resumes=N`                                                     | 失败后自动 resume 次数                                                                        |
| `--acceptance-verify-cmd=CMD`                                              | 自定义 acceptance 阶段的 verify 命令                                                          |
| `--resume-task-id=TID` / `--resume-home-dir=DIR` / `--resume-message=TEXT` | resume 模式（一般用 fresh bench，详见 [resume 注意](#resume-注意)）                           |
| `--no-keep`                                                                | 任务结束删除临时目录                                                                          |

> ~~`--stall-timeout-ms`~~ / ~~`--planning-stall-timeout-ms`~~ / ~~`--tool-timeout-ms`~~ —— 自 2026-04-30 起脚本不再接受这些 flag；现在由 engine 内部的 stream-activity 看门狗管理（180s idle abort）。运行 `bun run script/benchmark/overlay-web-benchmark.ts --help` 可查当前 flag 全集。

## Env 显式注入

Env 必须在**进程启动前**就绪。`Env.state()` 在实例创建时快照 `process.env`，`.env` 后期注入会失效。因此所有 key 都通过 `VAR=val cmd` 显式传入。

必传 env（DashScope 走 Coding Plan 时）：

- `CODING_DASHSCOPE_API_KEY`
- `ALIBABA_CODING_PLAN_API_KEY`
- `DASHSCOPE_API_URL=https://coding.dashscope.aliyuncs.com/v1`

## 通过判据

报告 JSON 中：

```json
{
  "qualityVerdict": "accepted",
  "localVerify": { "exitCode": 0 },
  "required_check_pass_rate": 1.0
}
```

判据源码：`packages/opencorvus/script/benchmark/quality-gates.ts`。

## 超时语义

所有超时都是**无活动超时**——只要 stdout / stderr / SSE 事件流还在流，就不算 stall。这样跑长 build / test 不会被机械切断，而真正挂住的任务会及时暴露。**不要**把超时理解为"从启动时刻起的总时长"。

## 严禁 headless overlay benchmark

CLAUDE.md rule 13：visual-related benchmark 必须以视觉呈现。Overlay benchmark 不接受无浏览器模式；Playwright 必须打开真实 overlay UI、执行可见性检查并产出截图。

## 二次复核（不只看 verdict）

CLAUDE.md rule 7：`qualityVerdict === "accepted"` 只是自声明。完整复核要**自己起项目** + 对比图 + 手工 verify：

```bash
# 切到 worktree
cd <worktree-from-report>
# 安装依赖、跑项目
bun install && bun run build && bun run start
# 跑指定的 acceptance-verify-cmd
```

报告里 `accepted` 不代表可发布。

## Resume 注意

`--resume-task-id` 模式下 worktreeDir 可能退化到 `process.cwd()`（packages/opencorvus），创出孤儿 `.git`。**优先用 fresh bench**，需要 resume 时确认 `--resume-home-dir` 指向原 home 而非 cwd。详见 memory `project_resume_bench_cwd_leak_2026_04_29.md`。

## 报告结构

`--report` 产出的 JSON 包含：

- 任务元信息（title、model、executor）
- 各阶段耗时（requirements / architect / build / acceptance）
- 每个 Goal 的 check 结果
- `qualityVerdict` 与 `localVerify`
- 失败样本：stderr / stdout 尾部 + 相关 artifact 路径

## 在 CI 中运行

```yaml
- name: Benchmark
  env:
    CODING_DASHSCOPE_API_KEY: ${{ secrets.DASHSCOPE_KEY }}
  run: |
    cd packages/opencorvus
    bun run script/benchmark/overlay-web-benchmark.ts \
      --executor=opencorvus \
      "--request-file=benchmarks/smoke.txt" \
      "--report=.scratch/benchmark-runs/report.json"
```

## Baseline 参考

历史 baseline 仅供对比，新架构下应自行建立基线：

- glm-5（2026-03-09，旧 evaluator 时代）：avg 90%，5/5 pass，单任务 174~254s

## E2E 评测套件

`packages/opencorvus/script/eval-e2e.ts` 是更小粒度的 eval 套件，用于日常回归。需先启动 server：

```bash
cd packages/opencorvus
DASHSCOPE_API_KEY=sk-... OPENCORVUS_CHANNEL=local \
  bun src/index.ts serve --port 7878
```

然后另开终端跑 `bun run script/eval-e2e.ts`。Server 必须带 `DASHSCOPE_API_KEY`，否则 executor 返回空响应，所有任务 <10s 失败。
