# Thick Expert Squad Prompts

Date: 2026-06-30
Status: implementation plan

## Recall

### User Request

The user rejected the current expert-squad prompt shape because each agent in
the selected squad appears to receive only one short paragraph. The requested
direction is: keep `general` thin, make expert-squad prompts thick, and redo the
work in the main worktree.

The active task context is a frontend replica request:

- source page: `https://www.tradingview.com/markets/indices/`;
- one goal per component;
- reuse non-code source assets from the source page;
- reuse target project business components and code when that preserves source
  parity.

The built-in profile text must encode this as source-page to target-project
replica discipline rather than hard-coding the TradingView or AInvest names into
the global frontend replica profile.

### Acceptance Criteria

- `PromptProfile.builtIns.general.agents` remains empty.
- Built-in expert squads keep using the existing `PromptProfile.builtIns`
  registry and prompt compiler; no workflow, tool, route, model, or hidden
  selection path is added.
- Expert-squad overlays become multi-line, role-specific, checkable prompts
  instead of one-paragraph slogans.
- Frontend replica overlays explicitly preserve desktop source information
  architecture, component-per-goal decomposition, interaction evidence,
  source visual assets, target project component/code reuse constraints, and
  browser preview evidence ownership.
- The profile layer does not copy mounted expert-squad skill selection
  mechanics. `select_expert_squad` remains part of the Orchestrator skill path,
  not per-agent overlay prose.
- Tests reject thin one-line overlays, duplicated noun-swapped overlays, and
  prompt mechanics language such as profile ids, selection tool names, host
  routing, or generic workflow wrapper text.
- Existing desktop-only frontend replica checks and prompt catalog behavior keep
  passing.

### Hard Constraints

- No fallback or compatibility path.
- No second source for expert-squad text.
- No host-side gate, keyword classifier, workflow branch, or per-agent prompt
  mutation.
- Specs stay under `specs/records/2026-06/` and indexes must be updated.
- Code changes require focused tests and self-review.
- Do not touch unrelated dirty worktree files.

### Read From Disk Before Edits

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double source, Recall before implementation, tests required, no new worktree without authorization. |
| `specs/artifacts/tv2ainvest.md` | The live user task is source-page replica with one goal per component and target project code/component reuse only when it preserves source parity. |
| `specs/records/2026-06/2026-06-16-prompt-profile-expert-squad-switching.md` | Expert squads are prompt profiles compiled by one backend registry; `general` is the empty baseline; built-ins are final overlay strings, not workflow metadata. |
| `specs/records/2026-06/2026-06-24-orchestrator-expert-squad-skill.md` | Automatic squad adjustment is Orchestrator-owned visible skill selection plus `select_expert_squad`; it is not hidden injection or profile keyword routing. |
| `specs/records/2026-06/2026-06-26-frontend-replica-desktop-only-decision-surface.md` | Frontend replica defaults to desktop-only; tablet, mobile, responsive, or multi-end work requires explicit current authorization. |
| `specs/records/2026-06/2026-06-29-frontend-replica-tool-ownership-prompt.md` | Build owns changed-region proof with `browser_preview_reference_regions`; Visual QA owns independent final region proof and uses `browser_preview_compare_scroll_slices` only as supporting page-slice visual-difference evidence. |
| `specs/records/2026-06/2026-06-29-frontend-innovate-expert-squad.md` | Frontend Innovate remains a profile plus mounted skill, not a new workflow; Build brainstorming drafts only happen when explicitly requested. |
| `packages/opencorvus/src/agent/prompt-profile.ts` | Current built-in overlays are mostly one sentence, and the profile registry is the correct single source to change. |
| `packages/opencorvus/test/agent/prompt-profile.test.ts` | Current structural test caps overlays at 240 characters, causing the thin-prompt pressure that must be corrected. |
| `packages/opencorvus/test/agent/frontend-replica-desktop-only.test.ts` | Existing exact frontend replica desktop-only and browser-preview ownership phrases must be preserved. |
| `packages/opencorvus/test/agent/role-contract.test.ts` | Prompt catalog expects active frontend replica profile overlays to appear in effective prompts while editable prompt fields stay separate. |

### Whole-Repository Search Evidence

Commands run before this record:

```bash
rg -n "PromptProfile|prompt_profile|frontend-replica|frontend-innovate|select_expert_squad|browser_preview_reference_regions|browser_preview_compare_scroll_slices" packages specs -g "!node_modules"
```

Findings:

- `packages/opencorvus/src/agent/prompt-profile.ts` is the single built-in
  profile registry and prompt compiler source.
- Runtime prompt composition already flows through
  `PromptProfile.composeAgentPrompt` from `agent/runner.ts`,
  `session/llm.ts`, and `orchestrator/agent.ts`.
- `select_expert_squad` exists in Orchestrator tools and mounted expert-squad
  skills, not in per-agent prompt overlays.
- The browser preview region and scroll-slice tool ownership is already
  documented in core Build and Visual QA prompts, the frontend replica skill,
  and prompt-profile tests.
- Overlay and server surfaces expose the built-in profile catalog; they should
  display the thicker strings without a separate user-interface source.

### Independent Agent Feedback

An independent read-only agent reviewed the prompt shape before this main
worktree redo. Its feedback:

- Change only `PromptProfile.builtIns`; keep `general.agents` empty.
- Thick overlays should be role-specific execution discipline with concrete
  objects, evidence obligations, forbidden scope upgrades, and completion
  criteria.
- Do not copy the `frontend-replica-expert-squad.md` selection flow into profile
  overlays. The skill owns when and how to select a squad; the profile owns how
  each role reasons once active.
- Replace the thin 80 to 240 character structural test with pressure for
  multi-line overlays, role-specific objects, no duplicated noun-swapped text,
  no wrapper or tool-mechanics prose, and retained desktop/source-backed
  frontend replica discipline.

## Decision

Make every non-general built-in profile overlay a compact multi-line prompt:

- line 1: role boundary and source of truth;
- line 2: concrete objects or evidence that role must produce or preserve;
- line 3: completion or rejection criteria.

Do not move expert-squad selection language into overlays. The Orchestrator
skill continues to load and select the squad. The overlay text starts after a
squad is already active.

For frontend replica, encode the durable rule generically:

- source page evidence defines the page structure, visual assets, interaction
  semantics, and acceptance surface;
- target project components and business code are reuse constraints, not an
  excuse to rewrite the source information architecture;
- Architect must decompose meaningful components or regions into separate
  accountable goals;
- Build and Visual QA must use the existing browser preview proof split.

## Implementation Checklist

1. Add this record and update spec indexes.
2. Add a small authoring helper for multi-line expert overlays.
3. Rewrite built-in expert-squad overlays in
   `packages/opencorvus/src/agent/prompt-profile.ts`.
4. Strengthen prompt-profile tests so the registry rejects thin one-line expert
   overlays and selection mechanics prose.
5. Run focused prompt, desktop-only, role-contract, config route, docs index,
   docs health, and typecheck verification.
6. Self-review changed prompts for accidental hard-coded task brand names,
   forbidden mechanics language, and loss of existing required phrases.
