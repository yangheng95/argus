# Natural Chinese landing-page copy design

## Recall

| Item | Recorded context |
| --- | --- |
| User request | The Simplified Chinese promotional page reads like a stiff translation; rewrite it to sound natural. |
| Approved voice | Product-led, natural, and restrained: the tone of a mature developer-tool website, professional without sounding bureaucratic. |
| Audience | Independent developers evaluating whether OpenCorvus can help them investigate, implement, review, and continue complex work. |
| Acceptance criteria | Chinese copy reads as original Chinese rather than translated English; outcome language leads, product terms remain accurate, scanning remains concise, and the existing desktop layout has no clipping or visibly awkward line breaks. |
| Hard constraints | Preserve the approved information architecture, English copy, real media, links, and product claims. Do not add, modify, or run User Interface (UI) automated tests. Validate the live Chinese page and personally inspect task-scoped screenshots. |
| Sources read | `packages/web/src/content/landing.ts`, `specs/records/2026-08/2026-08-03-independent-developer-landing-page-design.md`, `specs/records/2026-08/2026-08-04-independent-developer-landing-page-implementation-plan.md`, and the latest landing-page commits. |
| Repository search | The localized landing copy has one owner: the `zh-cn` entry in `packages/web/src/content/landing.ts`. Page structure and responsive behaviour remain owned by `packages/web/src/components/Lander.astro`; they are outside this copy-only design unless real-page inspection proves a copy-induced desktop layout defect. |
| Independent agent feedback | None. Current collaboration constraints prohibit unrequested sub-Agent delegation, so the primary agent owns copy review and visual verification. |

## Problem diagnosis

The current translation preserves the English information correctly but also preserves too much English syntax. Long noun chains such as “项目上下文”, “执行契约”, “持久状态”, and “证据保持连接” make the page sound like architecture documentation. Repeated abstract verbs such as “投影”, “持有”, and “支持继续推进” describe implementation mechanics before the developer understands the practical benefit.

The repair is a Chinese-first rewrite, not a synonym pass. Each section starts from the developer's situation and result, then introduces the minimum product terminology needed to substantiate the claim.

## Considered approaches

1. **Outcome-first Chinese rewrite — approved.** Recompose every Chinese section around what the developer can accomplish. This produces the most natural reading while preserving the product facts.
2. **Terminology-only cleanup.** Replace awkward words without changing sentence structure. Lower risk, but the page would retain translated rhythm and abstract density.
3. **Brand slogan compression.** Reduce most content to short slogans. More forceful, but it would lose the evidence and specificity that distinguish OpenCorvus from generic Agent marketing.

## Copy design

### Voice rules

- Write direct modern Chinese with short subject–verb sentences.
- Lead with an observable developer outcome; explain the mechanism second.
- Prefer familiar verbs such as “查清”, “做完”, “接着推进”, “随时回来查看”, and “一起就位”.
- Keep established product names `Chat`, `Work`, `Mission`, `Agent`, `Skill`, and `Expert Squads` where they help readers connect copy to the interface.
- Expand Model Context Protocol (MCP) once in the Expert Squads description, then use `MCP` only where necessary.
- Avoid bureaucratic or architecture-first wording in promotional copy: “投影到任务中”, “执行契约”, “持有进度”, “保持连接”, “持续可达”, and “触达”.
- Do not exaggerate autonomy, completion guarantees, availability, team size, or unsupported integrations.

### Section intent

1. **Hero:** Speak to the solo-developer reality first: one person can still move a complex requirement from idea to reviewable delivery. Supporting copy explains that investigation, implementation, evidence, and long-running work remain together.
2. **Three scenarios:** Use concrete developer verbs: find the cause while context is fresh; turn a requirement into something ready for review; let long work continue while the developer steps away.
3. **Product demo:** Describe what the recording visibly shows. Replace “保留可见性” and “持久状态” with ordinary phrases such as “过程一直看得见” and “回来后接着推进”.
4. **Expert Squads:** Explain selection as assembling a ready-to-work team. Roles, Skills, tools, Model Context Protocol access, and collaboration order “一起就位”; reserve formal workflow language for documentation links, not the headline.
5. **Runtime capabilities:** Frame infrastructure as continuity: closing the window does not make the work disappear, and the developer can resume from the same context.
6. **Final action:** End with one practical promise—start from a repository and a requirement, keep context intact, and reach a reviewable result—without repeating the hero word for word.

## Scope and ownership

- Modify only the Simplified Chinese content values in `packages/web/src/content/landing.ts`, plus this task's plan, indexes, and screenshot evidence.
- Keep the `LandingContent` schema, English locale, component markup, assets, links, and interaction code unchanged unless live inspection proves a copy-induced layout defect.
- Do not add or run UI source-string assertions, rendering tests, snapshots, Playwright tests, or visual baselines. Static Astro checks and documentation-contract tests remain allowed.

## Verification design

- Run `bun run --cwd packages/web check` and `bun run --cwd packages/web build`.
- Run the required historical-document links, document-health, and product-document single-source tests after indexing the new record.
- Inspect `http://localhost:9999/docs/zh-cn/` in the real desktop page at approximately 1,440 pixels wide after the live development server applies the content change.
- Personally inspect the hero, three scenarios, Expert Squads, runtime capabilities, and final action for natural line breaks, balanced density, and no clipping.
- Perform a final Chinese copy read without the English page beside it. Every sentence must still sound complete and natural on its own.

## Self-review

- Placeholder scan: no incomplete copy decision or deferred wording remains.
- Consistency: the approved natural, restrained voice is applied to every section while product terms and capabilities remain unchanged.
- Scope: this is one localized content-owner change with desktop visual verification; it does not reopen layout, English copy, responsive delivery, or product architecture.
- Ambiguity: “natural” means Chinese-first outcome language with restrained technical terminology, not colloquial slang or reduced factual precision.
