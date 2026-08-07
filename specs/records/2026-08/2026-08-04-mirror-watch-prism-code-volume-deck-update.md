# Mirror Watch and Prism Code-Volume Deck Update

## Recall

- User request: compare the two supplied algorithm archives, `mirror-watch.zip` and `prism.zip`, with their current OpenCorvus implementations, quantify the code-volume change, and update `OpenCorvus-Expert-Organization-White-Animated-20260802.pptx`.
- Acceptance criteria: use the complete active project-owned code/text closure from each supplied ZIP rather than a selected core subset; make the platform reuse effect visible through total file count and source/knowledge byte volume; retain physical-line facts in the methodology notes; update the existing deck in its inherited visual system; render every final slide and visually inspect the result.
- Hard constraints: preserve unrelated untracked and concurrently modified files; use the existing presentation as the visual source; use `@oai/artifact-tool`; do not use `python-pptx` or direct Open XML mutation; retain a source copy; record non-trivial claims in speaker notes; commit with the `dsw-33987` prefix and push the main delivery branch to git-cc.
- Sources read: the supplied archives; `expert-squads/tanzeqi/mirror-watch/**`; `expert-squads/mirror/prism/**`; the current Prism and Mirror Watch architecture and audit records; the complete 23-slide source-deck render and layout inventory; the Presentations skill, style guidance, template-following contract, and imported-deck API references.
- Whole-repository search: `rg --files packages specs expert-squads | rg -i "mirror|prism"` located the current package implementations, tests, source-capability contract, and July/August design records. `rg -n -i "mirror-watch|mirror-prism|prism"` confirmed the current package identities and source-inventory decisions.
- Independent agent feedback: none; the user did not request multiple agents or parallel audit, so no sub-agent was started.

## Measurement Contract

The final measurement covers the entire active project-owned text/code closure in each supplied ZIP and the entire corresponding OpenCorvus expert-squad package. It includes Prompt, Agent, Workflow, Skill, Tool, scripts, templates, protocol/configuration files, knowledge references, generated project-owned report source, and other text-based implementation assets.

Only `.git`, `node_modules`, macOS metadata, package-lock files, binary media, and dependency/runtime caches are excluded. Text/code extensions and extensionless scripts are counted. The primary code-volume metric is exact bytes because the Mirror Watch archive contains large minified HTML/JSON documents whose physical line count is not comparable to formatted OpenCorvus sources. File count is the second primary metric; physical and non-blank lines remain disclosed as diagnostics.

## Results

| Algorithm | Metric | Supplied ZIP | OpenCorvus | Change |
| --- | ---: | ---: | ---: | ---: |
| Mirror Watch | Full text/code bytes | 16,295,690 | 1,699,695 | -14,595,995, **-89.6%** |
| Mirror Watch | Full text/code files | 242 | 169 | -73, **-30.2%** |
| Prism | Full text/code bytes | 2,823,952 | 686,203 | -2,137,749, **-75.7%** |
| Prism | Full text/code files | 291 | 126 | -165, **-56.7%** |

Diagnostic line counts are Mirror Watch 32,397 to 38,647 physical lines and 24,774 to 30,949 non-blank lines; Prism 51,061 to 13,388 physical lines and 40,267 to 11,226 non-blank lines. Mirror Watch's line increase is retained rather than hidden, but it is not the primary volume metric because the source archive's large minified documents compress many bytes into very few lines.

## Deck Plan

- Replace the existing Prism migration-evidence slide with a two-algorithm code-volume comparison using the same inherited two-column composition.
- Lead with the complete-package outcome: Mirror Watch shrinks 89.6% by byte volume and Prism shrinks 75.7%.
- Keep the corresponding full file-count reductions visible: 30.2% and 56.7%.
- Add the archive paths, repository package paths, exact byte/file/line totals, scope definition, and exclusions to the slide speaker notes as a `[Sources]` block.
- Preserve every other slide and the source deck's master, layouts, fonts, colors, and animation-bearing assets.

## Verification

- Re-run the full-closure file inventory and streaming physical-line counter and confirm every byte, file, physical-line, and non-blank-line total.
- Export the final presentation through `PresentationFile.exportPptx`.
- Render all 23 final slides, inspect each full-size slide, and run the presentation overflow checker.
- Run template fidelity and empty-placeholder checks against the copied source deck.
- Run the historical-doc links, document-health, and product-docs single-source tests required for the new record and index entries.

## Verification Results

- The full-closure inventory reproduced every archive/current byte, file, physical-line, and non-blank-line total above.
- Artifact Tool exported `C:\Users\hengu\Downloads\OpenCorvus-Expert-Organization-White-Animated-20260804.pptx`; the exported deck retains 23 slides and includes the measurement `[Sources]` block in slide 11 speaker notes.
- All 23 final slide PNGs were inspected individually at full size. Slide 11 preserves the inherited two-sided layout without clipping, overlap, or unexpected title wrapping.
- Template fidelity passed with zero issues. The overflow helper reports slide 7 because its inherited animated cyan top band extends beyond the canvas; the untouched source deck reports the same slide-7 condition, and the rendered audience area is visually intact.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts` passed: 70 tests, 0 failures.
