import fs from "node:fs/promises";
import path from "node:path";

import {
  Presentation,
  PresentationFile,
  auto,
  column,
  fill,
  fixed,
  fr,
  grid,
  grow,
  hug,
  image,
  layers,
  panel,
  row,
  rule,
  shape,
  table,
  text,
  wrap,
} from "@oai/artifact-tool";

const root = process.env.OPENCORVUS_ROOT;
if (!root) {
  throw new Error("OPENCORVUS_ROOT must point to the repository root.");
}

const whitepaperDir = path.join(root, "docs", "whitepaper");
const outputDir = whitepaperDir;
const previewDir = path.join(whitepaperDir, "pptx-preview");
const layoutDir = path.join(previewDir, "layout");
const pptxPath = path.join(outputDir, "opencorvus-whitepaper.pptx");
const qaPath = path.join(previewDir, "qa-report.json");

await fs.rm(previewDir, { recursive: true, force: true });
await fs.mkdir(layoutDir, { recursive: true });

const asset = (name) => path.join(whitepaperDir, "assets", name);

const W = 1920;
const H = 1080;
const C = {
  page: "#F8F8F3",
  ink: "#171A17",
  muted: "#59615B",
  light: "#E9ECE3",
  paper: "#FFFFFF",
  accent: "#1D5F78",
  accent2: "#2F6F53",
  amber: "#8A5A12",
  red: "#9F3434",
  navy: "#15313A",
};

const style = {
  title: { fontSize: 54, bold: true, color: C.ink },
  subtitle: { fontSize: 25, color: C.muted },
  body: { fontSize: 24, color: C.ink },
  small: { fontSize: 16, color: C.muted },
  label: { fontSize: 15, bold: true, color: C.accent },
  metric: { fontSize: 62, bold: true, color: C.ink },
};

const presentation = Presentation.create({ slideSize: { width: W, height: H } });

function bg() {
  return shape({ name: "canvas", width: fill, height: fill, fill: C.page });
}

function footer(slideNo, source = "Source: docs/whitepaper/opencorvus-whitepaper.html · repository verification on 2026-05-15") {
  return row(
    { name: "footer-row", width: fill, height: hug, justify: "between", align: "center" },
    [
      text(source, { name: `source-${slideNo}`, width: fixed(1280), height: fixed(24), style: { fontSize: 14, color: "#7A827A" } }),
      text(String(slideNo).padStart(2, "0"), { name: `page-${slideNo}`, width: fixed(54), height: hug, style: { fontSize: 18, bold: true, color: "#7A827A", alignment: "right" } }),
    ],
  );
}

function titleStack(slideNo, title, subtitle) {
  const children = [
    text(title, { name: `slide-title-${slideNo}`, width: wrap(1320), height: hug, style: style.title }),
  ];
  if (subtitle) {
    children.push(text(subtitle, { name: `slide-subtitle-${slideNo}`, width: wrap(1260), height: hug, style: style.subtitle }));
  }
  return column({ name: `title-stack-${slideNo}`, width: fill, height: hug, gap: 16 }, children);
}

function bullet(name, copy, accent = C.accent) {
  return row(
    { name: `${name}-row`, width: fill, height: hug, gap: 16, align: "start" },
    [
      shape({ name: `${name}-mark`, width: fixed(10), height: fixed(10), fill: accent }),
      text(copy, { name, width: fill, height: hug, style: style.body }),
    ],
  );
}

function metric(name, value, label, note, accent = C.accent) {
  return panel(
    { name: `${name}-panel`, width: fill, height: fill, padding: { x: 24, y: 22 }, fill: C.paper },
    column(
      { name: `${name}-stack`, width: fill, height: fill, gap: 10, justify: "between" },
      [
        text(value, { name: `${name}-value`, width: fill, height: hug, style: { ...style.metric, color: accent } }),
        text(label, { name: `${name}-label`, width: fill, height: hug, style: { fontSize: 22, bold: true, color: C.ink } }),
        text(note, { name: `${name}-note`, width: fill, height: hug, style: style.small }),
      ],
    ),
  );
}

