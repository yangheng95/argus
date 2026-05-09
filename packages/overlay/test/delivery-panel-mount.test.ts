import { expect, test } from "bun:test";
import { readdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";

const overlayRoot = path.resolve(import.meta.dir, "..");

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text();
}

async function readJson(rel: string): Promise<Record<string, unknown>> {
  const raw = await Bun.file(path.join(overlayRoot, rel)).text();
  return JSON.parse(raw) as Record<string, unknown>;
}

function walkCss(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkCss(full));
    else if (entry.endsWith(".css")) out.push(full);
  }
  return out;
}

// Synchronous concatenation of all surface + cascade + primitive CSS.
// Tests that assert structural CSS properties use this instead of the
// deleted monolith src/styles.css.
function readAllSurfaceCss(): string {
  const root = path.join(overlayRoot, "src", "styles");
  return walkCss(root).map((f) => readFileSync(f, "utf8")).join("\n");
}

// Regression for "no delivery card visible during bench":
// commit beb81a2af (Scope delivery rejections and evidence cards) defined and
// exported `DeliveryPanel` in components/Board.tsx, but the component was
// never imported or rendered anywhere — so even though the bench server kept
// emitting `delivery.ready` / `delivery.evidence.updated` and the board
// hydrated `candidateDelivery.evidenceManifest`, the overlay UI rendered no
// delivery card at all. This suite locks both the structural wiring and the
// redesigned panel's verdict-driven behavior in place.

test("index.html declares one Inspector tab mount owned by Board", async () => {
  const html = await readSrc("src/index.html");
  expect(html).toContain('id="solidRightPanelTabs"');
  expect(html).toContain('id="rightPanelWorkflow"');
  expect(html).toContain('id="solidAgentWorkflowMount"');
  expect(html).toContain('id="rightPanelInspector"');
  expect(html).toContain('id="solidBoardMount"');
  expect(html).not.toContain('id="solidInteractionMount"');
  expect(html).not.toContain('id="solidDeliveryMount"');
  expect(html).not.toContain('id="solidFilesSectionMount"');
  expect(html).toContain('id="rightPanelPreview"');
  expect(html).toContain('id="solidFrontendPreviewMount"');
});

test("index.html does not declare the rejected single InspectorPanel root", async () => {
  const html = await readSrc("src/index.html");
  expect(html).not.toContain('id="solidInspectorPanelMount"');
});

test("Board keeps delivery before files inside the unified Inspector stack", async () => {
  const board = await readSrc("src/components/Board.tsx");
  expect(board).toContain('class="workflow-section-stack"');
  const deliveryAt = board.indexOf("<DeliveryPanel");
  const filesAt = board.indexOf("<FilesSection");
  expect(deliveryAt).toBeGreaterThan(-1);
  expect(filesAt).toBeGreaterThan(-1);
  expect(deliveryAt).toBeLessThan(filesAt);
});

