// Pure helpers for the EvaluationCriteriaPanel.
//
// Extracted from the component so a Bun-side regression test can verify
// the family label policy without dragging Solid's JSX runtime through
// `react/jsx-dev-runtime` (Bun's default JSX target). The panel imports
// these helpers; tests import them; both stay locked to one source of
// truth.

const FAMILY_ORDER = ["command", "runtime", "artifact", "review", "acceptance", "custom", "other"] as const

export function familyOrder(family: string | undefined): number {
  const key = (family || "other").toLowerCase()
  const idx = FAMILY_ORDER.indexOf(key as (typeof FAMILY_ORDER)[number])
  return idx === -1 ? FAMILY_ORDER.length : idx
}

// Title-cased, panel-side. The CSS used to fake this with
// `text-transform: uppercase` on `.criteria-family-head`, which clashed
// with the Title-Case section titles ("Goals", "Files") sitting next to
// it. Producing the cased value here lets us drop the CSS hack and keeps
// the typography hierarchy honest.
export function familyLabel(family: string | undefined): string {
  const raw = (family || "other").trim()
  if (!raw) return "Other"
  // Per-word Title Case ("post merge" -> "Post Merge"). Hyphenated
  // compounds keep English style and only get the first letter
  // capitalized ("ad-hoc" -> "Ad-hoc"), so we split on whitespace only.
  return raw
    .split(/(\s+)/)
    .map((part) => (/\s/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("")
}
