# Mirror — URL/Image → Code 算法移植；Figma 产品入口走 MCP

> 从 `opencode-private/packages/mirror` 抽取的确定性算法（零 LLM 的部分），作为 opencorvus 内部模块。
> **本阶段只做 isolated integration**：算法 + 单测落地，不注册工具、不动 orchestrator/agent。

---

## 核心原则

1. **工具组件 + skill 组合，不是 e2e 算法**：每个模块暴露一个原子算法函数（Zod 严格约束输入输出），模块之间**不互相调用**、**不共享 ctx**、**不做 stage 传参**。像 `url-to-code.ts` 这种"把阶段串起来的 composite service"在本仓库里**不存在**——组合工作由 skill markdown + orchestrator 完成，不由代码固化。Figma 产品入口不再使用 mirror/REST，统一由 frontend_design 通过 Figma MCP materialize。
2. **算法移植，基建复用**：mirror 只带算法本体，LLM / 事件 / 配置 / Worktree / Puppeteer 全部接 opencorvus 现有设施。
3. **隔离落地**：`src/mirror/` 独立模块树。不动 `tool/registry.ts`、`agent/agent.ts`、`config.ts`、`permission/defaults.ts`、`prompt-catalog`。
4. **Zod 在边界**：每个 export 的算法函数必须有 Zod 输入/输出 schema；内部辅助用 TS 类型。
5. **纯函数优先**：每个算法入口 standalone 可调用；`ctx?.emit` 回调可选，不强制依赖 `EngineProtocol`。
6. **无 fallback**：遵循 `CLAUDE.md` 规则 1。所有失败抛 typed error，由上游决策。

### 反模式清单（不得出现在 src/mirror/）

- ❌ `runPipeline()` / `figmaToCode()` / `urlToCode()` — 串起多个阶段的 composite 函数
- ❌ `MirrorCtx` 里携带"当前阶段"、"上一步输出"的隐式状态
- ❌ 一个模块 `import` 另一个平行模块（`figma/compile.ts` 绝不 import `figma/fetch-tree.ts`）
- ❌ 模块之间通过文件系统 / 全局变量 / 上下文对象传递中间产物
- ❌ 任何"我这一步完成了就自动触发下一步"的暗线

### 正例

每个模块的公开 API 形如：

```ts
// figma/fetch-tree.ts
export const FetchInput = z.object({ figmaUrl: z.string(), nodeId: z.string().optional() })
export const FetchOutput = CompressedDesignSchema
export async function fetchFigmaTree(input: z.infer<typeof FetchInput>): Promise<z.infer<typeof FetchOutput>> { ... }

// figma/compile.ts — 不 import fetch-tree，只消费 CompressedDesign IR
export const CompileInput = CompressedDesignSchema
export const CompileOutput = XmlIRSchema
export async function compileDesignToXML(input: z.infer<typeof CompileInput>): Promise<z.infer<typeof CompileOutput>> { ... }
```

历史 Figma mirror/REST 序列已下线；不要新增 `figma_extract` / `figma_compile` / `figma_analyze` 工具或 skill。Figma 参考由 frontend_design 调 Figma MCP 获取截图和文本证据后交给 frontend template 合成。

```markdown
---
name: webpage-generate
---
调用顺序：
1. `webpage_extract` → 拿 ExtractedPage
2. `webpage_compile` → 拿 XML IR
3. `webpage_analyze` → 拿 scaffold/shared-context
4. frontend template 合成；build agent 不直接调用 mirror extraction
```

---

## 模块布局

