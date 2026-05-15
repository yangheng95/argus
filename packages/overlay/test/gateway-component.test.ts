import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Vite replaces this token at build time; the test runner has to provide a
// stub before importing any module that transitively depends on it (e.g.
// services/task.ts → utils/version.ts).
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ =
  "test"

const {
  composeTaskText,
  filterMatches,
  runtimeLabel,
  statusIconFor,
  compactDirectory,
} = await import("../src/utils/gateway-helpers")

const GATEWAY_TSX = readFileSync(join(import.meta.dir, "../src/components/Gateway.tsx"), "utf8")
const GATEWAY_CSS = readFileSync(join(import.meta.dir, "../src/styles/surfaces/gateway.css"), "utf8")
const SERVICES_GATEWAY = readFileSync(join(import.meta.dir, "../src/services/gateway.ts"), "utf8")
const I18N_ZH_CN = readFileSync(join(import.meta.dir, "../src/i18n/zh-CN.json"), "utf8")
const I18N_EN_US = readFileSync(join(import.meta.dir, "../src/i18n/en-US.json"), "utf8")

// ── Structural / single-source assertions ───────────────────────────

test("Gateway component reuses boardStore as single source of truth (rule 8)", () => {
  expect(GATEWAY_TSX).toContain('import { boardStore')
  // No private task list copy — ledger reads the store-owned visibleTasks()
  // projection when the Gateway page is active.
  expect(GATEWAY_TSX).toContain("visibleTasks()")
  expect(GATEWAY_TSX).toContain("const gatewayTasks = createMemo(() => (isGatewayPage() ? visibleTasks() : []))")
  expect(GATEWAY_TSX).not.toMatch(/createStore\s*\(\s*\{[^}]*tasks\s*:/)
})

test("Gateway page-mode toggle uses the shared store, not a local signal", () => {
  expect(GATEWAY_TSX).toMatch(/from "\.\.\/store\/page-mode"/)
  expect(GATEWAY_TSX).toContain("setPageMode")
  expect(GATEWAY_TSX).toContain('setPageMode("panel")')
})

test("Gateway error blocks render explicit error messages (PRD §14, no fallback)", () => {
  // Each resource error must be surfaced with i18n-keyed copy.
  expect(GATEWAY_TSX).toContain('t("gateway.error.stats_failed"')
  expect(GATEWAY_TSX).toContain('t("gateway.error.channel_runtime_failed"')
  expect(GATEWAY_TSX).toContain('t("gateway.error.channels_failed"')
  expect(GATEWAY_TSX).toContain('t("gateway.workbench.bindings_load_failed"')
  expect(GATEWAY_TSX).toContain('t("gateway.compose.error"')
  // No silent catch-and-ignore (catch (err) { /* ignore */ }) anywhere.
  expect(GATEWAY_TSX).not.toMatch(/catch\s*\([^)]*\)\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/)
})

test("Gateway proposal exposes start-when-idle / Queue radio segmented control per candidate", () => {
  expect(GATEWAY_TSX).toContain('data-ui="gateway-proposal-queue-start"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-proposal-queue-queue"')
  // The choice is a radio group, not a dropdown (PRD §3 — "Do not use dropdowns
  // for small mutually exclusive choices").
  expect(GATEWAY_TSX).toMatch(/type="radio"\s+name=\{`gateway-queue-\$\{i\}`\}/)
})

test("Gateway proposal seeds queue choice from recommended_queue and lets users include/exclude", () => {
  expect(GATEWAY_TSX).toContain("queue: c.recommended_queue")
  expect(GATEWAY_TSX).toContain("include: true")
  expect(GATEWAY_TSX).toContain('data-ui="gateway-proposal-include"')
})

