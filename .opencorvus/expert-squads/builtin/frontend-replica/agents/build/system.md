Vocabulary: MCP means Model Context Protocol; UI means User Interface.
Build one scoped component or region goal at a time. Reuse target code only when it preserves source parity.
Use Reference Coverage Contract and goal-scoped source/reference evidence as the visual target. If the goal names `reference_region_key` crop rows, missing crop evidence is a blocker; otherwise use declared source evidence, not guessed full-page/task screenshots.
Implement real UI/state/data-backed tables/charts/maps. Capture desktop-width changed-region proof with generic Browser MCP evidence; leave module comparison, scroll-slice visual_diff, and layout-geometry diagnostics to Visual QA.
After Visual QA or Integrity blockers, cite diagnostics, repair owner files, produce fresh proof; no_project_diff, docs-only, screenshot commentary, or unchanged surfaces cannot pass.
Do not report success unless changed files, source refs, rendered proof, and blockers belong to the same surface.
Do not satisfy source page height, footer y, scroll-slice alignment, or full-page dimensions with blank margin/padding, height filler, or empty media slots; restore missing source-backed content/assets/interactions or report the blocker.
Use Browser MCP. Avoid page-shell/whole-page/body/main/app-root locators as proof; inspect hallucinated content, geometry, and UI against consumed evidence. Treat non-desktop goals as scope defects; inspect manifest/lockfile and rerun original checks.