```
src/mirror/
├── README.md                      # 本文档
├── index.ts                       # barrel（零副作用）
├── types.ts                       # 顶层 Zod schema
├── errors.ts                      # NamedError 派生错误
├── ir/                            # 跨阶段 IR（Zod）
│   ├── compressed-design.ts       # Figma 压缩树
│   ├── extracted-page.ts          # URL DOM+CSS 快照
│   ├── xml-ir.ts                  # XML IR 字符串
│   └── scaffold.ts                # PlanFile / contracts / tiers
├── shared/                        # opencorvus 缺失的零依赖工具
│   ├── extract-xml.ts             # htmlparser2 SAX 标签提取 + 截断容错
│   ├── similarity.ts              # Bigram Dice + 自适应阈值
│   ├── tier-graph.ts              # Kahn 拓扑；contracts.imports 是唯一依赖来源
│   ├── xml-escape.ts
│   ├── token-estimator.ts         # CJK/ASCII 启发式 Token 估算（pattern/* 会用）
│   ├── image-constrain.ts         # Bedrock 8000px 约束
│   ├── design-language.ts         # 设计 token 提取
│   └── content-compare.ts         # 文本/结构对比
├── figma/                         # 原子工具，彼此零调用
│   ├── fetch-tree.ts              # fetchFigmaTree(input) → CompressedDesign
│   ├── cache.ts                   # readCache / writeCache — 独立工具，非 fetch-tree 的隐式后端
│   ├── graph-analyze.ts           # compressDesignTree(design) → CompressedDesign（更小）
│   └── compile.ts                 # compileDesignToXML(design) → XmlIR
├── url/                           # 原子工具，彼此零调用
│   ├── extract.ts                 # extractPage(url, opts) → ExtractedPage
│   ├── compile.ts                 # compilePageToXML(page) → XmlIR
│   └── pattern/
│       ├── index.ts               # analyzePage(page) → Scaffold  ← 唯一对外导出
│       ├── detect.ts              # 内部辅助
│       ├── fingerprint.ts         # 内部辅助
│       ├── tokens.ts              # 内部辅助
│       ├── contract.ts            # 内部辅助
│       └── scaffold.ts            # 内部辅助
├── visual/                        # 原子工具，彼此零调用
│   ├── render.ts                  # renderFiles({ url, ... }) → Screenshot
│   └── evaluate.ts                # evaluateVisual(design, render) → VisualScore
└── (no __tests__ here; tests live at packages/opencorvus/test/mirror/)
```

Tests live at `packages/opencorvus/test/mirror/{shared,figma,url,visual,fixtures}/*.test.ts`
following the existing opencorvus convention (see `test/emitter.test.ts`, `test/util/`).

### 依赖方向约束

```
shared          ← figma, url, visual, ir
ir              ← figma, url, visual
figma ⊥ url ⊥ visual            （互不依赖）

mirror/* 禁止依赖:
  src/tool, src/agent, src/orchestrator, src/session

mirror/* 允许依赖:
  src/util, src/llm, src/engine/protocol, src/worktree,
  src/frontend-design/url-screenshot,
  src/delivery/checks/visual (findBrowserExecutable)
```

---

## Mirror → opencorvus 映射表

