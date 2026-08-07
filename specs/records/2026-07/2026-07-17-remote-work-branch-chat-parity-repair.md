# Remote Work-Branch Chat Parity Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Treat git-cc branch `work-v0.0.8beta-yr-0717` and the supplied screenshot as the correct Chat visual baseline; repair the incorrect result on merged branch `v0.0.8beta`. |
| Acceptance criteria | The merged branch must match the work branch's populated-Chat composer handoff, message-card presentation, Tools/Reasoning flow, and card/composer alignment while retaining independent mainline additions such as native menus, expert-squad lifecycle work, and Right Dock shortcuts. Focused source parity, Node-launched real-page geometry, current-goal screenshots, TypeScript/build/i18n, document health, second review, commit, and git-cc push must pass. |
| Hard constraints | Use the work branch as the visual source of truth, but do not wholesale replace its 56-file diff over newer mainline features. Restore only proven visual divergences. Preserve one `#chatScroll`, one `#solidChatComposer`, the rendered-height clearance projection, symmetric width tokens, and existing primitives. No fallback, compatibility path, gate, duplicate layout owner, worktree, iframe, query override, state machine, or interaction with the user's running OpenCorvus/Overlay. Playwright runs through Node. |
| Supplied evidence | The user identified `https://git-cc.myhexin.com:6443/yangheng/opencorvus/-/commits/work-v0.0.8beta-yr-0717` as correct and supplied `/var/folders/bj/6vby7ld11796l5bfdmc7s8l40000gn/T/codex-clipboard-ee870a62-1a93-461d-9842-8633d00c40e9.png`. The original-resolution image shows the intended pale-cyan Assistant card, inline Tools/Reasoning chronology, and the translucent canvas handoff immediately above the composer. |
| Sources read | `AGENTS.md`; Browser control skill; both spec indexes; the 2026-07-17 scroll-owner, fixed-layer, opaque-layer, Tools/Reasoning inline-flow, density, and merge records; `App.tsx`; `Conversation.tsx`; `ChatComposer.tsx`; `CardParts.tsx`; `Card.tsx`; `conversation.css`; `composer.css`; `chat-bubble.css`; `messages.css`; `card.css`; focused source/browser tests; complete first-parent history from merge-base `ee75d61a2` through `myhexin/v0.0.8beta`; merge commits `ea34c5835`, `3d3c18271`, and `f08cdb99a`; current work branch `934ddf2c0`. |
| Whole-repository and history search | `git diff`, `git log --left-right`, first-parent history, and `rg` enumerated all Chat renderer/style/test owners. Current main and the correct work branch are byte-identical for `CardParts.tsx`, `Conversation.tsx`, `card.css`, `chat-bubble.css`, and `messages.css`. `App.tsx` differs only by the newer Right Dock callback contract. `composer.css` differs only by newer cascade-mention UI plus formatting. The only remaining visual divergence caused by the reported repair path is the ordinary `#solidChatComposer` background in `conversation.css`, plus the two assertions added to `conversation-scroll-bottom-button.test.ts` and `conversation-agent-rail-scroll-browser.test.ts`. The broader 56-file branch diff contains unrelated native-menu, expert-squad, settings, Right Dock, and mention work and must not be used as a replacement set. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy forbids unrequested delegation. |
| Git baseline | After fetching, local/remote `v0.0.8beta` converged at `df23eadba`; the existing macOS package/checkpoint commits were preserved and pushed after rewording the one unpushed nonconforming subject to the required `dsw-33987` prefix. All pre-push hooks passed. Concurrent Agent Rail spec/index edits are user-owned and remain outside this task's commits. |

## Causal chain

The earlier diagnosis treated message colour visible above the composer as
unwanted bleed and replaced the work branch's top-transparent composer gradient
with a fully opaque canvas. The user's explicit reference proves that visual
handoff is intentional. The work branch still uses the gradient, and its source
tests intentionally do not impose an opaque-layer contract.

Subsequent mainline merge `ea34c5835` already brought the correct work-branch
message renderer and styles into `v0.0.8beta`. Byte comparison proves the card,
Tools/Reasoning, chronology, and conversation renderer sources now match. The
remaining mismatch is therefore not a general failed merge and not a reason to
copy the work branch wholesale: it is the later opaque-background change and
its two false-positive regressions. That change makes the composer paint a hard
white rectangle over the reference card, creating the reported layer break.

The root repair is exact semantic parity for that paint owner: restore the work
branch's canonical transparent-to-`--chat-canvas` gradient and delete only the
tests that required opacity. All geometry, bottom clearance, card rendering,
and newer mainline features remain untouched.

## Call-site disposition

