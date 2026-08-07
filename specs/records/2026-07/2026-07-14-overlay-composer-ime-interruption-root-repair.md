# Overlay Composer IME Interruption Root Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 修复 Overlay 输入框中断拼音输入、把未完成拼音切成英文字母的问题。 |
| Acceptance criteria | IME（Input Method Editor，输入法编辑器）composition 期间不得把 scoped draft 旧值或相同响应式值程序化写回 textarea；最终中文完整保留；同 key Browser comment 外部写入仍立即投影；focused tests、生产构建、Node 浏览器 benchmark、截图和二次 review 通过。 |
| Hard constraints | 无 fallback、debounce、延迟队列、第二份 draft、composition shadow state 或 gate；canonical scoped draft store 保持唯一来源；Playwright 只由 Node 启动；超时按无活动重置；不触碰正在运行的 Overlay；不提交并行改动。 |
| Sources read | `AGENTS.md`; benchmark-debug 与 Browser skills；`specs/current/architecture/07-panel.md`; `specs/current/architecture/99-principles.md`; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; `2026-07-14-composer-plus-runtime-controls-and-home-cards.md`; current composer, shared textarea primitive, draft store, `main.tsx`, tests and browser fixture. |
| Whole-repository grep | `composerDraftText` consumers are `ChatComposer` and Browser append in `main.tsx`; local input and Browser comment are the `setComposerDraft` producers; submit owns clear. All shared textarea consumers use `AutoGrowTextarea`. Existing IME handling only protects Enter. |
| Concurrent reconciliation | First implementation passed 14 focused tests and the real browser benchmark at `32caee8726`, then another workflow advanced HEAD through preservation/revert commits to `13883f04b9` and twice overwrote all uncommitted task files. Those passes are diagnostic only. This plan and delivery are recreated at `13883f04b9` without reset/history rewrite and protected by a selective task commit before final reruns. |
| Independent agent feedback | None; delegation was not requested. |

## Causal Chain

1. Local input calls `setText(next)` before `setComposerDraft(next)`.
2. The same-key external projection effect tracks both store draft and local `text()`, so it can observe new local text with the previous stored draft and write the old value back.
3. `AutoGrowTextarea` also binds every reactive intermediate value to the DOM although native composition already changed `textarea.value`.
4. Either programmatic assignment terminates WebView composition and leaves phonetic letters.

## Design And Call Sites

| Surface | Disposition |
| --- | --- |
| `ChatComposer.tsx` | Keep draft-key/store subscription; compare local text through `untrack` so local input cannot invalidate the external projection effect. |
| `AutoGrowTextarea.tsx` | Synchronize only when authoritative value differs from the native DOM value; equal native composition text is not rewritten. |
| draft service / `main.tsx` | Unchanged canonical store and Browser producer. |
| interaction dialog | Restore the generic permission/question dialog heading; keep the interaction title owned by the reused card instead of duplicating an unbounded title in the dialog chrome. |
| dialog and interaction card CSS | Derive header/footer bleed from the form's canonical padding variables and restore intrinsic-size/wrapping constraints lost in a concurrent revert. |
| browser fixture | Keep SSE（Server-Sent Events，服务端事件流）open after its heartbeat so strict error collection is not raced by reconnect aborts. |
| tests | Pin both dependency edges; production browser records every programmatic value assignment during `n` / `ni` / `你好`, expects zero, then verifies Browser comment projection. Shared primitive browser coverage also verifies permission/question dialogs at zoom, drag, resize and minimum-window layouts. |

## Benchmark

- Input: active scoped composer, composition start/intermediate/end, then same-key Browser comment.
- Output: zero programmatic writes during composition, final `你好`, external comment present.
- Environment: Windows host, production Vite bundle, isolated HTTP fixture, Node Playwright; no desktop Overlay interaction.
- Timeout: existing activity-reset browser runner.
- Pass: focused/systemic/browser/typecheck/build/i18n/docs checks, screenshot review, selective git-cc delivery.

## Progress

- [x] Recall, grep and concurrent-history reconciliation.
- [x] Failing focused regression established twice against the respective baselines.
- [x] Implement both feedback-edge repairs.
- [x] Complete product-focused verification against protected commit.
- [x] Record second review.
- [x] Push to git-cc after typecheck, route inventory, generated API documentation, localization and secret-scan hooks passed.

## Verification Result

| Check | Result |
| --- | --- |
| Focused composer/shared primitive/dialog tests | PASS: 24 tests, 0 failures, 1452 expectations. |
| Production IME browser benchmark | PASS: one scenario, final value `你好`, zero programmatic `textarea.value` writes during composition, same-key Browser draft projection preserved. |
| Shared primitive browser coverage | PASS: agent reply and interaction custom reply scenarios, 2 tests, 0 failures. Production Vite build transformed 2439 modules. |
| Visual review | PASS: `.scratch/composer-ime-complete.png` shows intact `你好`; permission/question screenshots show contained wrapping and normal focus/chrome at zoom and minimum-window sizes. |
| Overlay localization | PASS: `overlay panel i18n ok (8994cac2bbb2992a)`. |
| Overlay typecheck | PASS for the delivered Overlay code. During pre-push, concurrent OpenCorvus schema/SDK generation temporarily disagreed over an unrelated completion field; the final schema and generated type agree without changing the Overlay event contract. |
| Documentation health | BLOCKED outside this change: a concurrent July README points to untracked `2026-07-14-project-runtime-authority-before-registration.md`; concurrent `.scratch/opentest-message-20260714-01` content also violates the repository snapshot audit. No ignore or deletion fallback was added. |

## Second Review

- The composer effect now tracks only the canonical scoped draft and normalized key; `untrack(text)` is comparison-only, so local keystrokes cannot schedule a stale-store projection.
- The shared textarea has no reactive JSX `value` binding. Its sole external synchronization path checks native DOM equality before assignment, preserving both IME composition and legitimate external writes.
- No composition flag, shadow draft, debounce, retry, fallback, gate or second producer was introduced.
- The browser benchmark instruments the native value setter, so a future Solid or primitive regression is observable instead of inferred from final text alone.
- The additional interaction failures were traced through commit history to conflict-revert regressions, then repaired at the original ownership and intrinsic-sizing boundaries; assertions were not weakened.