function sectionHeader(label) {
  return row(
    { name: `${label}-section`, width: fill, height: hug, gap: 14, align: "center" },
    [
      rule({ name: `${label}-rule`, width: fixed(74), stroke: C.accent, weight: 4 }),
      text(label, { name: `${label}-label`, width: fixed(260), height: hug, style: style.label }),
    ],
  );
}

function addSlide(slideNo, children, options = {}) {
  const slide = presentation.slides.add();
  slide.compose(
    layers(
      { name: `slide-${slideNo}-layers`, width: fill, height: fill },
      [
        bg(),
        column(
          { name: `slide-${slideNo}-root`, width: fill, height: fill, padding: { x: 92, y: 66 }, gap: options.gap ?? 30 },
          [...children, footer(slideNo, options.source)],
        ),
      ],
    ),
    { frame: { left: 0, top: 0, width: W, height: H }, baseUnit: 8 },
  );
}

// 1. Cover
{
  const slide = presentation.slides.add();
  slide.compose(
    layers(
      { name: "cover-layers", width: fill, height: fill },
      [
        shape({ name: "cover-bg", width: fill, height: fill, fill: C.navy }),
        shape({ name: "cover-accent-field", width: fixed(380), height: fill, fill: C.accent }),
        column(
          { name: "cover-root", width: fill, height: fill, padding: { x: 112, y: 86 }, gap: 30, justify: "between" },
          [
            row(
              { name: "cover-topline", width: fill, height: hug, justify: "between", align: "center" },
              [
                text("OpenCorvus", { name: "cover-brand", width: fixed(260), height: hug, style: { fontSize: 24, bold: true, color: "#EAF3EC" } }),
                text("Technical Whitepaper · 2026.05", { name: "cover-date", width: fixed(360), height: hug, style: { fontSize: 18, color: "#B7C9C1", alignment: "right" } }),
              ],
            ),
            column(
              { name: "cover-lockup", width: fixed(1320), height: hug, gap: 12 },
              [
                text("OpenCorvus", { name: "cover-title-en", width: fixed(760), height: fixed(88), style: { fontSize: 68, bold: true, color: "#FFFFFF" } }),
                text("技术白皮书", { name: "cover-title-cn", width: fixed(760), height: fixed(96), style: { fontSize: 64, bold: true, color: "#FFFFFF" } }),
                rule({ name: "cover-rule", width: fixed(260), stroke: "#9FC9D4", weight: 5 }),
                text("用任务事实、Goal、契约与交付判决组织长周期代码交付", {
                  name: "cover-promise",
                  width: fixed(1320),
                  height: fixed(58),
                  style: { fontSize: 29, color: "#D8E6DF" },
                }),
              ],
            ),
            row(
              { name: "cover-proof", width: fill, height: hug, gap: 28 },
              [
                text("Scope: database / frontend / backend / orchestration / deployment", { name: "cover-scope", width: fill, height: hug, style: { fontSize: 18, color: "#B7C9C1" } }),
                text("MIT License", { name: "cover-license", width: hug, height: hug, style: { fontSize: 18, color: "#B7C9C1" } }),
              ],
            ),
          ],
        ),
      ],
    ),
    { frame: { left: 0, top: 0, width: W, height: H }, baseUnit: 8 },
  );
}

addSlide(2, [
  sectionHeader("Problem Boundary"),
  titleStack(2, "问题边界：不是一次补全，而是可继续推进的代码交付任务", "模型输出只是事实链中的一类材料；需求、Goal、契约、审计和用户后续消息都必须保留。"),
  row(
    { name: "problem-body", width: fill, height: grow(1), gap: 42, align: "stretch" },
    [
      column(
        { name: "problem-copy", width: grow(0.86), height: fill, gap: 24, justify: "center" },
        [
          bullet("problem-b1", "用户请求、意图分析、需求条目、架构 Goal、Acceptance Spec、构建结果和交付判决进入同一任务上下文。"),
          bullet("problem-b2", "Orchestrator 每次唤醒时读取事实并选择工具，任务生命周期不依赖代码层硬编码状态机。", C.accent2),
          bullet("problem-b3", "用户消息是继续推进任务的真实事件；不能清空上下文，也不能要求用户重新发起任务。", C.amber),
        ],
      ),
      image({ name: "agent-comparison-image", path: asset("agent-comparison.png"), width: grow(1.14), height: fill, fit: "contain", alt: "两种 Agent 工作方式对比" }),
    ],
  ),
], { source: "Source: whitepaper section 01 and assets/agent-comparison.png" });