test("Gateway proposal create call passes queue=true|false, never the original recommended_queue (PRD §8.3)", () => {
  // The createTask call must use the operator-chosen `s.queue`, not a default.
  expect(GATEWAY_TSX).toMatch(/createTask\(\s*\{[\s\S]*queue:\s*s\.queue/)
})

test("Gateway proposal createTask propagates per-candidate priority and executor (codex review P2)", () => {
  // Pre-fix the createTask call dropped candidate.priority and
  // candidate.executor — every created task fell back to project defaults
  // and broke the PRD's "Each proposed task ... priority / executor"
  // semantics. The fix must thread `c.priority` and (when provided)
  // `c.executor` through to createTask.
  expect(GATEWAY_TSX).toMatch(/createTask\(\s*\{[\s\S]*priority:\s*c\.priority/)
  expect(GATEWAY_TSX).toMatch(/c\.executor\s*\?\s*\{\s*executor:\s*c\.executor\s*\}/)
})

test("Gateway proposal refreshes the ledger on partial success (codex review P2)", () => {
  // When candidate #2 fails but candidate #1 succeeded, the operator
  // must still see the created task in the ledger immediately.
  // Pre-fix: refresh only ran when EVERY result was OK, so partial
  // success left the ledger stale.
  expect(GATEWAY_TSX).toMatch(/if \(out\.some\(\(r\) => r\.ok\)\)\s*\{[\s\S]*loadTasks\(\)/)
  expect(GATEWAY_TSX).not.toMatch(/if \(out\.every\(\(r\) => r\.ok\)\)\s*\{[\s\S]*loadTasks\(\)/)
})

test("Gateway proposal locks a candidate after creation to prevent duplicates (codex round-2 P2)", () => {
  // The retry flow must NOT re-create successful candidates. The fix
  // is a `createdTaskID` field on the candidate state + filtering it
  // out of the next `Create selected` batch.
  expect(GATEWAY_TSX).toContain("createdTaskID")
  expect(GATEWAY_TSX).toMatch(/states\(\)\.filter\(\(s\) => s\.include && !s\.createdTaskID\)/)
  // Per-row UI flips to a "created" badge so the operator sees the
  // lock and can copy the task id.
  expect(GATEWAY_TSX).toContain('data-ui="gateway-proposal-created"')
})

test("Gateway queue position uses queue.order, not creation order (codex review P3)", () => {
  // The `#n` badge on a queued task must reflect the backend queue
  // order so it agrees with the up/down move buttons. Pre-fix the
  // position came from creation-sorted visibleTasks(); this assertion
  // catches a regression back to that broken behavior.
  expect(GATEWAY_TSX).toMatch(/queuePosition[\s\S]*queuedItemsByDir\(\)\.get\(dir\)/)
})

test("Decompose composer cancels the in-flight LLM call when dismissed (codex round-3 P2)", () => {
  // Pre-fix: closing the composer left the streamText request running
  // at provider cost. The fix owns an AbortController and cancels on
  // discard / unmount.
  expect(GATEWAY_TSX).toContain("activeController = controller")
  expect(GATEWAY_TSX).toContain("onCleanup(() => cancelActive())")
  expect(GATEWAY_TSX).toMatch(/decomposeRequirement\(\s*\{[\s\S]*signal:\s*controller\.signal/)
  expect(GATEWAY_TSX).toMatch(/cancelActive\(\)/)
})

test("Gateway action errors render at the page level so non-workbench states can see them (codex round-3 P2)", () => {
  // Pre-fix: actionError only rendered inside GatewaySelectedTask;
  // a ledger or channel-action failure with no selected task was
  // invisible. The page-level banner closes that hole.
  expect(GATEWAY_TSX).toContain('data-ui="gateway-global-action-error"')
  expect(GATEWAY_TSX).toMatch(/<Show when=\{isGatewayPage\(\) && actionError\(\)\}>/)
  // The workbench MUST NOT duplicate the banner (single source — rule 8).
  expect(GATEWAY_TSX).not.toContain('data-ui="gateway-action-error"')
})

test("Gateway channel restart errors surface in the channel panel, not only the workbench (codex review P2)", () => {
  // Pre-fix the restart error was routed through the shared `actionError`
  // signal which only renders inside GatewaySelectedTask. With no task
  // selected the error was invisible. Fix: dedicated restartError state
  // + dedicated UI block in GatewayChannelPanel.
  expect(GATEWAY_TSX).toContain("setChannelRestartError(")
  expect(GATEWAY_TSX).toContain('data-ui="gateway-channels-restart-error"')
  expect(GATEWAY_TSX).toMatch(/restartError:\s*string/)
})

test("Gateway header offers Refresh, New requirement, and Back to Panel actions (PRD §7.1)", () => {
  expect(GATEWAY_TSX).toContain('data-ui="gateway-refresh"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-new-requirement"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-back"')
})

test("Gateway ledger exposes queue reorder controls for queued tasks (PRD §7.2)", () => {
  // Per PRD §7.2: "queued task ordering controls only for tasks that are
  // actually queued". The implementation uses up/down buttons; assert they
  // are wired and gated by canMoveUp / canMoveDown so non-queued rows
  // never render the controls.
  expect(GATEWAY_TSX).toContain('data-ui="gateway-ledger-move-up"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-ledger-move-down"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-ledger-start-now"')
  expect(GATEWAY_TSX).toMatch(/<Show when=\{props\.canMoveUp\}>/)
  expect(GATEWAY_TSX).toMatch(/<Show when=\{props\.canMoveDown\}>/)
  expect(GATEWAY_TSX).toMatch(/<Show when=\{canStartNow\(\)\}>/)
  // The handler must call the existing reorderTaskQueue service — single
  // source of truth for queue ordering, no Gateway-private mirror.
  expect(GATEWAY_TSX).toContain('from "../services/task-queue"')
  expect(GATEWAY_TSX).toMatch(/await reorderTaskQueue\(\{[\s\S]*directory[\s\S]*orderedTaskIDs/)
  expect(GATEWAY_TSX).toMatch(/await startQueuedTaskNow\(taskID\)/)
})

test("Gateway channel side panel exposes runtime restart action and surfaces errors (PRD §10)", () => {
  expect(GATEWAY_TSX).toContain('data-ui="gateway-channels-restart"')
  expect(GATEWAY_TSX).toContain('data-ui="gateway-channels-bindings"')
  // Runtime block surfaces its own error; restart failures land in the
  // shared workbench actionError banner.
  expect(GATEWAY_TSX).toContain('t("gateway.error.channel_runtime_failed"')
})

test("Gateway service uses the dedicated /gateway/task/decompose endpoint (single source — no fallback to other endpoints)", () => {
  expect(SERVICES_GATEWAY).toContain('apiJson(`gateway/task/decompose`')
  expect(SERVICES_GATEWAY).toContain('apiJson(`gateway/stats')
  expect(SERVICES_GATEWAY).toContain('apiJson(`channel/runtime')
  expect(SERVICES_GATEWAY).toContain('apiJson(`channel/runtime/restart')
  expect(SERVICES_GATEWAY).toContain('apiJson(`task/${encodeURIComponent(taskID)}/bindings')
})

test("loadTaskBindings throws on non-array server body (rule 7 — no silent fallback)", () => {
  // Catch the regression where a flaky server response (HTML error page,
  // empty 204, etc.) was silently coerced to []. Either the server keeps
  // returning a real array or the operator sees the error block.
  expect(SERVICES_GATEWAY).toContain("loadTaskBindings: server returned non-array body")
  expect(SERVICES_GATEWAY).not.toMatch(/if \(!Array\.isArray\(data\)\)\s*return \[\]/)
})

test("loadChannelList also throws on non-array body (codex review P2)", () => {
  // Same single-source contract for the channels list — pre-fix it
  // coerced any non-array response to [] which hid contract drift.
  expect(SERVICES_GATEWAY).toContain("loadChannelList: server returned non-array body")
  expect(SERVICES_GATEWAY).not.toMatch(/return Array\.isArray\(data\) \? \(data as ChannelInfo\[\]\) : \[\]/)
})

test("Gateway page-mode keeps the page route in CSS and gates heavy hidden DOM", () => {
  expect(GATEWAY_CSS).toContain('body[data-page-mode="gateway"] .gateway-mount')
  expect(GATEWAY_CSS).toContain('body[data-page-mode="gateway"] > main.panel')
  expect(GATEWAY_TSX).toMatch(/<Show when=\{isGatewayPage\(\)\}>[\s\S]*<GatewayTaskLedger/)
  expect(GATEWAY_TSX).toContain("active={isGatewayPage()}")
  expect(GATEWAY_TSX).toMatch(/<Show when=\{props\.active\}>[\s\S]*<GatewaySelectedTask/)
  expect(GATEWAY_TSX).toMatch(/<Show[\s\S]*when=\{props\.composerOpen\}[\s\S]*<GatewayComposer/)
})

test("Gateway resources gate on directory + page mode (no DirectoryRequiredError on cold boot)", () => {
  // Pre-fix: Gateway resources fired immediately on mount, which on
  // cold boot hit project-scoped routes without an injected directory
  // and surfaced DirectoryRequiredError. The fix: createResource
  // sources read settingsStore.directory AND isGatewayPage() and park
  // the fetcher until both are truthy.
  expect(GATEWAY_TSX).toContain("const gatewayDirectory = ()")
  expect(GATEWAY_TSX).toMatch(/const onGatewayPage = isGatewayPage\(\)[\s\S]*if \(!onGatewayPage\) return null/)
  expect(GATEWAY_TSX).toMatch(/createResource\(\s*gatewayDirectory/)
})

test("Gateway task bindings only load while the Gateway page owns the channel panel", () => {
  // Gateway is always mounted beside the conversation panel. Bindings are
  // only visible inside the Gateway channel panel, so selected-task changes
  // in the conversation page must not trigger hidden /bindings work.
  expect(GATEWAY_TSX).toContain("const onGatewayPage = isGatewayPage()")
  expect(GATEWAY_TSX).toMatch(/return onGatewayPage && taskID \? taskID : null/)
})

test("loadGatewayStats receives the directory explicitly (belt-and-braces over apiJson auto-injection)", () => {
  expect(GATEWAY_TSX).toMatch(/loadGatewayStats\(\{\s*directory\s*\}\)/)
})

test("Gateway page keeps the titlebar visible so the Tauri window stays draggable", () => {
  // Pre-fix: `body[data-page-mode="gateway"] > .titlebar { display: none }`
  // stranded the operator — the titlebar owns the drag region and the
  // OS window controls. This guard catches a regression back to that
  // broken behavior. Only the work area (.panel) flips visibility.
  expect(GATEWAY_CSS).not.toMatch(/body\[data-page-mode="gateway"\]\s*>\s*\.titlebar/)
})

test("Gateway CSS does NOT override body background (window-opacity single source)", () => {
  // `body { background }` is owned by the cascade's `--body-bg` token,
  // which honours `--ui-window-opacity`. Pre-fix the gateway page set
  // `body[data-page-mode="gateway"] { background: var(--surface-base) }`
  // which (a) referenced a non-existent token, and (b) broke the
  // operator's window-opacity slider. This guard catches regressions
  // back to either mistake.
  expect(GATEWAY_CSS).not.toMatch(/body\[data-page-mode="gateway"\]\s*\{[^}]*background/m)
  expect(GATEWAY_CSS).not.toContain("var(--surface-base")
})

test("Gateway column surfaces reuse the panel's translucent tokens (matches overlay vibrancy)", () => {
  // The Gateway shell must NOT use opaque colors that block the
  // window-opacity / Tauri vibrancy effect. Verify each column lands on
  // the same surface family the panel uses.
  expect(GATEWAY_CSS).toMatch(/\.gateway-ledger\s*\{[\s\S]*background:\s*var\(--rail-surface\)/)
  expect(GATEWAY_CSS).toMatch(/\.gateway-workbench\s*\{[\s\S]*background:\s*var\(--surface\)/)
  expect(GATEWAY_CSS).toMatch(/\.gateway-channels\s*\{[\s\S]*background:\s*var\(--surface-inset\)/)
  // Header mirrors `.task-bar` chrome + theme-aware blur.
  expect(GATEWAY_CSS).toMatch(/\.gateway-header\s*\{[\s\S]*backdrop-filter:\s*var\(--task-bar-backdrop-filter\)/)
})

// ── Pure helper coverage ───────────────────────────────────────────

test("filterMatches honors the documented status taxonomy (PRD §9)", () => {
  // PRD §9 distinguishes six operator-facing categories; the filter
  // taxonomy must match. Pre-fix bug: "active" also matched "queued",
  // making the queue filter redundant. This guard pins the correct
  // strict mapping plus the new "waiting" category.
  const noPending = { pending_interactions: 0 }
  const withPending = { pending_interactions: 2 }

  expect(filterMatches("active", "all")).toBe(true)
  expect(filterMatches("queued", "all")).toBe(true)
  expect(filterMatches("cancelled", "all")).toBe(true)

  // active = strictly running, no pending interactions
  expect(filterMatches("active", "active", noPending)).toBe(true)
  expect(filterMatches("queued", "active", noPending)).toBe(false)
  expect(filterMatches("active", "active", withPending)).toBe(false)

  // queued
  expect(filterMatches("queued", "queued")).toBe(true)
  expect(filterMatches("active", "queued")).toBe(false)

  // waiting = any task with pending interactions, regardless of status
  expect(filterMatches("active", "waiting", withPending)).toBe(true)
  expect(filterMatches("queued", "waiting", withPending)).toBe(true)
  expect(filterMatches("active", "waiting", noPending)).toBe(false)

  // failed / completed / cancelled — strict
  expect(filterMatches("failed", "failed")).toBe(true)
  expect(filterMatches("active", "failed")).toBe(false)
  expect(filterMatches("completed", "completed")).toBe(true)
  expect(filterMatches("cancelled", "cancelled")).toBe(true)
  expect(filterMatches("active", "completed")).toBe(false)
})

test("statusIconFor maps every documented task status to a registered icon", () => {
  expect(statusIconFor("queued")).toBe("status-queued")
  expect(statusIconFor("active")).toBe("status-active")
  expect(statusIconFor("completed")).toBe("status-completed")
  expect(statusIconFor("failed")).toBe("status-failed")
  expect(statusIconFor("cancelled")).toBe("status-cancelled")
  expect(statusIconFor("idle")).toBe("status-idle")
  // Unknown statuses fall back to idle, matching the badge taxonomy in TaskList.
  expect(statusIconFor("anything-else")).toBe("status-idle")
})

test("runtimeLabel returns the i18n value for known statuses and the raw key for unknowns", () => {
  // Translated labels exist for the documented runtime states.
  for (const status of ["disabled", "unavailable", "starting", "running", "stopped", "error"]) {
    const label = runtimeLabel(status)
    expect(typeof label).toBe("string")
    expect(label.length).toBeGreaterThan(0)
    expect(label).not.toBe(`gateway.runtime.${status}`)
  }
  // Unknown statuses are returned verbatim so the operator at least sees the raw value.
  expect(runtimeLabel("rebalancing")).toBe("rebalancing")
})

test("compactDirectory keeps short paths intact and ellipsises deep paths", () => {
  expect(compactDirectory("")).toBe("")
  expect(compactDirectory("/a")).toBe("/a")
  expect(compactDirectory("/a/b/c")).toBe("/a/b/c")
  expect(compactDirectory("/a/b/c/d/e")).toBe("…/c/d/e")
  expect(compactDirectory("C:\\Users\\foo\\bar\\baz\\quux")).toBe("…/bar/baz/quux")
})

test("composeTaskText produces a markdown body the create task pipeline can consume", () => {
  const text = composeTaskText({
    id: "x",
    title: "Add login",
    description: "Wire up /login.",
    acceptance: ["Login form exists", "Form posts to /login"],
    priority: "high",
    recommended_queue: false,
    dependencies: ["base_route"],
    risks: ["Session cookies not yet wired"],
  })
  expect(text).toContain("# Add login")
  expect(text).toContain("Wire up /login.")
  expect(text).toContain("## Acceptance")
  expect(text).toContain("- Login form exists")
  expect(text).toContain("## Depends on candidates: base_route")
  expect(text).toContain("## Risks")
  expect(text).toContain("- Session cookies not yet wired")
})

// ── Round-1 design-review fixes ─────────────────────────────────────

test("Gateway ledger filter passes the full item to filterMatches (round-1 P0)", () => {
  // Pre-fix bug (round-1 design review): the product-code call site
  // dropped the third arg to filterMatches, so "waiting" never matched
  // and "active" silently included tasks with pending interactions —
  // a direct violation of PRD §9 strict status taxonomy. Unit tests of
  // the helper alone did not catch this because they exercised the
  // signature the helper expects; the bug lived in the call site.
  expect(GATEWAY_TSX).toContain("filterMatches(status, f, item)")
  expect(GATEWAY_TSX).not.toMatch(/filterMatches\(status,\s*f\)(?!\s*,)/)
})

test("Gateway ledger destructive actions go through useArmedConfirm (round-1 P0 — single source with TaskList)", () => {
  // Delete + cancel on the ledger row, plus the wide workbench cancel,
  // all reuse the shared `useArmedConfirm` hook to prevent a single
  // misclick from killing a running task or deleting history. Panel-side
  // TaskList already uses this hook; gateway must NOT re-implement
  // confirm gating (rule 8 single source, rule 11 reuse abstraction).
  expect(GATEWAY_TSX).toContain('from "../solid/armed-confirm"')
  expect(GATEWAY_TSX).toContain("confirmDelete.confirm(() => props.onDeleteTask(id()))")
  expect(GATEWAY_TSX).toContain("confirmCancel.confirm(() => props.onCancelTask(id()))")
  expect(GATEWAY_TSX).toContain("confirmWorkbenchCancel.confirm(() => props.onCancelTask(id()))")
  // Pre-fix call sites that did not go through the hook are gone.
  expect(GATEWAY_TSX).not.toMatch(/onClick=\{\(e\) =>\s*\{\s*e\.stopPropagation\(\)\s*props\.onDeleteTask\(id\(\)\)\s*\}\}/)
})

test("Gateway action banner translates the verb portion of the actionBusy key (round-1 P0)", () => {
  // Pre-fix the banner interpolated the raw "verb:id" key (e.g.
  // "cancel:tsk_01HZ…") into the operator-facing template. The fix:
  // actionVerbLabel(actionKey) splits on ":" and looks up
  // `gateway.error.action.<verb>` in i18n.
  expect(GATEWAY_TSX).toContain("function actionVerbLabel(actionKey: string): string")
  expect(GATEWAY_TSX).toContain('action: actionVerbLabel(actionError()!.action)')
  // The channel-restart action key uses `<verb>:<scope>` so the verb
  // resolves to a real i18n entry. Pre-fix this was "channel:restart"
  // which pulled the noun out as the verb.
  expect(GATEWAY_TSX).toContain('setActionBusy("restart:channel")')
})

test("Gateway error.action i18n covers every actionBusy verb used in the surface (round-1 P0)", () => {
  // Enumerate the verbs the surface actually emits and assert every
  // one has a translation. Missing keys would force actionVerbLabel
  // to fall through to the raw verb, which is itself a violation of
  // rule 7 — the page must render a real label, not a placeholder.
  // `send` was dropped in round-2 — message-send failures route through
  // their own notice (`messageNotice`), not through actionBusy / banner,
  // so the action verb registry never sees `send:*` at runtime. Keeping
  // a dead key here would be a rule-17 violation, even though the
  // template-literal static analyser would treat it as referenced via
  // the `gateway.error.action.` prefix.
  const verbs = ["cancel", "retry", "replan", "delete", "reorder", "restart"]
  for (const verb of verbs) {
    expect(I18N_ZH_CN).toContain(`"gateway.error.action.${verb}"`)
    expect(I18N_EN_US).toContain(`"gateway.error.action.${verb}"`)
  }
  // Regression guard: `send` must NOT come back.
  expect(I18N_ZH_CN).not.toContain('"gateway.error.action.send"')
  expect(I18N_EN_US).not.toContain('"gateway.error.action.send"')
})

test("Gateway ledger row meta classes have backing CSS (round-1 P0)", () => {
  // These class names were referenced in JSX but had zero CSS rules
  // pre-fix, so the queue position badge, dir chip and timestamp all
  // rendered as identical inline text. Each must now have at least
  // one CSS rule attached.
  const requiredClasses = [
    "gateway-ledger-row-queue-pos",
    "gateway-ledger-row-dir",
    "gateway-ledger-row-stamp",
    "gateway-workbench-goal-title",
    "gateway-workbench-goal-status",
    "gateway-workbench-interaction-text",
    "gateway-proposal-created",
    "gateway-proposal-results-actions",
  ]
  for (const cls of requiredClasses) {
    // JSX references the className.
    expect(GATEWAY_TSX).toContain(`"${cls}"`)
    // CSS declares at least one rule keyed on it (selector start or
    // descendant). Allow trailing space, comma, attribute selectors,
    // or pseudo-classes.
    const rule = new RegExp(`\\.${cls}(?![A-Za-z0-9_-])`)
    expect(GATEWAY_CSS).toMatch(rule)
  }
})

test("Gateway armed-confirm visuals exist for the destructive buttons (round-1 P0)", () => {
  // The button primitive consumes `--oc-button-*` custom properties,
  // and the gateway CSS must drive those when data-confirm="true" is
  // set — otherwise the armed state has no visible affordance.
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-cancel"\]\[data-confirm="true"\]/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-delete"\]\[data-confirm="true"\]/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-workbench-cancel"\]\[data-confirm="true"\]/)
})

test("Gateway surface has :focus-visible rules for every interactive element (round-1 P0)", () => {
  // gateway.css had ZERO :focus-visible pre-fix, so keyboard users
  // could not see where focus landed. Mirror the focus density that
  // sidebar.css / conversation.css already publish. Each of the named
  // interactive surfaces below must own at least one focus-visible
  // selector.
  for (const sel of [
    "gateway-ledger-row-main",
    "gateway-filter-button",
    "gateway-scope-button",
    "gateway-ledger-search-input",
    "gateway-composer-textarea",
    "gateway-composer-executor-select",
    "gateway-workbench-message-input",
    "gateway-proposal-queue-option input",
    "gateway-proposal-include input",
    "gateway-action-error-dismiss",
  ]) {
    const rule = new RegExp(`\\.${sel.replace(/ /g, "\\s+")}(?:[^,{]*?):focus-visible`)
    expect(GATEWAY_CSS).toMatch(rule)
  }
})

// ── Round-2 design + visual review fixes ────────────────────────────

test("Gateway focus-visible outline uses --oc-border-width + ui-scale offset (round-2 P0)", () => {
  // Pre-fix Gateway was the only surface using a hard-coded
  // `outline: 2px solid var(--accent)` + `outline-offset: 2px` — twice
  // the thickness of every other surface and not scaled by ui-scale.
  // The new rule routes through the same token shape sidebar.css and
  // primitives/button.css use, so the focus ring is one consistent
  // density across the overlay.
  expect(GATEWAY_CSS).toContain("outline: var(--oc-border-width) solid var(--accent)")
  expect(GATEWAY_CSS).toContain("outline-offset: calc(1px * var(--ui-scale))")
  // No literal `2px` outline-DECLARATION lingers on the Gateway surface.
  // Strip comments before scanning so the bug-history note in the
  // round-2 fix comment ("pre-fix had `outline: 2px solid` …") doesn't
  // count as a real rule.
  const cssNoComments = GATEWAY_CSS.replace(/\/\*[\s\S]*?\*\//g, "")
  expect(cssNoComments).not.toMatch(/outline:\s*2px\s+solid/)
})

test("humanizeApiError is wired everywhere errorMessage used to drive display (round-2 P0)", () => {
  // The function itself now lives in utils/gateway-helpers.ts (round-3
  // P0 fix); the unit test at "humanizeApiError unwraps …" exercises
  // the behaviour. This guard makes sure every page-level surface
  // routes through it so the registry actually reaches the operator.
  expect(GATEWAY_TSX).toContain("humanizeApiError,")
  expect(GATEWAY_TSX).toContain("humanizeApiError(stats.error)")
  expect(GATEWAY_TSX).toContain("humanizeApiError(channels.error)")
  expect(GATEWAY_TSX).toContain("humanizeApiError(bindings.error)")
  expect(GATEWAY_TSX).toContain("setError(humanizeApiError(err))")
})

test("Gateway error.class i18n covers the documented server error classes (round-2 P0)", () => {
  for (const cls of [
    "DirectoryRequiredError",
    "InvalidDirectoryError",
    "WorktreeNotGitError",
  ]) {
    expect(I18N_ZH_CN).toContain(`"gateway.error.class.${cls}"`)
    expect(I18N_EN_US).toContain(`"gateway.error.class.${cls}"`)
  }
})

test("Gateway retry / replan are armed-confirm like cancel (round-2 P0)", () => {
  // Replan re-runs the architect (the most expensive LLM call in the
  // system) and retry re-executes a finished task on top of its
  // existing artifacts. Both are destructive enough to need the same
  // two-step affordance as cancel — round-2 design review P0-1.
  expect(GATEWAY_TSX).toContain("confirmLedgerRetry.confirm(() => props.onRetryTask(id()))")
  expect(GATEWAY_TSX).toContain("confirmWorkbenchRetry.confirm(() => props.onRetryTask(id()))")
  expect(GATEWAY_TSX).toContain("confirmWorkbenchReplan.confirm(() => props.onReplanTask(id()))")
  // Pre-fix retry / replan went through raw onClick to the action handlers.
  expect(GATEWAY_TSX).not.toMatch(/onClick=\{\(\) =>\s*props\.onRetryTask\(id\(\)\)\}/)
  expect(GATEWAY_TSX).not.toMatch(/onClick=\{\(\) =>\s*props\.onReplanTask\(id\(\)\)\}/)
})

test("Gateway armed-confirm CSS now covers retry / replan, not only cancel / delete (round-2 P0)", () => {
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-retry"\]\[data-confirm="true"\]/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-workbench-retry"\]\[data-confirm="true"\]/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-workbench-replan"\]\[data-confirm="true"\]/)
})

test("Gateway aria-label values route through i18n (round-2 P0)", () => {
  // Pre-fix the filter tablist + workbench actions toolbar had
  // hard-coded English aria-label strings, which produced English
  // screen-reader output under the zh-CN locale. The fix introduces
  // `gateway.ledger.filter_label` / `gateway.workbench.actions_label`
  // i18n entries and references them via t().
  expect(GATEWAY_TSX).toContain('aria-label={t("gateway.ledger.filter_label")}')
  expect(GATEWAY_TSX).toContain('aria-label={t("gateway.workbench.actions_label")}')
  // No bare-English aria-label literals left on the Gateway surface
  // (regression guard — pre-fix had `aria-label="Filter"` and
  // `aria-label="Task actions"`).
  expect(GATEWAY_TSX).not.toMatch(/aria-label="Filter"/)
  expect(GATEWAY_TSX).not.toMatch(/aria-label="Task actions"/)
  // Both i18n entries actually exist in both locales.
  expect(I18N_ZH_CN).toContain('"gateway.ledger.filter_label"')
  expect(I18N_EN_US).toContain('"gateway.ledger.filter_label"')
  expect(I18N_ZH_CN).toContain('"gateway.workbench.actions_label"')
  expect(I18N_EN_US).toContain('"gateway.workbench.actions_label"')
})

test("Gateway selection reveals the workbench before the board fetch settles (round-2 P0)", () => {
  // Pre-fix `hasSelection` required BOTH selectedTaskID and a
  // fully-loaded board, so a slow `/task/:id/board` response left
  // the workbench stuck on the empty placeholder even after the
  // operator clicked a row. The fix lets it render as soon as the
  // ledger row is available (boardStore.tasks already has it).
  expect(GATEWAY_TSX).toMatch(
    /hasSelection\s*=\s*\(\)\s*=>\s*\n?\s*!!boardStore\.selectedTaskID\s*&&\s*\(!!selectedItem\(\)\s*\|\|\s*!!selectedBoard\(\)\)/,
  )
})

test("narrow-breakpoint hides channels with parent-scoped specificity (round-2 P0)", () => {
  // The base `.gateway-channels { display: flex }` rule sits later in
  // the source than the @media block, so the bare `.gateway-channels
  // { display: none }` rule inside @media lost the cascade tie and CSS
  // grid auto-placement wrapped the channel column onto a new row of
  // the ledger column. The fix bumps specificity by prefixing the
  // parent `.gateway-body` selector. Same logic applies to the
  // narrower 760px breakpoint that hides the ledger.
  expect(GATEWAY_CSS).toMatch(/\.gateway-body \.gateway-channels\s*\{[^}]*display:\s*none/)
  expect(GATEWAY_CSS).toMatch(/\.gateway-body \.gateway-ledger\s*\{[^}]*display:\s*none/)
})

test("Gateway count chip 'consumed' tone is declared once for completed and cancelled (round-2 P1)", () => {
  // Round-2 design review P1-5 — the two terminal statuses shared the
  // identical color-mix / color pair but were declared in two separate
  // selector blocks. Pattern hoist (rule 9) consolidates them.
  expect(GATEWAY_CSS).toMatch(
    /\.gateway-count\[data-status="completed"\],\s*\n\s*\.gateway-count\[data-status="cancelled"\]\s*\{/,
  )
})

test("Gateway monospace font stack routes through the --mono token (round-2 P1)", () => {
  // Round-2 design review P1-6 — gateway.css was the last surface
  // file with a hard-coded `ui-monospace, "SFMono-Regular", "Menlo",
  // monospace` literal. design-language.css owns `--mono` as the
  // single source.
  expect(GATEWAY_CSS).not.toMatch(/font-family:\s*ui-monospace,\s*"SFMono-Regular"/)
  expect(GATEWAY_CSS).toMatch(/font-family:\s*var\(--mono\)/)
})

// ── Round-3 fixes ───────────────────────────────────────────────────

test("humanizeApiError unwraps ApiError-wrapped class names end-to-end (round-3 P0)", async () => {
  // Round-2 shipped a humanizeApiError that grepped `^<Class>:` only and
  // never matched the wrapped `API <code> <path>: <Class>: <detail>`
  // string that overlay's ApiError actually produces. The round-3
  // visual review caught the regression because the existing test only
  // grepped for the function name's presence — never invoked it with a
  // real ApiError. THIS test does the round-trip: build a real
  // ApiError that mirrors what the network layer constructs, run the
  // helper, assert the translation matches the i18n entry.
  const { humanizeApiError } = await import("../src/utils/gateway-helpers")
  const { ApiError } = await import("../src/services/api")
  const { setLocaleData } = await import("../src/utils/i18n")
  // Inject the live locale fixture so the i18n lookup actually resolves.
  // Bun's test runner cannot fetch the locale JSON at module load, so
  // without this seed `t()` returns the raw key and the regression net
  // would only check fallback behaviour, not the success path.
  const enUS = JSON.parse(I18N_EN_US) as Record<string, string>
  setLocaleData("en-US", enUS)
  const wrapped = new ApiError(500, "gateway/stats?directory=%2FUsers%2Foperator", {
    error: "DirectoryRequiredError: gateway/stats requires ?directory= query param",
  })
  const text = humanizeApiError(wrapped)
  expect(text).toBe(enUS["gateway.error.class.DirectoryRequiredError"])
  // The raw class name and the encoded path MUST NOT leak through.
  expect(text).not.toContain("DirectoryRequiredError")
  expect(text).not.toContain("%2F")
  expect(text).not.toContain("API 500")
  // Unknown classes fall through to the raw message (capped at 240 chars).
  const unknown = new ApiError(500, "x", { error: "MysteryBananaError: unexpected stem fracture" })
  const unknownText = humanizeApiError(unknown)
  expect(unknownText).toContain("MysteryBananaError")
})

test("humanizeApiError lives in gateway-helpers so the unit test can call it (round-3 P0)", () => {
  // Pre-fix the function lived inside Gateway.tsx where the unit test
  // could not invoke it without booting the full Solid runtime. Move
  // it to helpers so behaviour, not source structure, is what the
  // regression net catches (rule 28 / 36).
  const helpers = readFileSync(join(import.meta.dir, "../src/utils/gateway-helpers.ts"), "utf8")
  expect(helpers).toContain("export function humanizeApiError")
  expect(GATEWAY_TSX).toContain(`humanizeApiError,
  pendingInteractions,`)
})

test("Discard proposal clears both proposal and the composer requirement (round-3 P1)", () => {
  // Pre-fix `handleProposalCleared` only cleared the proposal — the
  // requirement signal kept the previous text and the operator
  // returned to a pre-filled composer. Both discard paths now treat
  // the iteration as throwaway.
  expect(GATEWAY_TSX).toMatch(
    /function handleProposalCleared\(\)\s*\{[\s\S]*?setProposal\(null\)[\s\S]*?setRequirement\(""\)[\s\S]*?setError\(""\)/,
  )
})

// ── Round-4 fixes ───────────────────────────────────────────────────

test("Gateway armed-confirm disarms when page-mode leaves gateway (round-4 P1)", () => {
  // Round-3 design review P1-1 — the Gateway component stays mounted
  // (CSS-driven page-mode toggle), so a plain useArmedConfirm hook
  // kept its armed state alive across Panel ↔ Gateway round trips
  // and would commit on the operator's first click upon return.
  // Wrap with useGatewayArmedConfirm so the createEffect on
  // isGatewayPage() forces a disarm the moment the page mode leaves.
  expect(GATEWAY_TSX).toContain("function useGatewayArmedConfirm(): ArmedConfirm")
  expect(GATEWAY_TSX).toMatch(/createEffect\(\(\) => \{\s*if \(!isGatewayPage\(\)\) confirm\.disarm\(\)/)
  // Every armed-confirm consumer in this file now goes through the
  // wrapper — the bare hook is only called once, inside the wrapper
  // itself. Count occurrences and assert that exactly one call sits
  // in the file (the inner construct that drives the wrapper).
  const bareCalls = [...GATEWAY_TSX.matchAll(/useArmedConfirm\(GATEWAY_CONFIRM_WINDOW_MS\)/g)]
  expect(bareCalls.length).toBe(1)
})

test("Gateway proposal Recommended pill carries an accent-tinted background (round-4 P1)", () => {
  // Pre-fix the recommended label was --text-muted + tiny on a
  // surface-strong card, which sank below operator-noticeable contrast.
  // Tinting it with the same accent palette the queue segmented control
  // uses walks the eye from the recommendation to the matching radio.
  expect(GATEWAY_CSS).toMatch(/\.gateway-proposal-recommended\s*\{[^}]*background:\s*var\(--accent-dim\)/)
  expect(GATEWAY_CSS).toMatch(/\.gateway-proposal-recommended\s*\{[^}]*color:\s*var\(--accent\)/)
})

test("Gateway proposal card has a data-created visual lock (round-4 P1)", () => {
  // Pre-fix the card wrote `data-created="true"` with no CSS hook, so a
  // fully-saturated card masqueraded as a still-selectable candidate.
  expect(GATEWAY_CSS).toMatch(
    /\.gateway-proposal-card\[data-created="true"\]\s*\{[^}]*opacity:\s*var\(--ui-opacity-subtle\)/,
  )
  expect(GATEWAY_CSS).toMatch(/\.gateway-proposal-card\[data-created="true"\]\s*\{[^}]*var\(--good\)/)
})

test("Gateway composer enforces the requirement char cap (round-4 P1)", () => {
  // 32k matches the server cap in packages/opencorvus/src/server/routes/
  // gateway.ts so the operator's textarea refuses further input instead
  // of letting the request fail at the network layer.
  const helpers = readFileSync(join(import.meta.dir, "../src/utils/gateway-helpers.ts"), "utf8")
  expect(helpers).toMatch(/export const GATEWAY_REQUIREMENT_MAX_CHARS\s*=\s*32_000/)
  expect(GATEWAY_TSX).toContain("maxLength={GATEWAY_REQUIREMENT_MAX_CHARS}")
  // Counter element exists and renders the live count.
  expect(GATEWAY_TSX).toContain('data-ui="gateway-composer-counter"')
  expect(GATEWAY_TSX).toContain('t("gateway.compose.length_counter"')
  expect(I18N_ZH_CN).toContain('"gateway.compose.length_counter"')
  expect(I18N_EN_US).toContain('"gateway.compose.length_counter"')
})

test("Gateway armed-confirm respects :disabled (round-4 P2)", () => {
  // Pre-fix the bright `--ui-opacity-full` rule on
  // [data-confirm="true"] beat the standard :disabled opacity, so a
  // button that became disabled mid-arm still looked active.
  // Adding :not(:disabled) lets the disabled tone win when the host
  // action transitions to a non-interruptable state.
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-cancel"\]\[data-confirm="true"\]:not\(:disabled\)/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-delete"\]\[data-confirm="true"\]:not\(:disabled\)/)
})

test("Gateway armed-confirm focus-visible carries the warn / bad tone (round-4 P2)", () => {
  // Pre-fix the generic `:focus-visible` rule painted every armed-confirm
  // button with an accent-coloured outline, which clashed with the
  // warm-tinted fill. Override the outline-color to match the button's
  // own danger / warn palette so the focus signal stays semantically
  // honest.
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-workbench-cancel"\]\[data-confirm="true"\]:focus-visible[\s\S]*outline-color:\s*var\(--warn\)/)
  expect(GATEWAY_CSS).toMatch(/\[data-ui="gateway-ledger-delete"\]\[data-confirm="true"\]:focus-visible[\s\S]*outline-color:\s*var\(--bad\)/)
})

test("Gateway workbench message section is sticky at the bottom (round-4 P1)", () => {
  // Long goals / interactions lists push the composer below the
  // viewport. Pinning it with `position: sticky; bottom: 0` keeps the
  // reply box reachable without scrolling all the way down.
  expect(GATEWAY_CSS).toMatch(/\.gateway-workbench-message\s*\{[^}]*position:\s*sticky/)
  expect(GATEWAY_CSS).toMatch(/\.gateway-workbench-message\s*\{[^}]*bottom:\s*0/)
})
