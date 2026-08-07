# Open-Source Acknowledgements — 2026-08-07

## Status

Complete. The English and Simplified Chinese READMEs now carry the same concise
acknowledgement set, led by OpenCode ancestry and followed by the product's
runtime, protocol, desktop, execution, packaged-runtime, workbench, built-in
capability, and documentation foundations.

## Recall

### User request

- The public repository will be rebuilt from the current `v0.0.35beta` source
  snapshot with Git history removed.
- Before that rebuild, analyze the important open-source projects used by
  OpenCorvus and thank them in the README.

### Acceptance criteria

- Credit projects that materially shaped the current source, provide a core
  runtime/framework/protocol, ship inside a release-critical capability, or
  are explicitly adapted as built-in content.
- State how each project contributes; do not paste the entire dependency graph
  or imply endorsement/affiliation.
- Put OpenCode ancestry and synchronized source ahead of ordinary dependencies.
- Keep English and Simplified Chinese READMEs semantically aligned.
- Make clear that a README acknowledgement does not replace license and NOTICE
  obligations in distributed artifacts.
- Preserve concurrent README release/download edits and all unrelated
  shared-worktree changes.

### Hard constraints

- `AGENTS.md` is binding; task plans and evidence live only under `specs/`.
- No Git-history deletion, repository recreation, visibility change, release,
  or external publication is part of this task.
- No User Interface (UI) code or UI automation test is involved.
- Commit subjects must begin with `dsw-33987`; stage only owned paths and push
  to the configured legacy remote without bypassing hooks.

### Materials read

- Root and package `package.json` files, both Cargo manifests, `bun.lock`,
  `docs/packaging.md`, build-artifact scripts, OfficeCLI runtime lock,
  built-in Skill provenance files, root READMEs, and current Git state/diffs.
- Source-level OpenCode provenance comments in Provider, GitHub Copilot,
  plugin, and utility code.
- Installed package metadata for the selected direct dependencies.
- Official OpenCode, Bun, Tauri, SolidJS, Kobalte, Vercel AI SDK, Hono,
  Drizzle ORM, Model Context Protocol, Agent Client Protocol, Playwright, CUA,
  OfficeCLI, and selected workbench/documentation project repositories.

### Whole-repository search

| Evidence                     | Result                                                                                                                                                                        | Decision                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Git root                     | The current ancestry begins with Kujtim Hoxha's original 2025 agent codebase history                                                                                          | Describe OpenCorvus as evolved from OpenCode rather than as an unrelated consumer              |
| Explicit OpenCode provenance | At least 34 current source files identify `anomalyco/opencode` or a fixed upstream OpenCode commit                                                                            | Give OpenCode a dedicated first acknowledgement and name the retained synchronized surfaces    |
| Runtime and server           | Bun is the pinned package manager/runtime/compiler; Vercel AI SDK, Hono, Drizzle ORM, MCP SDK, and ACP SDK are direct core dependencies                                       | Credit them as the runtime, streaming model, API, persistence, and interoperability foundation |
| Desktop                      | Tauri/Rust own the native desktop shell; SolidJS and Kobalte own the main renderer/primitives                                                                                 | Credit the desktop stack as one coherent group                                                 |
| Shipped capability closure   | Build scripts package CUA Driver; OfficeCLI has a pinned commit/license/hash lock; Playwright produces browser evidence; Node.js and ripgrep are copied into release runtimes | Credit these projects separately from development-only tools                                   |
| Interactive workbench        | CodeMirror, xterm.js, Mermaid, MapLibre GL JS, PDF.js, Reveal.js, Vega-Lite, Cytoscape.js, and Univer back visible artifact/editor surfaces                                   | Credit as a grouped workbench ecosystem to keep the README concise                             |
| Built-in adaptations         | Provenance files identify Leonxlnx Taste Skill and Matt Pocock Skills with upstream repositories and licenses                                                                 | Credit both as adapted built-in capability sources                                             |
| Documentation                | Astro and Starlight are direct documentation-site dependencies                                                                                                                | Credit them together rather than listing all transitive documentation packages                 |

### Independent-agent feedback

- None. The user did not request delegated or parallel agents; this task uses
  source evidence, package metadata, official upstream sources, and a separate
  self-review in the current session.

## Selection rule

An upstream is named in the README when it satisfies at least one of these
conditions:

1. Current code is derived or synchronized from it.
2. Removing it would replace a product-level runtime, desktop, server,
   persistence, protocol, or evidence boundary.
3. It is intentionally bundled or pinned as a release capability.
4. User-visible built-in content explicitly adapts it.

Ordinary utilities, transitive dependencies, type packages, build-only helpers,
and individual model-provider adapters remain discoverable from manifests and
release notices but do not enter the concise README list.

## Implementation plan

1. Add an `Open-source acknowledgements` section immediately before the root
   README license section, leading with OpenCode and grouping the remaining
   projects by product role.
2. Add the equivalent `开源致谢` section to the Chinese README with identical
   project coverage and meaning.
3. Validate Markdown formatting, links, bilingual single-source expectations,
   and the repository's document-health checks.
4. Review the final diff against manifests/provenance, update this evidence
   record with results, stage only the two READMEs and spec/index files, then
   commit and push.

## Verification evidence

| Check                      | Result                                                                                                                                                                                                                                   |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source/provenance review   | Confirmed every named project against a direct manifest, build/package path, fixed upstream marker, runtime lock, or built-in Skill provenance file.                                                                                     |
| Upstream link check        | All 29 unique GitHub project links returned Hypertext Transfer Protocol (HTTP) 200 on 2026-08-07.                                                                                                                                        |
| Bilingual parity           | English and Chinese acknowledgement sections each contain the same 29-link set; set difference is zero.                                                                                                                                  |
| Formatting                 | The new acknowledgement record and August index pass installed Prettier 3.6.2; both README acknowledgement sections were formatted with that same installed version. Existing download-table formatting outside this task was preserved. |
| `bun run typecheck`        | Passed: Software Development Kit (SDK) import check, Artificial Intelligence (AI) runtime check, and eight Turbo package typechecks.                                                                                                     |
| `bun run api:routes-check` | Passed: six rules and route inventory clean across 34 files.                                                                                                                                                                             |
| `bun run docs:check`       | Passed: 322 operations across 25 groups match generated documentation.                                                                                                                                                                   |
| `git diff --check`         | Passed with no whitespace errors.                                                                                                                                                                                                        |

The `historical-docs-links.test.ts`, `document-health.test.ts`, and
`product-docs-single-source.test.ts` paths named by the repository instruction
file do not exist in the current `22ee7bcf9a` source snapshot. Both the original
filters and Bun 1.3.14's suggested `./` path form matched no tests, so they are
recorded as unavailable rather than passed. No obsolete test was recreated.

## Self-review

- OpenCode is described as upstream ancestry because current Git history begins
  with its original codebase history and at least 34 current source files retain
  explicit OpenCode synchronization markers.
- Ordinary utilities and transitive packages remain outside the README. The
  selected projects each own a product-level boundary, a shipped capability, or
  an explicitly adapted built-in source.
- The acknowledgement text does not claim endorsement and explicitly preserves
  each project's independent license, trademark, and release-notice obligations.
- Concurrent release-download and changelog work was preserved; the final task
  diff adds only the acknowledgement sections and the required spec/index
  records.