addSlide(3, [
  sectionHeader("Engineering Scale"),
  titleStack(3, "规模数据用于界定工程面，而不是制造排名", "OpenCorvus fork 自 sst/opencode；全仓历史与 OpenCorvus 自身路径贡献分开看。"),
  grid(
    { name: "scale-grid", width: fill, height: grow(1), columns: [fr(1), fr(1), fr(1), fr(1)], rows: [fr(1), fr(1)], columnGap: 18, rowGap: 18 },
    [
      metric("m1", "1,507", "packages/opencorvus commits", "路径相关 commit，不计 fork 前上游历史", C.accent),
      metric("m2", "196", "2026-W20 core commits", "范围含 core / overlay / channel-runtime / docs", C.accent2),
      metric("m3", "44", "SQLite tables", "集中定义于 storage/ddl.ts", C.amber),
      metric("m4", "21", "Orchestrator tools", "真实工具名来自 orchestrator/tools.ts", C.red),
      metric("m5", "9", "Agent entries", "外向 Agent 入口与核心 prompt", C.accent),
      metric("m6", "15", "Channel adapters", "覆盖 http、slack、telegram、wecom 等", C.accent2),
      metric("m7", "76", "Overlay TSX files", ".ts + .tsx 合计 177", C.amber),
      metric("m8", "3", "Executor ids", "opencorvus / codex / claude-code", C.red),
    ],
  ),
], { source: "Source: repository grep and git log verification captured in docs/whitepaper/CODEX-REWORK-PLAN.md" });

addSlide(4, [
  sectionHeader("Positioning"),
  titleStack(4, "同类定位：OpenCorvus 是编排层，不是另一个单点编码 Agent", "外部编码 Agent 负责生成和执行；OpenCorvus 负责任务事实、契约、审计和交付闭环。"),
  table({
    name: "positioning-table",
    width: fill,
    height: grow(1),
    rows: 6,
    columns: 3,
    values: [
      ["项目", "主要入口", "OpenCorvus 对照视角"],
      ["sst/opencode", "终端原生编码 Agent 与 TUI", "保留 fork 血缘，重心转向任务编排、Goal、审计与 Overlay。"],
      ["Claude Code / Codex CLI", "终端、IDE 或本地 CLI 执行器", "适合作为强执行器；产出进入任务事实链并接受后续验收。"],
      ["aider", "本地仓库 pair programming", "更偏人工协作式编辑；OpenCorvus 额外强调持久化和交付判决。"],
      ["cline", "IDE 内 autonomous coding agent", "适合 IDE 内逐步授权；OpenCorvus 控制面在 Overlay / HTTP / 通道层。"],
      ["OpenClaw 类平台", "跨应用个人自动化", "覆盖面更宽；OpenCorvus 收窄到代码仓库交付任务。"],
    ],
    styleOptions: { firstRow: true, bandedRows: true },
  }),
], { source: "Source: whitepaper section 03; public project positioning references in HTML footer" });

