import { expect, test } from "bun:test"
import path from "node:path"

const overlayRoot = path.resolve(import.meta.dir, "..")

async function readSrc(rel: string): Promise<string> {
  return await Bun.file(path.join(overlayRoot, rel)).text()
}

// Regression for "req section not visible until manually clicked":
// the original SectionFrame ran a one-shot `onMount` that opened the
// `<details>` only when `phaseState === "active"` at the exact moment of
// mount. Once the workflow advanced (requirements → architect → build),
// `phaseFor("requirements")` flipped from "active" to "" and the section
// stayed collapsed even though it just received fresh data.
//
// The fix has two parts that must both stay in place:
//   1. First-mount default = open whenever the section is visible — the
//      section only renders when taskScopeSections marks it visible (it
//      already has data or is in flight), so collapsing-by-default leaks
//      content from the operator.
//   2. A reactive `createEffect` on `phaseState` that re-opens the section
//      every time it transitions to "active" so re-entry (rewind, rework,
//      acceptance rejection that pushes the workflow back) re-surfaces the
//      live agent's content.
//
// Both behaviours must NEVER force-close the panel — once the user
// manually collapses, it must stay collapsed until the next phase flip.

test("SectionFrame imports createEffect alongside onMount", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // The fix needs both — onMount for the initial open, createEffect for the
  // reactive re-open on phase transitions. Dropping either reintroduces the
  // bug class the user reported.
  expect(board).toMatch(/import\s*\{[^}]*\bcreateEffect\b[^}]*\bonMount\b[^}]*\}\s*from\s*"solid-js"/)
})

test("SectionFrame onMount defaults to open when no defaultOpen is passed", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // The condition must fall back to `true` — not to `phaseState === "active"` —
  // so a section that becomes visible after its phase already completed (e.g.
  // requirements when architect is now running) still opens to show the data.
  expect(board).toContain("if (props.defaultOpen ?? true) detailsEl.open = true")
})

test("SectionFrame uses createEffect to re-open on phaseState transitions", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // The effect must read props.phaseState (so Solid tracks it) AND only
  // open — never close. The bug-class regression is "effect force-closes
  // when phase moves on, hiding the section the user is actively reading".
  const effectMatch = board.match(/createEffect\(\(\) => \{[\s\S]*?\}\);/)
  expect(effectMatch, "createEffect block must exist in SectionFrame").toBeTruthy()
  const effect = effectMatch?.[0] ?? ""
  expect(effect).toContain('props.phaseState === "active"')
  expect(effect).toContain("detailsEl.open = true")
  // No `detailsEl.open = false` anywhere in the effect — that would
  // override the user's manual collapse.
  expect(effect).not.toContain("detailsEl.open = false")
})

test("SectionFrame is the single source for section auto-open — no parallel logic in callsites", async () => {
  const board = await readSrc("src/components/Board.tsx")
  // None of the `<SectionFrame ...>` callsites should be passing
  // `defaultOpen={false}` to opt out — if a caller wanted a section
  // closed by default we'd be reintroducing the bug. Lock this to keep
  // the auto-open contract uniform.
  expect(board).not.toContain("defaultOpen={false}")
})
