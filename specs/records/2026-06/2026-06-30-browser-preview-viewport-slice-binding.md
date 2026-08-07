# Browser Preview Evidence Tool Convergence

Date: 2026-06-30

## Recall

- User request: fix the latest build agent visual evidence failure where
  `browser_preview_reference_regions` produced redundant screenshots and a
  white-looking side-by-side artifact; also explain why build no longer used a
  webpage screenshot MCP tool and repair the evidence tool surface
  systemically.
- Acceptance:
  - `browser_preview_reference_regions` produces exactly one module-level
    source/local comparison attachment for one local module binding.
  - The red source-context overlay is removed from that attachment.
  - `browser_preview_reference_regions` does not run a second true-size
    `reference-comparison` internally and does not auto-call any slice tool on
    bind failure.
  - `browser_preview_compare_scroll_slices` remains the explicit page-level
    first-viewport / scroll-slice comparison tool.
  - Build keeps Browser MCP tools available by default; normal screenshot,
    observe, navigation, and interaction should use Browser MCP when exposed.
    The build wrapper must not flip the SessionLoop default into
    MCP-disabled unless a caller explicitly passes `includeMcpTools: false`.
  - Bind failure is reported as a structured failed tool result; the build
    agent may separately call scroll-slice or screenshot tools for diagnosis,
    but those artifacts cannot substitute for a successful module binding.
- Hard constraints: no fallback, no compatibility alias, no host gate, no
  automatic slice fallback inside module binding, no git reset, preserve
  task-scoped backend preview target evidence as the single runtime source.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-06/2026-06-29-side-by-side-agent-tool-surface.md`
  - `specs/records/2026-06/2026-06-29-browser-preview-reference-regions-tool.md`
  - `specs/records/2026-06/2026-06-29-build-outcome-and-visual-evidence-repair.md`
  - `packages/opencorvus/src/agent/tool-pool-contract.ts`
  - `packages/opencorvus/src/build/agent.ts`
  - `packages/opencorvus/src/session/loop.ts`
  - `packages/opencorvus/src/mcp/browser/tools.ts`
  - `packages/opencorvus/src/mcp/browser/permission-plan.ts`
  - `packages/opencorvus/src/tool/browser-preview-reference-regions.ts`
  - `packages/opencorvus/src/tool/browser-preview-compare-scroll-slices.ts`
  - `packages/opencorvus/src/browser-preview/local-module-source-binding.ts`
  - `packages/opencorvus/src/browser-preview/region-comparison.ts`
  - `packages/opencorvus/src/browser-preview/scroll-slice-comparison.ts`
- Repository sweep:
  - `rg -n "webpage_screenshot|webpage_render|webpage_evaluate|browser_screenshot|browser_preview_reference_regions|browser_preview_compare_scroll_slices|includeMcpTools|MCP.tools|mcpPermissionPlan" packages/opencorvus/src packages/opencorvus/test specs/current specs/records/2026-06 -g "*.ts" -g "*.txt" -g "*.md"`
  - `rg -n "binding_puzzle|source_context|compare_bound_regions|bind_and_compare_local_module|referenceComparisonAttachmentImages|sourceBindingAttachmentImages" packages/opencorvus/src packages/opencorvus/test -g "*.ts"`
- Independent feedback source: user screenshot and follow-up clarified that one
  module comparison is enough; the source-context red box and second
  reference-comparison image are redundant and confuse build evidence.

## Failure

The latest US Markets build task did not blank the rendered page. The failed
artifact came from evidence-tool misuse and tool overloading:

- Source bbox: `x=0,y=0,width=1440,height=900`
- Implementation bbox: `x=0,y=0,width=1440,height=9397`
- Implementation route diagnostics: valid app page, HTTP 200, DOM present, and
  full page size `1440x9397`

The build agent used `browser_preview_reference_regions` with a source
first-viewport slice and a local `data-oc-region="us-markets-page-shell"`
locator. The combined tool then produced source-binding context, binding crop
comparison, and true-size `reference-comparison` output in one call. The
result looked like a white screen because a 900px source slice was stitched
beside a 9397px local page-shell crop.

`webpage_screenshot` was not called because that exact tool name is not the
current build tool surface. Browser MCP exposes browser screenshot / observe
capabilities through the MCP tool bridge. The real defect was that a
work-in-progress build wrapper change inverted the SessionLoop default by
passing `includeMcpTools: input.includeMcpTools === true`, which disabled MCP
for ordinary in-process build sessions unless the caller explicitly opted in.
That change conflicts with the intended MCP availability model: SessionLoop
loads MCP tools unless `includeMcpTools` is explicitly false.

## Repair Plan

1. Revert the diagnostic-image direction. Adding another crop-contract image
   would worsen the redundant screenshot problem.
2. Make `browser_preview_reference_regions` a single-purpose module binding
   comparison tool:
   - one input shape, no `compare_bound_regions` operation;
   - no internal call to `compareBrowserPreviewRegions`;
   - one module comparison attachment;
   - structured failed result when source/local binding cannot be produced.
3. Simplify local module binding artifacts:
   - keep source crop and implementation crop;
   - remove the red source-context overlay from the returned comparison image;
   - persist one module comparison image as source-binding evidence.
4. Preserve MCP availability for ordinary browser operation:
   - build passes `includeMcpTools: input.includeMcpTools`;
   - SessionLoop remains the single source for the default, where MCP is
     included unless explicitly disabled;
   - do not introduce a weaker `browser_preview_screenshot` duplicate.
5. Update build / visual QA prompts and replica squad overlay:
   - module evidence: `browser_preview_reference_regions`;
   - page or first-viewport comparison: `browser_preview_compare_scroll_slices`;
   - ordinary browser screenshot / observe / navigation: Browser MCP tools
     exposed through the current toolset.
6. Update tests so future changes cannot reintroduce the combined 2.5
   screenshot tool behavior.

## Verification

- Tool tests prove `browser_preview_reference_regions` returns exactly one image
  attachment and does not expose `compare_bound_regions`.
- Local module binding tests prove the module comparison image has no source
  context panel and only compares source crop against local crop.
- Build runtime tests prove build preserves the default MCP inclusion instead
  of requiring explicit opt-in.
- Prompt tests prove build chooses the correct evidence tool for module,
  page-slice, and ordinary screenshot tasks.
- Focused tests, typecheck, and docs link/health tests pass.
