# Provider search visible-field parity

## Recall

### User requirement

Restrict the Providers settings search to field content that is actually shown in each result row. A hidden-field match leaves a row visible without any visible explanation and makes the search appear broken.

### Acceptance criteria

- Configured Provider rows search only their rendered display name, Provider ID, API URL, environment-variable names, visible model count/summary/overflow text, and rendered authentication status.
- Catalog Provider rows search only their rendered display name, Provider ID, model-count text, and the connected status when that badge is rendered.
- Hidden catalog model IDs, provider source, environment-variable declarations, model API metadata, and non-rendered status text do not produce results.
- Configured model IDs beyond the eight-item visible summary do not produce results merely because they remain in the title tooltip.
- Matching remains a case-insensitive trimmed substring comparison, with one client-side implementation and no backend search route.
- Search guidance describes visible Provider details instead of promising hidden Provider/model/API/environment metadata.
- The existing rendered browser fixture proves positive visible-field matches, negative hidden-field matches, clear/no-result behavior, keyboard focus, and a task-scoped screenshot inspected by the primary Agent.

### Hard constraints

- Preserve the shared `SearchField` primitive and the existing local reactive filter; do not create a backend index, fuzzy-search path, compatibility filter, or second source of row data.
- Derive filtering from the same row projection consumed by rendering so visibility and search cannot drift again.
- Use the isolated Node browser runner; do not launch Playwright with Bun and do not refresh, restart, or otherwise modify a running OpenCorvus/Overlay process.
- Preserve unrelated worktree changes. Commit subjects use `dsw-33987`, and the delivery branch is pushed to `myhexin`.

### Sources read

- `AGENTS.md`
- User screenshot and follow-up requirement
- `specs/current/architecture/06-provider.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-07/2026-07-21-settings-extension-runtime-repairs.md`
- `specs/records/2026-06/2026-06-20-provider-search-field-single-source.md`
- `packages/overlay/src/components/settings/ProvidersPanel.tsx`
- `packages/overlay/src/services/llm.ts`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/browser/provider-auth-panel.test.ts`
- `browser:control-in-app-browser` skill for rendered-page inspection

### Whole-repository search evidence

- `rg -n "providerMatchesSearch|provider.search.placeholder|provider-search-input|provider settings search|Provider.*搜索|搜索.*Provider" packages specs` found one production matcher, two list call points, the bilingual placeholder, the browser regression, primitive-only static tests, and the superseded 2026-07 search acceptance record.
- `rg -n "search|query|filtered|filter\\(" packages/overlay/src/components/settings/ProvidersPanel.tsx` confirmed there is no second Providers search implementation.
- The configured row renders `provider.name || id`, `id`, `provider.api`, `provider.env`, model count, the first eight model IDs plus overflow count, and an authentication status only when auth methods exist.
- The catalog row renders `p.name`, `p.id`, model count, and status only when `p.status.tone === "active"`; it does not render `p.source`, model IDs, environment variables, per-model API metadata, or other status text.
- `providerState()` can derive environment- and auth-related status details for catalog entries even when the catalog row does not render them. Those derived values therefore cannot be treated as visible search evidence.

### Independent agent feedback

No sub-agent was used. The user did not request delegation, and the active collaboration constraint prohibits unsolicited sub-agents. The primary Agent owns implementation and the second review.

## Root cause

`providerEntries` and `catalogEntries` currently maintain ad hoc search-part arrays independently from their JSX renderers. The catalog array indexes `source`, all model IDs, and every derived status even though the row renders none of those except an active status badge. Consequently a query such as a catalog model ID retains a row whose visible text does not contain that query. This is a search/render projection mismatch, not a backend discovery problem.

The repair makes each memo construct the exact row view model first, including conditional status and visible model summary, and filters only that projection. JSX consumes the same projected values. No hidden metadata is added to the page and no second search mechanism is introduced.

## Call-point disposition

| Call point                                      | Disposition                                                                                                                                                         |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalizeSearch()` / `providerMatchesSearch()` | Retain the single trimmed, lowercase substring matcher.                                                                                                             |
| `providerEntries` memo                          | Replace the tuple-only hidden-field filter with a configured-row projection whose searchable values are exactly its rendered data fields.                           |
| `catalogEntries` memo                           | Remove `source`, model IDs, and non-rendered status from search; project the conditional connected badge once for both rendering and filtering.                     |
| Configured/catalog JSX loops                    | Consume the projected name, model count/summary, overflow, and conditional status rather than recomputing search-adjacent values.                                   |
| `provider.search.placeholder`                   | Replace the metadata enumeration with guidance that search covers visible Provider details.                                                                         |
| `provider-auth-panel.test.ts`                   | Replace the hidden catalog-model positive assertion with visible-field positives and explicit hidden-field/no-result negatives; retain clear/focus/visual coverage. |
| Prior settings repair record                    | Keep as historical evidence; this record explicitly supersedes only its hidden-field search acceptance statement.                                                   |

## Verification plan

1. Run the focused Providers browser test through `node packages/overlay/test/browser-runner.mjs` and inspect its task-scoped screenshots.
2. Run focused static search/i18n tests plus Overlay typecheck and i18n validation.
3. Run historical-document link health because this record and both indexes changed.
4. Run `git diff --check`, inspect the scoped diff a second time, commit only task-owned paths, and push the current delivery branch to `myhexin`.

## Verification results

### Automated checks

- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun test packages/overlay/test/provider-search-clear-primitive.test.ts packages/overlay/test/search-field-unification.test.ts`: 5 passed.
- Focused Node browser run for `provider settings search filters catalog and custom providers`: passed with the visible name/API/environment/model positives, hidden catalog model/source/status negatives, hidden ninth configured-model negative, clear behavior, focus behavior, and screenshot assertions.
- The first full browser-file run executed the search regression successfully but exited nonzero because an earlier unrelated fixture reported `Overlay browser close failed` after `taskkill.exe` found already-exited descendants. A clean focused rerun of the unchanged search fixture passed and exited zero; the failure was in sidecar cleanup, not search behavior.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed.
- `git diff --check`: passed.
- The broader `document-health.test.ts` produced 60 passes and one tracked-file-index failure because two unrelated pre-existing records in the shared dirty worktree remain untracked. The required historical-link health test for this new record passed; those unrelated files were not staged or altered by this task.

### Rendered browser verification

The Provider fixture ran through Node and an isolated browser sidecar without touching the operator's running Overlay. The primary Agent inspected these task-scoped screenshots:

- `.scratch/provider-search-visible-field-match.png`: query `Anthropic` leaves exactly one catalog row, and the query is visibly present in that row's title/ID.
- `.scratch/provider-search-hidden-field-no-results.png`: query `claude-3-7-sonnet`, which exists only in hidden catalog model metadata, shows `0 / 3` and the explicit no-results message.
- `.scratch/provider-settings-primitive-owner.png`: the configured row visibly presents only the first eight model IDs and `+1 more`, matching the implemented search boundary for the hidden ninth model.

No layout, focus, clear-button, density, or empty-state visual defect was found.

### Second review

The second source/diff review confirmed that both list memos now project conditional visible values before filtering and that JSX consumes those same values. Catalog `source`, catalog model IDs, non-active status, and configured model IDs beyond the eight-item visible summary are absent from matcher inputs. The shared `SearchField`, normalization, substring comparison, and backend Provider contracts are unchanged. Unrelated concurrent worktree changes remain excluded from this task.