test("Inspector workflow sections render as one contiguous stack", async () => {
  const css = await readSrc("src/styles/surfaces/inspector.css");
  expect(css).toMatch(/\.workflow-section-stack\s*\{/);
  expect(css).toMatch(/\.workflow-section-stack \.oc-section \+ \.oc-section\s*\{/);
  expect(css).toContain(".workflow-section-stack .oc-section[data-phase-state=\"active\"]");
});

test("main.tsx mounts the top-level right tabs and preview panel", async () => {
  const main = await readSrc("src/main.tsx");
  expect(main).toContain('document.getElementById("solidRightPanelTabs")');
  expect(main).toContain('document.getElementById("solidAgentWorkflowMount")');
  expect(main).toContain('document.getElementById("solidBoardMount")');
  expect(main).not.toContain('document.getElementById("solidDeliveryMount")');
  expect(main).not.toContain('document.getElementById("solidFilesSectionMount")');
  expect(main).toContain('document.getElementById("solidFrontendPreviewMount")');
  expect(main).toContain("<FrontendPreviewPanel");
  expect(main).toContain("nextTabForPreviewResolution");
  expect(main).not.toContain('import { InspectorPanel } from "./components/InspectorPanel"');
  expect(main).not.toContain("<InspectorPanel");
});

test("AgentWorkflowPanel renders a calm workflow map without high-energy effects", async () => {
  const component = await readSrc("src/components/AgentWorkflowPanel.tsx");
  // Workflow CSS now lives in surfaces/agent-workflow.css (styles.css was
  // dissolved 2026-05-04). The "/* Calm workflow map */" landmark comment
  // belonged to the monolith; we now read the dedicated surface file.
  const css = await readSrc("src/styles/surfaces/agent-workflow.css");
  expect(component).toContain('class="agent-workflow-orb"');
  expect(component).toContain('class="agent-workflow-beam"');
  expect(component).not.toContain("agent-workflow-card-aura");
  // The whole agent-workflow surface is the calm workflow map — assert
  // no high-energy effects appear anywhere in it.
  expect(css).not.toContain("@keyframes workflow-");
  expect(css).not.toContain("agent-workflow-card-aura");
  expect(css).not.toContain("drop-shadow");
  expect(css).not.toContain("backdrop-filter");
});

test("DeliveryPanel and DeliveryEvidenceGroup are exported from components/Board.tsx", async () => {
  const board = await readSrc("src/components/Board.tsx");
  expect(board).toMatch(/export\s+function\s+DeliveryPanel/);
  expect(board).toMatch(/export\s+function\s+DeliveryEvidenceGroup/);
  expect(board).toMatch(/export\s+function\s+deliveryPanelDelivery/);
});

test("DeliveryPanel has an in-flight projection while the run is in deliver before a delivery row exists", async () => {
  const board = await readSrc("src/components/Board.tsx");
  expect(board).toContain('const DELIVERY_PHASES = new Set(["deliver", "refine"])');
  expect(board).toContain('const LIVE_RUN_STATUSES = new Set(["queued", "accepted", "running", "blocked"])');
  expect(board).toContain('pending: true');
  expect(board).toContain('t("delivery.inflight.hint")');
  expect(board).toContain("if (hasActiveDeliveryRun(board())) return \"delivery\";");
  expect(board).toContain("<DeliveryPanel delivery={delivery()}");
});

test("DeliveryPanel drives chrome via [data-verdict] (not the lifecycle status mapping)", async () => {
  const board = await readSrc("src/components/Board.tsx");
  // Single attribute hook — both <section> and verdict-pill read the same tone.
  expect(board).toContain("data-verdict={tone()}");
  // The buggy lifecycle-as-verdict mapping must be gone — `delivery.status.*`
  // i18n keys belonged to the deleted `deliveryStatusLabel` helper.
  expect(board).not.toContain("delivery.status.candidate");
  expect(board).not.toContain("delivery.status.delivered");
  expect(board).not.toContain("delivery.status.failed");
  expect(board).not.toContain("delivery.status.publishing");
  expect(board).not.toContain("deliveryStatusLabel");
  expect(board).not.toContain("empty.delivery");
});

test("surface CSS maps verdict tone to the panel's pseudo-element left-edge accent", async () => {
  // delivery-panel chrome moved from styles.css to surfaces/inspector.css
  // (styles.css was dissolved 2026-05-04).
  const css = readAllSurfaceCss();
  // Per-tone left-edge colors — rejected MUST be red, accepted MUST be green.
  // The accent is a pseudo-element rail, not a decorative border, so the
  // right-panel no-border chrome contract and verdict semantics can coexist.
  expect(css).toMatch(/\.delivery-panel::before\s*\{[^}]*background:\s*var\(--delivery-panel-accent\)/);
  expect(css).toMatch(/\.delivery-panel\[data-verdict="accepted"\]\s*\{[^}]*--delivery-panel-accent:\s*var\(--good\)/);
  expect(css).toMatch(/\.delivery-panel\[data-verdict="rejected"\]\s*\{[^}]*--delivery-panel-accent:\s*var\(--bad\)/);
  expect(css).not.toMatch(/\.delivery-panel\s*\{[^}]*border-left\s*:/);
  // The deleted `.delivery-card` family must not survive — every theme
  // override at lines 9822 / 11890 / 12628 was migrated to `.delivery-panel`.
  expect(css).not.toMatch(/\.delivery-card\b/);
  expect(css).not.toMatch(/\.delivery-title\b/);
});

test("evidence rows reuse the shared .verdict-pill primitive — no per-row color rules", async () => {
  // verdict-pill primitive moved from styles.css to surfaces/inspector.css
  // (styles.css was dissolved 2026-05-04).
  const css = readAllSurfaceCss();
  const board = await readSrc("src/components/Board.tsx");
  // The shared primitive exists, with at least the four delivery tones.
  expect(css).toMatch(/\.verdict-pill\s*\{/);
  expect(css).toMatch(/\.verdict-pill\[data-verdict="accepted"\]/);
  expect(css).toMatch(/\.verdict-pill\[data-verdict="rejected"\]/);
  expect(css).toMatch(/\.verdict-pill\[data-verdict="inflight"\]/);
  expect(css).toMatch(/\.verdict-pill\[data-verdict="empty"\]/);
  // The legacy `.integrity__verdict` must be gone — IntegrityCard now
  // uses the same `.verdict-pill` primitive.
  expect(css).not.toMatch(/\.integrity__verdict\s*\{/);
  // DeliveryPanel renders its pills via the shared class, not a bespoke one.
  expect(board).toContain('class="verdict-pill"');
});

test("`delivery:focus-changes` event contract — DeliveryPanel dispatches, ChangesPanel listens", async () => {
  const board = await readSrc("src/components/Board.tsx");
  const changes = await readSrc("src/components/ChangesPanel.tsx");
  // Dispatch site (DeliveryPanel goal-pill / files-changed footer).
  expect(board).toContain('"delivery:focus-changes"');
  expect(board).toMatch(/window\.dispatchEvent\(\s*new CustomEvent\("delivery:focus-changes"/);
  // Listener side (ChangesPanel translates the event into setSelectedGroupID).
  expect(changes).toContain('"delivery:focus-changes"');
  expect(changes).toContain("addEventListener");
  expect(changes).toContain("setSelectedGroupID");
});

test("redesign-required i18n keys exist in both locales; the legacy lifecycle keys are gone", async () => {
  const en = await readJson("src/i18n/en-US.json");
  const zh = await readJson("src/i18n/zh-CN.json");
  const required = [
    "delivery.verdict.accepted",
    "delivery.verdict.rejected",
    "delivery.verdict.inflight",
    "delivery.verdict.empty",
    "delivery.iteration",
    "delivery.checks",
    "delivery.runtime",
    "delivery.reviews",
    "delivery.show_more",
    "delivery.show_less",
    "delivery.empty.hint",
    "delivery.inflight.hint",
    "right_panel.tabs",
    "right_panel.workflow",
    "right_panel.inspector",
    "right_panel.preview",
    "agent_workflow.title",
    "agent_workflow.output_report",
  ];
  // i18n keys are flat strings with literal dots, not nested paths — use
  // `key in obj` instead of toHaveProperty (which would mis-traverse).
  for (const key of required) {
    expect(key in en).toBe(true);
    expect(key in zh).toBe(true);
  }
  // Legacy lifecycle-as-verdict keys + old empty hint must be deleted (rule 17).
  for (const key of [
    "delivery.status.candidate",
    "delivery.status.delivered",
    "delivery.status.failed",
    "delivery.status.publishing",
    "empty.delivery",
  ]) {
    expect(key in en).toBe(false);
    expect(key in zh).toBe(false);
  }
});

test("evidence helpers do NOT silently truncate the row list (the old `.slice(0, 12)` is gone)", async () => {
  const board = await readSrc("src/components/Board.tsx");
  // The pre-redesign helper sliced the merged list to 12 rows. The new
  // per-group helpers must show every failed row — no integer-bounded
  // `.slice(0, N)` truncation in the delivery evidence helpers. (We pin
  // the literal `.slice(0, 12)` because that's the regression we just
  // killed; pinning it tighter than "any slice" avoids tripping on
  // unrelated `.slice(0, 6)` style truncations that can legitimately
  // appear in other helpers in this file.)
  expect(board).not.toContain(".slice(0, 12)");
});