addSlide(5, [
  sectionHeader("Orchestration"),
  titleStack(5, "编排框架：21 个工具围绕同一任务事实集合工作", "对外 Agent、SessionKind 和工具入口是三个不同层次，不能混为一组枚举。"),
  row(
    { name: "orchestration-body", width: fill, height: grow(1), gap: 34, align: "stretch" },
    [
      column(
        { name: "orchestration-left", width: grow(0.95), height: fill, gap: 22 },
        [
          panel({ name: "tool-count", width: fill, height: hug, padding: { x: 26, y: 22 }, fill: C.paper }, row({ width: fill, height: hug, gap: 18, align: "center" }, [
            text("21", { name: "tool-count-num", width: fixed(112), height: hug, style: { fontSize: 64, bold: true, color: C.accent } }),
            text("Orchestrator tool calls, including requirements, architect, build, integrity, deliver, refine, retry_task and steer_subagent.", { name: "tool-count-copy", width: fill, height: hug, style: { fontSize: 22, color: C.ink } }),
          ])),
          bullet("orch-b1", "九个对外 Agent 入口位于 intent-analysis、requirements、design-analyst、architect、build、integrity、delivery、prosecutor、orchestrator。"),
          bullet("orch-b2", "SessionKind 有 15 项，是运行时容器分类；prosecutor 有入口文件，但没有独立 SessionKind。", C.amber),
          bullet("orch-b3", "所有工具结果、构建证据、审计结果与用户消息继续进入同一任务上下文。", C.accent2),
        ],
      ),
      image({ name: "orchestration-framework-image", path: asset("orchestration-framework.png"), width: grow(1.05), height: fill, fit: "contain", alt: "事件驱动的单题编排框架" }),
    ],
  ),
], { source: "Source: whitepaper section 04 and assets/orchestration-framework.png" });

addSlide(6, [
  sectionHeader("Goal And Contract"),
  titleStack(6, "Goal 与契约：验收不是单个打分字段", "Architect、Acceptance Spec、Contract IR 和 Integrity 共同约束构建结果。"),
  row(
    { name: "goal-body", width: fill, height: grow(1), gap: 38, align: "stretch" },
    [
      image({ name: "goal-design-image", path: asset("opencorvus-goal-design.png"), width: grow(1.18), height: fill, fit: "contain", alt: "OpenCorvus Goal 设计三段式" }),
      column(
        { name: "goal-copy", width: grow(0.82), height: fill, gap: 24, justify: "center" },
        [
          bullet("goal-b1", "Architect 至少注册两个 Goal；当前约束是运行时常量 MIN_ARCHITECT_GOAL_COUNT = 2。"),
          bullet("goal-b2", "Acceptance Spec 字段是 scorers: ScorerSchema[]，schema 层要求至少一项。", C.accent2),
          bullet("goal-b3", "Contract IR enum variant 是包含 value 和 meaning 的对象数组，不是字符串数组。", C.amber),
          bullet("goal-b4", "Integrity 独立复核需求覆盖、可行性、幻觉风险和方案质量。", C.red),
        ],
      ),
    ],
  ),
], { source: "Source: whitepaper section 05 and assets/opencorvus-goal-design.png" });

addSlide(7, [
  sectionHeader("Persistence"),
  titleStack(7, "数据库：任务事实被拆成结构、证据和事件三层", "SQLite 是任务复盘、Overlay 展示、HTTP API 和 Orchestrator 决策的共同事实源。"),
  grid(
    { name: "storage-grid", width: fill, height: grow(1), columns: [fr(1), fr(1), fr(1)], columnGap: 24 },
    [
      panel({ name: "storage-relationship", width: fill, height: fill, padding: { x: 30, y: 30 }, fill: C.paper }, column({ width: fill, height: fill, gap: 20 }, [
        text("关系层", { name: "storage-rel-title", width: fill, height: hug, style: { fontSize: 34, bold: true, color: C.accent } }),
        text("engine_task、engine_goal、engine_requirement、engine_plan_version 保存任务结构。", { name: "storage-rel-copy", width: fill, height: hug, style: style.body }),
      ])),
      panel({ name: "storage-evidence", width: fill, height: fill, padding: { x: 30, y: 30 }, fill: C.paper }, column({ width: fill, height: fill, gap: 20 }, [
        text("证据层", { name: "storage-ev-title", width: fill, height: hug, style: { fontSize: 34, bold: true, color: C.accent2 } }),
        text("engine_artifact、metric、counterexample、iteration 记录构建、验收和审计材料。", { name: "storage-ev-copy", width: fill, height: hug, style: style.body }),
      ])),
      panel({ name: "storage-event", width: fill, height: fill, padding: { x: 30, y: 30 }, fill: C.paper }, column({ width: fill, height: fill, gap: 20 }, [
        text("事件层", { name: "storage-event-title", width: fill, height: hug, style: { fontSize: 34, bold: true, color: C.amber } }),
        text("protocol_event 与 protocol_inbox 记录可重放的任务通信事实。memory_embedding 是独立表，以 chunk_id 为主键。", { name: "storage-event-copy", width: fill, height: hug, style: style.body }),
      ])),
    ],
  ),
], { source: "Source: whitepaper section 06; storage/ddl.ts contains 44 CREATE TABLE / CREATE VIRTUAL TABLE statements" });

