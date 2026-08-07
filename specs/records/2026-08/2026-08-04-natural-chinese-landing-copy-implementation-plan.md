# Natural Chinese landing-page copy implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Sub-Agent execution is unavailable under the current collaboration constraint.

**Goal:** Replace translated-sounding Simplified Chinese landing-page copy with the approved product-led, natural, and restrained Chinese voice while preserving product truth and the existing page architecture.

**Architecture:** `packages/web/src/content/landing.ts` remains the only localized content owner. The implementation changes only `landingContent["zh-cn"]` values; the schema, English locale, Astro composition, links, media, and interaction code stay unchanged. Static checks establish source integrity, while the running real desktop page and manually inspected screenshots establish copy rhythm and visual fit.

**Tech Stack:** TypeScript content model, Astro 5/Starlight, Node-launched local development server, visible Microsoft Edge, Bun static and documentation-contract checks.

## Global constraints

- Preserve the approved information architecture, English copy, real media, links, and product claims.
- Write Chinese-first outcome language: direct modern Chinese, short subject–verb sentences, mechanism after benefit.
- Keep established product names `Chat`, `Work`, `Mission`, `Agent`, `Skill`, and `Expert Squads` where they connect copy to the interface.
- Expand Model Context Protocol (MCP) once in the Expert Squads description; do not add unsupported capability claims.
- Do not modify `LandingContent`, `Lander.astro`, assets, interactions, or English copy unless real desktop inspection proves a copy-induced layout defect.
- Do not add, modify, or run User Interface (UI) automated tests. Real-page interaction and manually inspected screenshots own UI acceptance.
- Keep desktop-only acceptance at approximately 1,440 pixels; no mobile or responsive redesign is authorized.
- Commit subjects start with `dsw-33987`; push the delivery branch to `legacy-remote` without bypassing hooks.

## Recall

| Item | Recorded context |
| --- | --- |
| User request | “中文翻译太生硬，帮我优化一下。” |
| Approved direction | Option 1: a mature developer-tool voice that feels natural and restrained, professional without sounding bureaucratic. |
| Approved rewrite method | Outcome-first Chinese recomposition rather than line-by-line translation or terminology-only replacement. |
| Acceptance criteria | The Chinese page must sound complete without the English page beside it, retain accurate product names and claims, scan concisely, and keep clean desktop line breaks with no clipping. |
| Hard constraints | Preserve page structure and English; no UI automated tests; inspect the real Chinese page and screenshot evidence; use root `specs/` records and required indexes/tests. |
| Sources read | `packages/web/src/content/landing.ts`, `specs/records/2026-08/2026-08-03-independent-developer-landing-page-design.md`, `specs/records/2026-08/2026-08-04-independent-developer-landing-page-implementation-plan.md`, and `specs/records/2026-08/2026-08-04-natural-chinese-landing-copy-design.md`. |
| Repository search | The `zh-cn` entry in `packages/web/src/content/landing.ts` is the single content owner. The live page is already available at `http://localhost:9999/docs/zh-cn/`; no UI test path is required or allowed. |
| Independent agent feedback | None; current collaboration constraints prohibit unrequested sub-Agent delegation. |

---

### Task 1: Rewrite the Simplified Chinese content owner

**Files:**
- Modify: `packages/web/src/content/landing.ts:250-390`

**Interfaces:**
- Consumes: the existing `LandingContent` field names and unchanged localized routes.
- Produces: the same `landingContent["zh-cn"]` shape with natural Chinese values for every visible landing section.

- [ ] **Step 1: Rewrite the hero and proof line**

Use these approved values:

```ts
eyebrow: "面向独立开发者的开源 Agent 工程平台"
title: "把想法做成经得起审查的成果。"
description: "OpenCorvus 把排查、实现、证据和长时间运行的任务收在同一个项目里。你不必反复补充上下文，一个人也能把复杂工作有条不紊地推进到底。"
primary.label: "快速上手"
secondary.label: "看看怎么用"
proof: ["过程实时可见", "上下文始终在手", "结果有据可查"]
```

- [ ] **Step 2: Rewrite the real Mission demo**

Use `真实 Mission 实录` and the headline `任务交出去，过程依然看得见。` Describe the visible 01:36 recording as showing goal decomposition, Agent collaboration, tool use, and traceable evidence. Replace the four signals with: project-bound requirements, clear Agent responsibilities, inspectable goals/tools/evidence, and resuming after interruption.

- [ ] **Step 3: Rewrite the three developer scenarios**

Use the section headline `从查问题到做交付，都在同一个项目里。` and the supporting sentence `不用每换一步就重讲背景，也不用在多个工具之间来回搬运上下文。`

Use these scenario titles and intent:

```text
查清问题 — 趁思路还热，把根因一次查清。
做完需求 — 把需求做到可以放心交给别人审查。
持续推进 — 你离开电脑，复杂任务也能接着往前走。
```

Each description and bullet list must use concrete verbs, retain the existing Chat/Work/Mission fact boundary, and explain evidence continuity without “保持连接”, “持有进度”, or “支持续跑”.

- [ ] **Step 4: Rewrite Expert Squads**