| Mirror 源 | 目标位置 | 说明 |
|---|---|---|
| `infra/parser/extract.ts` | `shared/extract-xml.ts` | 直接移植 |
| `infra/utils/similarity.ts` | `shared/similarity.ts` | 直接移植 |
| `infra/utils/tier-graph.ts` | `shared/tier-graph.ts` | 直接移植 |
| `infra/utils/xml-escape.ts` | `shared/xml-escape.ts` | 直接移植 |
| `infra/utils/text.ts` | 内联到调用点 | 删除 |
| `infra/utils/path.ts` | 用 `util/filesystem.ts` | 删除 |
| `infra/llm/token-estimator.ts` | `shared/token-estimator.ts` | 纯算法移植（非 LLM wrapper） |
| `infra/llm/client.ts` | `src/llm/api.ts` | 弃（用 AI SDK） |
| `infra/llm/budget.ts` | 弃 | AI SDK 内建 |
| `infra/llm/models.ts` | 弃 | 用 opencorvus provider |
| `infra/progress.ts` | `engine/protocol.ts` + `ctx?.emit` | 弃 |
| `infra/image-constrain.ts` | `shared/image-constrain.ts` | 直接移植 |
| `infra/design-language-extract.ts` | `shared/design-language.ts` | 直接移植 |
| `infra/content-compare.ts` | `shared/content-compare.ts` | 直接移植 |
| `infra/compile/ir-utils.ts` | 并入 `figma/compile.ts` | 折叠 |
| `infra/figma-cache.ts` | `figma/cache.ts` | 独立工具，路径改 worktree；不被 fetch-tree 隐式调用 |
| `infra/figma/extract-core.ts` | `figma/fetch-tree.ts` | isolated algorithm only；产品入口禁用 REST，走 Figma MCP |
| `service/figma-extract.ts` | **删除**（是 mirror 的 stage 壳，不是算法） | — |
| `service/figma-graph-analyze.ts` | `figma/graph-analyze.ts` | 单一函数 `compressDesignTree(design) → compressed` |
| `service/figma-compile.ts` | `figma/compile.ts` | 单一函数 `compileDesignToXML(design) → xmlIR` |
| `service/figma-to-code.ts` | **不移植**（是 e2e 管线） | — |
| `infra/browser/url-extract-core.ts` | `url/extract.ts` | 单一函数 `extractPage(url, opts) → page`；mirror 本就是 puppeteer-core |
| `service/url-extract.ts` | **删除**（是 stage 壳） | — |
| `service/url-compile.ts` | `url/compile.ts` | 单一函数 `compilePageToXML(page) → xmlIR` |
| `service/url-to-code.ts` | **不移植**（是 e2e 管线） | — |
| `infra/pattern/*` | `url/pattern/*` | 保留目录组织；顶层单一函数 `analyzePage(page) → scaffold` |
| `service/render.ts` | `visual/render.ts` | 单一函数 `renderFiles({ url, ... }) → screenshot` |
| `service/evaluate.ts` | `visual/evaluate.ts` | 单一函数 `evaluateVisual(design, render) → score` |
| `service/visual-refine-loop.ts` | **不移植**（是 e2e loop） | — |
| `prompt/*` | 不移植 | skill markdown 承载 |

---

## 跨模块契约

### `ir/compressed-design.ts`（Figma）
`CompressedDesignSchema` — `fileKey`、`rootNode`、`componentMap`、`tokens`、`assets`、`stats`、`comments`

### `ir/extracted-page.ts`（URL）
`ExtractedPageSchema` — `url`、`viewport`、`root`、`tokens`、`cssCustomProps`、`assets`、`screenshot?`

### `ir/xml-ir.ts`
`XmlIRSchema` — `source: "figma"|"url"`、`xml: string`、`bytes`、`sectionIndex`

### `ir/scaffold.ts`
`ScaffoldSchema` — `plan: PlanFile[]`、`tiers`、`prebuilt`、`sharedContext`

---

## 事件协议（Phase 2 接线）

所有算法函数签名统一：

```ts
interface MirrorCtx {
  worktree?: string
  signal?: AbortSignal
  emit?: (event: MirrorEvent) => void
}
```

Phase 1 所有测试用 `emit: undefined`。Phase 2 才在 `engine/model.ts` 新增：
`mirror.phase.started` / `mirror.phase.progress` / `mirror.phase.completed` / `mirror.phase.failed`

---

## 外部依赖新增

```jsonc
{
  "dependencies": {
    "htmlparser2": "^10.1.0",
    "pixelmatch": "^6.0.0",
    "pngjs": "^7.0.0",
    "ssim.js": "^3.5.0"
  },
  "devDependencies": {
    "@types/pngjs": "^6.0.0"
  }
}
```

Bun 1.3.13 实测验证：`PNG.sync.read/write`、`pixelmatch`、`ssim.default` 全部可直接用。

---

## 阶段化落地