addSlide(8, [
  sectionHeader("UI And Channels"),
  titleStack(8, "前端与通道：Overlay 展示事实，通道接入控制面", "每个入口不复制任务逻辑；它们读取和追加同一任务事实源。"),
  row(
    { name: "frontend-body", width: fill, height: grow(1), gap: 30, align: "stretch" },
    [
      column({ name: "frontend-left", width: grow(1), height: fill, gap: 18 }, [
        metric("overlay-files", "76", "Overlay .tsx components", ".ts + .tsx 合计 177；展示任务、会话、Goal、构建证据和控制消息。", C.accent),
        metric("channel-files", "15", "Channel adapters", "dingtalk、discord、feishu、googlechat、http、line、matrix、mattermost、msteams、qq、signal、slack、telegram、wecom、whatsapp。", C.accent2),
      ]),
      column({ name: "frontend-right", width: grow(1), height: fill, gap: 18, justify: "center" }, [
        bullet("front-b1", "Overlay UI 读取本地 server API 与 SSE 流，负责浏览任务、查看证据和发控制消息。"),
        bullet("front-b2", "HTTP API 提供创建任务、读取 board、追加用户消息、retry、replan、cancel 等入口。", C.amber),
        bullet("front-b3", "Channel runtime 只做 ingress / egress，不持有独立任务事实。", C.accent2),
      ]),
    ],
  ),
], { source: "Source: whitepaper section 07" });

addSlide(9, [
  sectionHeader("Runtime"),
  titleStack(9, "执行器与部署：编排层把不同执行器纳入同一验收链", "当前 executor id 为 opencorvus、codex、claude-code；内置实现文件是 executor/opencorvus.ts。"),
  grid(
    { name: "runtime-grid", width: fill, height: grow(1), columns: [fr(1), fr(1)], rows: [fr(1), fr(1)], columnGap: 22, rowGap: 22 },
    [
      panel({ name: "rt-executor", width: fill, height: fill, padding: { x: 30, y: 28 }, fill: C.paper }, column({ width: fill, height: fill, gap: 16 }, [
        text("Executor", { name: "rt-executor-title", width: fill, height: hug, style: { fontSize: 32, bold: true, color: C.accent } }),
        text("opencorvus | codex | claude-code", { name: "rt-executor-code", width: fill, height: hug, style: { fontSize: 25, color: C.ink } }),
      ])),
      panel({ name: "rt-scheduler", width: fill, height: fill, padding: { x: 30, y: 28 }, fill: C.paper }, column({ width: fill, height: fill, gap: 16 }, [
        text("Scheduler", { name: "rt-scheduler-title", width: fill, height: hug, style: { fontSize: 32, bold: true, color: C.accent2 } }),
        text("TaskQueueService 位于 scheduler/task-queue-service.ts，被 bootstrap、TUI、route 和 executor 调用。", { name: "rt-scheduler-copy", width: fill, height: hug, style: style.body }),
      ])),
      panel({ name: "rt-server", width: fill, height: fill, padding: { x: 30, y: 28 }, fill: C.paper }, column({ width: fill, height: fill, gap: 16 }, [
        text("Serve", { name: "rt-server-title", width: fill, height: hug, style: { fontSize: 32, bold: true, color: C.amber } }),
        text("本地启动形态以 opencorvus serve 为主，Overlay 通过本地 server 暴露。", { name: "rt-server-copy", width: fill, height: hug, style: style.body }),
      ])),
      panel({ name: "rt-api", width: fill, height: fill, padding: { x: 30, y: 28 }, fill: C.paper }, column({ width: fill, height: fill, gap: 16 }, [
        text("Task API", { name: "rt-api-title", width: fill, height: hug, style: { fontSize: 32, bold: true, color: C.red } }),
        text("POST /task、GET /tasks、GET /task/<task_id>/board、events、message、retry、replan、cancel。", { name: "rt-api-copy", width: fill, height: hug, style: style.body }),
      ])),
    ],
  ),
], { source: "Source: whitepaper section 08" });