Use the headline `需要什么能力，就带上怎样的一支团队。` Explain that Expert Squads are not disconnected Agents: after selection, roles, Skills, tools, MCP (Model Context Protocol, 模型上下文协议) capabilities, and collaboration order come into place together around one task.

Rename the four capability labels to `专业分工`, `方法与规范`, `工具与 MCP`, and `协作流程`. Describe responsibilities, package-owned methods, least-required tool access, and clear evidence handoff in ordinary Chinese. Keep the intentional product-media placeholder explicit and non-interactive.

- [ ] **Step 5: Rewrite runtime capabilities, final action, and footer**

Use the runtime headline `关掉窗口，工作也不会凭空消失。` Explain resuming through the desktop, supported message channels, or scheduled automation from the same project context. Use these capability titles: `桌面端随时接续`, `后台持续运行`, `从常用消息工具继续`, and `按计划自动唤醒`.

Use the final-action headline `带着完整上下文，把需求一步步做完。`, primary action `查看快速上手`, secondary action `了解系统架构`, and footer statement `OpenCorvus · 独立开发，也能持续、清楚地交付。`

- [ ] **Step 6: Read the Chinese locale as a standalone page**

Read only the final `zh-cn` content from top to bottom. Remove any remaining translated syntax, repeated abstract noun chain, bureaucratic verb, factual duplication, or punctuation inconsistency. Do not change the English locale while editing.

### Task 2: Verify source and production output

**Files:**
- Inspect: `packages/web/src/content/landing.ts`
- Inspect: `packages/web/dist/zh-cn/index.html`

**Interfaces:**
- Consumes: Task 1's unchanged `LandingContent` shape.
- Produces: an error-free Astro source tree and production Chinese landing page.

- [ ] **Step 1: Run the Astro checker**

Run:

```powershell
bun run --cwd packages/web check
```

Expected: exit code 0; no new error or warning from the localized content change.

- [ ] **Step 2: Build the production site**

Run:

```powershell
bun run --cwd packages/web build
```

Expected: exit code 0; `/docs/zh-cn/` is generated successfully with unchanged routes and media.

- [ ] **Step 3: Confirm scope and excluded wording**

Inspect `git diff -- packages/web/src/content/landing.ts` and confirm only `zh-cn` values changed. Search the final Chinese locale for the retired marketing phrases `投影到任务中`, `执行契约`, `持有进度`, `保持连接`, `持续可达`, and `触达`; the source review must find none.

### Task 3: Validate the real Chinese desktop page

**Files:**
- Create: `specs/artifacts/natural-chinese-landing-page-full.png`
- Create: `specs/artifacts/natural-chinese-landing-page-hero-scenarios.png`
- Create: `specs/artifacts/natural-chinese-landing-page-expert-squads-runtime.png`

**Interfaces:**
- Consumes: the live development page at `http://localhost:9999/docs/zh-cn/` and Task 2's verified source.
- Produces: manually inspected task-scoped screenshots and observable real-page evidence, not an automated test or baseline.

- [ ] **Step 1: Confirm the live page**

Request `/docs/zh-cn/` and confirm HTTP 200. Open the same URL in a visible Node-launched Microsoft Edge session at approximately 1,440 pixels wide.

- [ ] **Step 2: Exercise the localized page**

Scroll through the hero, scenarios, demo, Expert Squads, runtime grid, and final action so lazy media loads. Open and close one existing screenshot preview and verify the localized control remains usable.

- [ ] **Step 3: Capture and personally inspect evidence**

Capture the full Chinese page plus focused hero/scenario and Expert Squads/runtime regions. Inspect headline wrapping, paragraph measure, bullet rhythm, mixed Chinese/English spacing, placeholder honesty, contrast, and clipping. If copy reads or wraps poorly, return to Task 1, patch the root wording, rerun Task 2, and recapture.

### Task 4: Record evidence and deliver

**Files:**
- Modify: `specs/records/2026-08/2026-08-04-natural-chinese-landing-copy-implementation-plan.md`
- Modify: `specs/README.md`
- Modify: `specs/records/2026-08/README.md`

**Interfaces:**
- Consumes: final source diff, static commands, documentation tests, real browser states, and screenshots.
- Produces: an indexed verification record and legacy remote delivery.

- [ ] **Step 1: Run documentation-contract tests**

Run:

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
```

Expected: all positive documentation contracts pass.

- [ ] **Step 2: Append implementation evidence**

Record exact check/build/test results, live URL, browser interactions, screenshots personally inspected, copy-review verdict, and any remaining intentional product-media placeholder in this plan.

- [ ] **Step 3: Commit and push**

Stage only the Chinese content owner, this task's plan/index changes, and task-scoped screenshots. Commit with a `dsw-33987` subject and push the current branch to `legacy-remote` without bypassing hooks.

## Plan self-review

- Spec coverage: all approved voice rules and six page-section intents are owned by Task 1; source/build validation, real visual validation, documentation health, evidence, commit, and push each have an explicit owner.
- Placeholder scan: no implementation step is deferred. The only future media language is the existing user-approved, intentionally visible Expert Squads product-capture placeholder.
- Type consistency: the plan changes values under the existing `LandingContent` shape only; no new field or component interface is introduced.
