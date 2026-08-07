# Build Web Clone Reference Context Repair

## Recall

User question:

- After the expert-squad refactor, why does a webpage replica Build context no longer explicitly support/name the reference image? Previously the synthesized context ended with an explicit instruction to reference that image.

Retained requirements:

- Webpage replica Build sessions must receive an explicit, concrete reference-image instruction when frontend_design supplies a structured webpage-clone handoff.
- The instruction must be derived from structured handoff evidence, not text sniffing, fallback, hidden routing, or UI-only filtering.
- Existing AttachmentStore-backed `Visual Reference Contract` remains the single path for user/material target-reference attachments.
- `web-clone-source/reference.png` is the canonical source-package reference screenshot for structured webpage-clone handoffs.
- Do not restart running OpenCorvus or overlay processes.

Sources read:

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `specs/records/2026-07/2026-07-03-dynamic-expert-squad-loading.md`
- `specs/records/2026-07/2026-07-05-expert-squad-skill-projection-completeness.md`
- `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`
- `packages/opencorvus/src/build/prompt-context.ts`
- `packages/opencorvus/src/build/agent.ts`
- `packages/opencorvus/src/build/evidence-pack.ts`
- `packages/opencorvus/src/frontend-design/handoff.ts`
- `packages/opencorvus/src/context-packets/visual-handoff.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/test/build-agent/prompt-context.test.ts`
- `packages/opencorvus/test/build-agent/managed-worktree-runtime.test.ts`

Repository search evidence:

- `rg -n "source_baseline_input|project_mode=source_baseline|visual_handoff|reference|screenshot|image|baseline|source baseline|参考|图片|图" packages/opencorvus/src packages/opencorvus/test specs/current/architecture specs/records/2026-07 -g "*.ts" -g "*.txt" -g "*.md" -g "*.jsonc"`
- `rg -n "visualHandoffStructuredPart|BUILD_VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA|VISUAL_HANDOFF_CONTEXT_PACKET_SCHEMA|contextPackets|renderBuildPromptOverlays|buildContextPacketText|AgentContextPacket|visual_handoff" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "renderVisualContractPreamble|Visual Reference Contract|staged on disk|stageToWorktree|STAGED_REFERENCES_SUBDIR|references/<filename>|collectBuildReferenceAttachments|system_artifacts|visual_reference" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- `rg -n "design_resource_manifest|recordDesignResourceManifest|createDesignResourceManifest|reference\\.png|web-clone-source/reference\\.png|sourcePackageAbsolute|sourcePackageRelative|evidence_source_manifest" packages/opencorvus/src/frontend-design packages/opencorvus/src/orchestrator packages/opencorvus/test/frontend-design packages/opencorvus/test/orchestrator -g "*.ts"`

Findings:

- `renderVisualContractPreamble()` still creates the strong explicit reference-image contract, but only when `BuildEvidencePack.targetReferences` contains AttachmentStore-backed visual references.
- Webpage URL clone reference screenshots are materialized as task runtime files such as `.opencorvus/r/t/<task>/fd/web-clone-source/reference.png`, not as AttachmentStore target references.
- `VisualHandoffContextData` currently carries only `visualReference`, `webCloneSource`, and `projectMode`; it has no concrete reference-image path or evidence id.
- `renderWebCloneSourceOverlay()` resolves `web-clone-source/reference.png` in one explanatory bullet but does not end with a clear required-reference-image instruction.
- Tests were updated during the context-packet refactor to assert `project_mode=source_baseline`, but they did not assert that the synthesized Build context still clearly names the required reference image.

## Repair Plan

- Keep AttachmentStore target references and runtime web-clone source references separate.
- For structured `webCloneSource` handoffs, render an explicit required reference-image block from the canonical resolved `web-clone-source/reference.png` path.
- Add request-path and goal-path prompt tests proving the concrete reference-image instruction is present and path-resolved.
- Run focused prompt-context tests, typecheck, documentation link validation after updating this record index, and diff whitespace checks.

## Implementation

- `renderWebCloneSourceOverlay()` now appends a `Required Reference Image` section for structured webpage-clone source handoffs.
- The section names the resolved canonical `web-clone-source/reference.png` path and tells Build to open/inspect it before UI changes, compare rendered screenshots against it, and report a frontend_design blocker if it is missing or unreadable.
- Request-path and goal-path Build prompt tests now assert this concrete reference-image instruction and the resolved path.

## Validation Results

- `bun test --timeout=2147483647 packages/opencorvus/test/build-agent/prompt-context.test.ts` passed: 30 pass, 0 fail, 212 `expect()` calls.
- `bun test --timeout=2147483647 packages/opencorvus/test/script/historical-docs-links.test.ts` passed: 19 pass, 0 fail, 66 `expect()` calls.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `git diff --check -- packages/opencorvus/src/build/prompt-context.ts packages/opencorvus/test/build-agent/prompt-context.test.ts specs/records/2026-07/README.md` passed with Git's existing CRLF normalization warning for `prompt-context.test.ts`.
- `Select-String -Path specs/records/2026-07/2026-07-05-build-web-clone-reference-context-repair.md -Pattern '[ \t]+$'` returned no trailing whitespace for the new untracked spec file.