addSlide(10, [
  sectionHeader("Limits And Next Work"),
  titleStack(10, "边界：项目已经形成闭环，但仍处于开源准备和早期增长阶段", "下一阶段重点是稳定性基线、长任务验证、多人协作边界和公开材料清理。"),
  row(
    { name: "limits-body", width: fill, height: grow(1), gap: 38, align: "stretch" },
    [
      column(
        { name: "limits-left", width: grow(1), height: fill, gap: 24, justify: "center" },
        [
          bullet("limit-b1", "Overlay 大规模任务列表性能需要固定 1k / 5k / 10k 任务量级基线。"),
          bullet("limit-b2", "Executor delta 流式停顿已在 W20 修复，仍需要长输出场景持续回归。", C.accent2),
          bullet("limit-b3", "Gateway operator console 已落地，后续需要明确多人协作和跨页面确认动作边界。", C.amber),
          bullet("limit-b4", "公开入口以 GitHub 仓库为准，继续清理历史域名和历史命名残留。", C.red),
        ],
      ),
      panel(
        { name: "limits-closing", width: grow(0.9), height: fill, padding: { x: 42, y: 42 }, fill: C.navy },
        column({ name: "limits-closing-stack", width: fill, height: fill, gap: 26, justify: "center" }, [
          text("合理定位", { name: "limits-closing-label", width: fill, height: hug, style: { fontSize: 22, bold: true, color: "#9FC9D4" } }),
          text("本地优先、以任务事实和验收证据为中心的代码交付编排系统。", { name: "limits-closing-copy", width: fill, height: hug, style: { fontSize: 42, bold: true, color: "#FFFFFF" } }),
        ]),
      ),
    ],
  ),
], { source: "Source: whitepaper section 09" });

const imageHydrationRequests = await Promise.all(
  presentation.getPendingImageHydrationRequests().map(async (request) => ({
    assetId: request.assetId,
    contentType: request.contentType,
    data: await fs.readFile(request.uri),
  })),
);
presentation.hydrateImageAssets(imageHydrationRequests);
const pptxBlob = await PresentationFile.exportPptx(presentation);
await pptxBlob.save(pptxPath);

const savedPptx = await fs.readFile(pptxPath);
const imported = await PresentationFile.importPptx(savedPptx);

const renderReport = [];
for (let i = 0; i < imported.slides.count; i += 1) {
  const slide = imported.slides.getItem(i);
  const page = String(i + 1).padStart(2, "0");
  const pngBlob = await imported.export({ slide, format: "png" });
  const layoutBlob = await imported.export({ slide, format: "layout" });
  const pngPath = path.join(previewDir, `slide-${page}.png`);
  const layoutPath = path.join(layoutDir, `slide-${page}.layout.json`);
  await fs.writeFile(pngPath, Buffer.from(await pngBlob.arrayBuffer()));
  const layoutJson = await layoutBlob.text();
  await fs.writeFile(layoutPath, layoutJson, "utf8");
  const layout = JSON.parse(layoutJson);
  const offCanvas = layout.elements.filter((element) => {
    const bbox = element.bbox;
    if (!Array.isArray(bbox) || bbox.length !== 4) return false;
    const [x, y, width, height] = bbox;
    return x < -1 || y < -1 || x + width > W + 1 || y + height > H + 1;
  }).map((element) => ({ name: element.name, kind: element.kind, bbox: element.bbox, text: element.textPreview ?? element.text }));
  renderReport.push({ slide: i + 1, pngPath, layoutPath, elementCount: layout.elements.length, offCanvas });
}

await fs.writeFile(qaPath, JSON.stringify({
  pptxPath,
  slideCount: imported.slides.count,
  renderedFromSavedPptx: true,
  renderReport,
}, null, 2), "utf8");

console.log(JSON.stringify({
  pptxPath,
  previewDir,
  layoutDir,
  qaPath,
  slideCount: imported.slides.count,
}, null, 2));