| Surface | Decision |
| --- | --- |
| `conversation.css` ordinary composer | Restore the exact `work-v0.0.8beta-yr-0717` gradient. Keep absolute positioning, canonical inline inset, bottom anchoring, and z-index unchanged. |
| Empty launcher | Keep its explicit transparent background and relative centered composition unchanged. |
| `conversation-scroll-bottom-button.test.ts` | Remove the opaque-background and no-transparent assertions introduced by the incorrect repair; preserve positioning, measurement, and button contracts. |
| `conversation-agent-rail-scroll-browser.test.ts` | Remove computed opacity equality assertions; preserve wide/narrow alignment, fixed bounds, hit ownership, final clearance, resize following, and screenshots. |
| Card / Tools / Reasoning sources | No code change. Exact branch comparison proves they already match the correct work branch. |
| Newer mainline surfaces | Preserve App/Right Dock, cascade mentions, native menu, expert-squad, settings, package artifacts, and Agent Rail work. |
| Previous opaque-layer record | Mark its conclusion superseded by the user's authoritative work-branch evidence and this correction; retain it as historical evidence rather than deleting history. |
| Specs/indexes | Add this record to both indexes without adopting concurrent unrelated index changes. |

## Verification plan

1. Record and commit this corrected Recall/plan before production edits.
2. Restore the exact three-file work-branch semantic delta and prove the
   selected visual core is byte-identical or intentionally mainline-only.
3. Run focused source tests, the real production Overlay browser scenarios,
   wide/narrow geometry, scroll/resize interaction, TypeScript, build, i18n,
   historical links, product-doc single-source, document health, and diff
   checks.
4. Inspect the refreshed populated Chat screenshots at original resolution and
   compare the card/composer handoff with the user's correct screenshot.
5. Perform a second source/history/diff review, update both records with exact
   evidence, commit only task-owned files, and push `v0.0.8beta` to `myhexin`.

## Result

Restored the exact work-branch Chat paint contract without replacing newer
mainline features. The ordinary populated-Chat `#solidChatComposer` again uses
the canonical top-transparent-to-`--chat-canvas` gradient from
`work-v0.0.8beta-yr-0717`. Its absolute positioning, symmetric inline inset,
bottom anchor, elevation, rendered-height transcript clearance, and empty-home
override remain unchanged.

Removed only the invalid opacity assertions introduced by the superseded
repair. `conversation-scroll-bottom-button.test.ts` is byte-identical to the
correct work branch. The first 260 lines of `conversation.css`, which own the
Chat scroll lane, fixed composer, and launcher composition, are byte-identical
to the work branch. The remaining CSS difference is the intentional newer
Right Dock shortcut naming. `CardParts.tsx`, `Conversation.tsx`, `card.css`,
`chat-bubble.css`, and `messages.css` were already byte-identical and were not
modified. The browser fixture differs only by concurrent Agent Rail
single-activity coverage; the opaque-background measurements are gone.

Original-resolution visual review covered:

- `.scratch/overlay-codex-conversation-work-expanded.png`
- `.scratch/conversation-agent-rail-scroll-browser/composer-message-card-1902x1110.png`
- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-near-bottom-1120x760.png`
- `.scratch/conversation-agent-rail-scroll-browser/fixed-composer-bottom-1120x760.png`
- `.scratch/short-chat-composer-bottom/sparse-populated-chat-1902x1314.png`

The expanded Assistant surface now matches the supplied work-branch reference:
one pale-cyan rounded card, inline Tools/Reasoning chronology, and a soft
translucent handoff immediately above the composer. Wide and narrow screenshots
retain exact Assistant-card/composer/input alignment. Near-bottom content is
visible only through the intended 16-scaled-pixel fade, and the final item still
scrolls fully above the composer.

Verification results:

- Focused Chat/layout/architecture/Agent Rail source suite: 163 passed, 0
  failed, 8,551 assertions.
- Node-launched production Overlay browser scenarios: 3 passed, covering the
  full Assistant/Tools/Reasoning surface, sparse Assistant Chat, 1902px and
  1120px alignment, four transcript scroll positions, composer resize/follow,
  final clearance, and concurrent one-record/long-history Agent Rail behavior.
- Production Vite build passed with only the existing large-chunk advisory.
- Overlay TypeScript and i18n checks passed.
- Historical-links, product-doc single-source, and document-health suites: 81
  passed, 0 failed, 1,282 assertions.
- `git diff --check` passed.

The previous opaque-layer record is now explicitly marked superseded. No
running OpenCorvus/Overlay process was restarted, refreshed, closed, or
otherwise modified; all visual evidence came from the isolated Node fixture.