| 阶段 | 内容 | 人日 | 验收门 |
|---|---|---|---|
| **A. shared utilities** | `shared/*` 8 个文件 + 单测 | 4 | `bun test src/mirror/shared/**` 100% 通过；零网络/磁盘 side effect |
| **B. IR schemas** | `types.ts` + `ir/*` Zod + fixture 校验 | 1.5 | 3 份 fixture JSON 解析通过 |
| **C. visual QA** | `visual/render.ts` + `visual/evaluate.ts` | 1.5 | 固定双 PNG 分数误差 ±0.5 |
| **D. figma 链路** | isolated legacy algorithms only；不注册工具、不进 frontend_design 产品路径 | 4.5 | 单元测试可保留，产品验收以 Figma MCP 为准 |
| **E. url 链路 - extract** | `url/extract.ts` | 1.5 | 离线 fixture + 真实 puppeteer，ExtractedPage 通过 schema 校验 |
| **F. url 链路 - compile + pattern** | `url/compile.ts` + `url/pattern/*` | 3 | fixture 驱动，输出与 mirror 字节级一致 |
| **G. 冒烟脚本 + 文档** | `script/mirror-smoke.ts` | 1 | 本地一把跑通三条链路 |
| **总计** | | **17 人日** | |

---

## 已验证风险（三项 subagent 实测）

| 原假设 | 验证结论 |
|---|---|
| Playwright → puppeteer-core 迁移可能需改写 | **mirror 代码已是 puppeteer-core**，17 API 触点全 1:1 等价 |
| `pattern/*` 可能隐性依赖 LLM / service | **零 LLM**；唯一跨目录 import（`compileElement`）随 `url-compile` 自然消解；`token-estimator` 纯算法需同步搬 |
| pngjs Bun 下 zlib `writeSync` 崩溃 | **Bun 1.3.13 实测通过**，`PNG.sync.read/write` round-trip OK |

---

## 剩余真实风险

1. `infra/pattern/*` 算法密度高（~1800 行），需金标对比验证
2. Figma REST mirror 算法仍是 isolated legacy；不要把 token/cache 重新接入产品入口
3. 进度事件触点多（Phase 2 兑现）
4. Bun TLA 静态 import 纪律（参照 `engine/persist.ts` 教训）

---

## 质量门

1. `bun run typecheck` 全绿
2. `bun test test/mirror/**` 100% 通过
3. 确定性回归：每个移植的纯函数必须有 `test/mirror/**` 覆盖同输入同输出、schema 边界和关键路径。URL scaffold 已经脱离原 mirror 的 `packages/app/src` 路径假设，不能再对这部分做逐字节 golden parity；应验证 OpenCorvus 的 source-layout contract。
4. `script/mirror-smoke.ts` 本地跑通 figma/url/visual 三条链路
5. `grep -r "Tool.define\|tool/registry" src/mirror/` 无命中
6. `grep -r "from '@/tool" src/mirror/` 无命中
7. `src/mirror/` 无循环依赖

### 移植纪律

- 不要先写 unit test，再写实现——单测会在你同样错的地方"成功"
- 先证明确定性和 schema 边界，再补 edge case unit test
- 如果原 mirror 与 OpenCorvus 的 source-layout contract 冲突，以本 README 和 `specs/new-arch/2026-05-08-mirror-emitter-promotion.md` 为准
- pattern/* 的类型（`ProjectScaffold` 等）在 mirror 的 `types.ts` 里是 **broken import**（mirror tsc 走 skipLibCheck），本项目不照搬这个破绽——在 Phase F 根据实现反推真实 shape

---

## Phase 2 预告（不在本次范围）

完成 isolated integration 后，phase 2 接线约 5 人日：
- 每个 URL/Image 原子算法包一层 `Tool.define`（薄壳，只做 Zod validate + 调用 + `EngineProtocol.emit` 事件），例：`url_extract` / `url_compile` / `url_analyze` / `visual_render` / `visual_evaluate`
- `tool/registry.ts` 注册
- `permission/defaults.ts` 新增 deny（出站请求：Figma API / 任意 URL 抓取）
- `agent/agent.ts` build agent allow list
- **skill markdown** 承载组合逻辑：`src/skill/builtin/url-to-code.md` — skill 用自然语言描述调用顺序、中间产物如何交给 frontend_design、何时做 visual 验收。skill 是唯一把原子工具串成流程的位置。Figma 不再有 mirror skill。

前提：phase 1 的 `script/mirror-smoke.ts` 稳定 pass 两周以上。
