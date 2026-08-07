# Workspace Corner Tangent Repair

## Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Remove the remaining pointed mark at the Workbench upper-left corner shown inside the supplied red annotation while preserving the intended rounded desktop shell. |
| Acceptance criteria | The pale rail must meet one smooth 24-pixel white Workbench curve. The curve-to-left-edge tangent must have no pointed pixel cluster, detached gray tip, square shadow block, or second edge. Keep a quiet border stroke and restrained depth, and leave layout coordinates, clipping, children, and interactions unchanged. |
| Hard constraints | Desktop-only. Keep `.workspace-main` as the sole radius, fill, clipping, border-stroke, and depth owner. Do not add a wrapper, pseudo-element, mask, theme branch, fallback, state, gate, or User Interface (UI) automated test. Preserve concurrent work. Use the real current-source page, screenshots, and personal visual review. Commit subjects use the `dsw-33987` prefix and delivery pushes to `myhexin`. |
| Sources read | `AGENTS.md`; the supplied screenshot; `packages/overlay/src/components/App.tsx`; `workspace.css`; `design-language.css`; `header.css`; `conversation.css`; `specs/current/architecture/07-panel.md`; the August 3 workspace corner-border record; the August 4 inner-outline and depth-shadow records; and relevant Git history. |
| Whole-repository search | `App.tsx` mounts one `#workspaceMain`. `.workspace-main` remains the only production macro-frame compositor. The pane resizer is transparent at rest and does not paint the marked curve. The current boundary combines transparent physical borders, a negative-offset `outline`, and a two-channel `box-shadow`; no child header or Conversation surface owns the marked geometry. |
| Independent feedback | None. The user did not request sub-agents, and the current collaboration policy does not permit unsolicited delegation. |
| Workspace state | Existing uncommitted Overlay style, localization, architecture, record, and obsolete-UI-test deletion changes predate this repair. They are preserved and excluded from this task's commits unless they overlap the final architecture wording. |

## Cause Chain

1. The marked shape sits exactly at `.workspace-main`'s upper-left arc-to-left-edge tangent, not inside the Chat header or a message card.
2. The physical borders are transparent and therefore do not paint the mark. The adjacent pane resizer is also transparent at rest.
3. The visible stroke is a subpixel negative-offset CSS `outline`; the depth is a separate pair of rounded `box-shadow` channels. At the current 1.75 device scale, the outline and shadow are rasterized as independent edge layers and their alpha contours do not share one inner rounded clip at the tangent.
4. Earlier removal of the physical gray border eliminated the large outside wedge, but the later depth restoration reintroduced a second independently antialiased contour. The user's screenshot is evidence that the composed tangent is still not visually closed.
5. A zero-offset inset stroke inside the existing rounded surface shares the same border-radius clipping and box-shadow compositor as the depth channels. Replacing the independent outline with this inset stroke removes the competing tangent without changing the border box or sacrificing the requested depth.

## Complete Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `packages/overlay/src/components/App.tsx` | Preserve the sole Workbench shell, DOM order, and sibling layout. |
| `packages/overlay/src/styles/surfaces/workspace.css::.workspace-main` | Preserve transparent physical borders, the 24-pixel radius, fill, isolation, and clipping. Retire the separate outline and consume one rounded composite shadow contract. |
| `packages/overlay/src/styles/tokens/design-language.css` | Replace the depth-only token identity with one complete Workbench frame-shadow token containing an inset semantic border stroke followed by the two existing restrained depth channels. Do not keep an alias or add a second token family. |
| `packages/overlay/src/styles/cascade/*.css` | Preserve the canonical `--border` and `--ui-shadow-tone` theme sources; add no workspace theme forks. |
| `specs/current/architecture/07-panel.md` | Replace the obsolete outline-specific wording with the single rounded inset-stroke and confined-depth contract. |
| Existing UI tests | Do not add, modify, update, or run. Any obsolete UI automated tests already deleted by concurrent work remain deleted. |

## Verification Plan

1. Commit and push this plan before product edits without staging unrelated working-tree changes.
2. Replace the independent outline with one inset stroke inside the renamed complete Workbench frame-shadow token and update the current architecture source of truth.
3. Run Overlay TypeScript typecheck, production build, documentation health, and static integrity checks without running UI tests.
4. Reload the real current-source desktop page, capture the full shell and upper-left corner, inspect them personally, and tune only the single composite shadow if the tangent is still pointed or the depth/border disappears.
5. Review the exact task-owned diff, fetch the remote branch, commit with the required prefix, push to `myhexin`, and verify local/remote convergence.

## Progress

- [x] Inspect the supplied screenshot and reproduce the current shell in the real page.
- [x] Trace the marked pixels to the sole Workbench compositor and read the prior corner decisions.
- [x] Record Recall, cause chain, complete call-site disposition, and verification plan.
- [x] Commit and push the pre-change plan.
- [x] Implement the single-compositor tangent repair and update current architecture.
- [x] Complete non-UI checks and real-page visual review.
- [x] Complete final review.
- [x] Commit, push, and verify remote convergence.

## Real-Page Visual Evidence

The current-source Overlay was loaded from the existing Node-started Vite page
at `http://127.0.0.1:5173/` against the real backend at port 7878. No iframe,
query override, local signal, fixture, or UI automated test was used. The page
was reloaded after the Cascading Style Sheets (CSS) change and inspected at its
native 1280-by-720 desktop viewport and 1.75 device scale.

The final full page, exact corner crop, and nearest-neighbor four-times crop were
personally inspected:

- `.scratch/workspace-corner-tangent-full.png`
- `.scratch/workspace-corner-tangent-crop.png`
- `.scratch/workspace-corner-tangent-crop-4x.png`

The enlarged final crop shows one continuous soft curve with no pointed gray
cluster where the arc meets either straight edge. The inset border remains
visible inside the white surface, and the outside-left and inset-top depth remain
restrained. The supplied before image was independently cropped to
`.scratch/workspace-corner-user-before-4x.png`; its separate gray outline contour
at the marked tangent is absent from the final crop.

Browser-computed geometry confirms that the Workbench remains at
`x=382.0000305175781`, `y=36`, with the unchanged 24-pixel upper-left radius,
hidden overflow, and transparent 0.571429-pixel top and left borders. The
independent outline now resolves to `none`; the canonical shadow resolves to the
one-pixel inset border stroke followed by the unchanged outside-left and
inset-top depth channels.

## Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,073 modules; existing third-party module-directive and large-chunk warnings remain informational. |
| Historical links, product-document single source, and document health | Passed 70 tests and 1,188 assertions. The first default-timeout run recorded two scan-duration timeouts; the unchanged checks passed after rerunning with a 60-second runner timeout. |
| Static integrity | `git diff --check` passed. |
| Real-page visual review | Passed on the full desktop page and exact four-times corner crop. |
| UI automated tests | None added, modified, updated, or run. |

## Final Review

The task-owned diff contains only the Workbench surface rule, its canonical
design token, the current panel architecture, and this record. The sole DOM
owner, pane resizer, child surfaces, dimensions, overflow, isolation, and radius
remain unchanged. A whole-repository production search finds the retired
`--ui-workspace-depth-shadow` name only in the historical depth-restoration
record; current CSS defines and consumes exactly one
`--ui-workspace-frame-shadow` token with no alias or second source. No blocking,
high, medium, or low correctness issue remains in the reviewed diff.

## Delivery

Implementation commit `5bb1e2548b` was pushed to
`myhexin/work-v0.0.30beta-yr-0804`. The pre-push hook passed Software
Development Kit (SDK) imports, Artificial Intelligence (AI) runtime validation,
all scoped package typechecks, route inventory, generated documentation,
Overlay internationalization, and secret scanning. The final documentation-only
record commit is pushed on the same delivery branch, and local/remote commit
identity is verified after that push.

## User Correction: Exterior Paint Still Produces A Point

The user's post-delivery visual review supersedes the earlier acceptance: the
marked upper-left region still reads as a pointed corner. The previous repair
correctly removed the independently rasterized outline, but its cause chain was
incomplete because it retained the negative-offset outside-left depth channel.

### Revised Cause Chain

1. The inset border stroke now shares the Workbench clip and is not an exterior
   paint source.
2. The second frame-shadow layer still resolves to
   `-6px 0 24px -14px` without `inset`. It intentionally paints Workbench-owned
   translucent pixels outside the 24-pixel curve.
3. At the upper-left tangent those external pixels meet both the rail material
   and the clipped white surface. The combined contour can still terminate as
   a visible point even when the inset stroke itself is smooth.
4. The July 30 clean-corner evidence already proved the correct physical model:
   rail paint is the only material outside the curve, while left and top depth
   remain inside the clipped Workbench. The August depth-restoration change
   regressed that invariant by restoring an exterior left channel.
5. The root repair is therefore not another outline or opacity adjustment. The
   existing left depth channel must move inside the same rounded compositor as
   the stroke and top depth, with no exterior Workbench paint remaining.

### Revised Call-Site Disposition

| Owner or consumer | Correction |
| --- | --- |
| `design-language.css --ui-workspace-frame-shadow` | Keep one token and the current inset stroke; replace the exterior negative-offset left shadow with the previously proven inset left-edge geometry. Keep the inset top depth. |
| `workspace.css::.workspace-main` | Continue consuming the one frame token; preserve radius, transparent border-box geometry, fill, clipping, and isolation. |
| `App.tsx`, pane resizer, Conversation children | Preserve unchanged; none paints the external pointed pixels. |
| Current architecture | State the stronger invariant that every Workbench-owned frame/depth layer is clipped inside the macro surface and the rail is the sole outside paint. |
| UI automated tests | Do not add, modify, update, or run. Re-accept through the real page, exact crop, and personal visual review. |

### Revised Verification Plan

1. Commit and push this corrected diagnosis before the second product edit.
2. Convert only the left depth layer to inset geometry and update the current
   architecture contract.
3. Reload the real desktop page, capture the same corner at native resolution,
   inspect a nearest-neighbor enlargement, and confirm that no Workbench-owned
   paint exists outside the curve while depth remains visible inside it.
4. Rerun Overlay typecheck/build, documentation health, static integrity, and
   the complete pre-push hook without running UI tests.
5. Review the exact task-owned diff, commit, push to `myhexin`, and verify
   local/remote convergence.

### Correction Progress

- [x] Re-open the prior evidence and identify the retained exterior shadow.
- [x] Reconcile the current implementation with the July 30 clean-corner model.
- [x] Record the revised cause, call-site disposition, and verification plan.
- [x] Commit and push the corrected plan.
- [x] Move all Workbench-owned paint inside the rounded clip.
- [x] Complete real-page visual acceptance and non-UI validation.
- [x] Complete second review, commit, push, and remote convergence.

### Corrected Real-Page Evidence

The current-source Overlay was loaded in the real Node-started Vite page at
`http://127.0.0.1:5173/` with no iframe, query override, local signal, fixture,
or UI automated test. The unavailable-backend banner did not participate in the
shell boundary. The native 1280-by-720 page and its exact upper-left corner were
personally inspected at a 1.75 device scale:

- `.scratch/workspace-corner-inset-depth-full.png`
- `.scratch/workspace-corner-inset-depth-crop.png`
- `.scratch/workspace-corner-inset-depth-crop-4x.png`

The nearest-neighbor enlargement shows one clean white curve against the pale
rail with no exterior shadow contour or pointed termination. Browser-computed
style confirms the unchanged `24px 0 0` radius, hidden overflow, and no outline.
The three frame layers now resolve to a one-pixel inset stroke, an inset-left
`6px 0 24px -18px` depth channel, and an inset-top `0 6px 20px -14px` depth
channel. No Workbench-owned layer paints outside the rounded surface.

### Corrected Verification

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,073 modules; existing third-party module-directive and large-chunk warnings remain informational. |
| Historical links, product-document single source, and document health | Passed 70 tests and 1,188 assertions with the 60-second runner timeout. |
| Static integrity | `git diff --check` passed. |
| Production ownership search | Confirmed one `#workspaceMain`, one `.workspace-main` compositor, and one `--ui-workspace-frame-shadow` consumer; no second exterior frame owner was found. |
| Real-page visual review | Passed on the full desktop page and exact four-times corner crop. |
| UI automated tests | None added, modified, updated, or run. |

### Corrected Second Review

The correction changes only the canonical left-depth geometry and the matching
architecture invariant. Every layer in the sole frame token is now inset and
there is no alias, wrapper, pseudo-element, mask, fallback, or second paint
owner. The shell radius, border-box geometry, layout, children, clipping, and
interaction behavior remain unchanged. The exact task-owned diff has no
remaining correctness issue.

### Corrected Delivery

Corrected diagnosis commit `ec4787f13c` and implementation commit `4fafc078a2`
were pushed to `myhexin/work-v0.0.30beta-yr-0804`. The push hook completed its
full SDK import, AI runtime validation, scoped typecheck, route inventory,
generated-documentation, Overlay internationalization, and secret-scan checks.
Local and remote implementation commit identities both resolved to
`4fafc078a2982ff63765310edfa6c0aee208b106` before this final record commit.

## User Correction: Inset Depth Still Forms An Interior Wedge

The user's second post-delivery screenshot supersedes both earlier visual
acceptances. The corner still contains a visible pointed shape, now clearly
inside the white Workbench rather than outside its rounded clip.

### Final Cause Chain

1. The supplied 208-by-159 crop separates three paints: the pale rail at
   approximately `rgb(240 247 249)`, the white Workbench at `rgb(255 255 255)`,
   and a broad intermediate `rgb(247 247 247)` wedge inside the curve.
2. That intermediate region is too wide and uniform to be radius
   antialiasing. The real current-source page computes two directional inset
   layers on the Workbench: black at 4.8 percent along the left edge and black
   at 4.2 percent along the top edge, both with wide blur radii and negative
   spread.
3. At the upper-left radius those two inset gradients are clipped by the same
   curve and overlap. Their clipped L-shaped depth field tapers into the white
   surface, which is exactly the light-gray triangular point shown by the user.
4. Moving the left layer from outside to inside removed the exterior contour
   but did not remove the pointed depth geometry; it merely relocated the
   symptom. The previous acceptance crop was therefore misread.
5. A directional edge-depth effect cannot remain continuous through a rounded
   top-left corner without producing a tapered corner field. The root repair is
   to remove both directional depth layers from this boundary and retain only
   one zero-offset inset stroke whose contour follows the radius uniformly.

### Final Call-Site Disposition

| Owner or consumer | Final correction |
| --- | --- |
| `design-language.css` | Replace the three-layer frame-shadow token with one accurately named frame-stroke token containing only the zero-offset inset semantic border. Delete both directional depth layers and the obsolete token identity. |
| `workspace.css::.workspace-main` | Consume the single frame-stroke token; preserve the 24-pixel radius, transparent physical borders, fill, clipping, isolation, and layout. |
| `App.tsx`, rail, pane resizer, and children | Preserve unchanged; their geometry and paints do not produce the interior gray wedge. |
| Current architecture | State that the boundary has one uniform inset stroke and no directional corner depth field. |
| UI automated tests | Do not add, modify, update, or run. Use only the real page, exact region screenshot, and personal visual review. |

### Final Verification Plan

1. Commit and push this final diagnosis before changing product code.
2. Delete both directional Workbench depth layers, rename the sole token to its
   stroke-only meaning, update its only production consumer, and align the
   current architecture source of truth.
3. Reload the same real desktop page and inspect the exact upper-left corner at
   native resolution and nearest-neighbor enlargement. Confirm that the broad
   intermediate gray wedge is gone and only a uniform one-pixel arc remains.
4. Rerun Overlay typecheck/build, documentation health, static integrity, and
   the complete pre-push hook without running UI tests.
5. Review only the task-owned diff, commit and push to `myhexin`, and verify
   local/remote convergence while preserving concurrent toolbar changes.

### Final Correction Progress

- [x] Inspect the user's second screenshot and reject the prior acceptance.
- [x] Reproduce the current computed three-layer shadow on the real page.
- [x] Identify the two clipped directional inset gradients as the interior wedge.
- [x] Commit and push the final diagnosis.
- [x] Replace directional corner depth with one uniform inset stroke.
- [x] Complete real-page visual acceptance and non-UI validation.
- [ ] Complete final review, commit, push, and remote convergence.

### Final Real-Page Evidence

The real current-source Overlay remained loaded at
`http://127.0.0.1:5173/` in the Node-started Vite page. No iframe, query
override, local signal, fixture, or UI automated test was used. The exact
region supplied by the user was reproduced and then reviewed again after the
style update at the native 1280-by-720 viewport and 1.75 device scale.

- `.scratch/workspace-corner-stroke-only-full.png`
- `.scratch/workspace-corner-stroke-only-crop.png`
- `.scratch/workspace-corner-stroke-only-crop-4x.png`
- `.scratch/workspace-corner-stroke-only-user-region.png`

The user-sized 208-by-159 region and nearest-neighbor enlargement show one
continuous white quarter-circle against the pale rail. The broad light-gray
wedge is gone. Browser-computed style preserves the same Workbench rectangle,
`24px 0 0` radius, white fill, hidden overflow, and no outline; `box-shadow`
now resolves to only `rgba(32, 38, 40, 0.14) 0 0 0 1px inset`.

### Final Validation

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,073 modules; existing third-party module-directive and large-chunk warnings remain informational. |
| Historical links, product-document single source, and document health | Passed 70 tests and 1,188 assertions with the 60-second runner timeout. |
| Static integrity | `git diff --check` passed. |
| Production ownership search | Exactly one stroke token definition and one Workbench consumer remain; the retired frame-shadow and depth-shadow names have no production consumer. |
| Real-page visual review | Passed on the full page, four-times corner crop, and exact user-sized region. |
| UI automated tests | None added, modified, updated, or run. |

### Final Task Review

The task-owned product diff deletes both directional depth layers, renames the
single token to its stroke-only meaning, updates its sole consumer, and aligns
the current architecture contract. It does not change the radius, dimensions,
border box, layout, fill, clipping, isolation, children, or interactions. A
production search finds no second corner paint owner or stale production token
consumer. No remaining correctness issue was found in the reviewed diff.

## User Reference Correction: Uniform Exterior Elevation

The user's Codex reference screenshot supersedes the stroke-only acceptance
model above. It shows that removing the directional inset gradients is
necessary, but removing all depth is not the intended result: the complete
white Workbench is an elevated macro surface with one soft, continuous exterior
shadow above and to the left of its rounded corner.

### Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Restore the missing shadow along the Workbench's left and top boundaries, using the supplied Codex implementation as the visual reference. |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-14f1ca2b-85fd-4e7a-830b-4c2fb2dbf38b.png` shows the flat OpenCorvus boundary. `C:/Users/10132/AppData/Local/Temp/codex-clipboard-2b307b41-2601-4726-9b58-4382d9775e90.png` shows a white Codex macro panel floating over the pale rail with one diffuse exterior shadow that follows the rounded corner. Both images were inspected at original resolution. |
| Acceptance criteria | Keep the single 24-pixel upper-left radius and quiet inset stroke. Add a restrained, continuous, theme-aware exterior elevation whose blur follows the entire rounded contour and remains visible along both the top and left boundaries. Do not recreate the former internal gray wedge, pointed tangent, square backing block, or detached directional channels. Preserve geometry, clipping, child surfaces, and interactions. |
| Hard constraints | Desktop-only. `.workspace-main` remains the sole radius, fill, stroke, clip, and elevation owner. Use one semantic composite token driven by `--ui-scale`, `--border`, and theme-owned `--ui-shadow-tone`. Do not add a wrapper, pseudo-element, mask, theme branch, fallback, state, gate, or User Interface (UI) automated test. Preserve concurrent native-menu work. Use the real current-source page and Node-backed browser control for visual review. |
| Sources read | Root `AGENTS.md`; Browser control skill; both supplied screenshots; current `workspace.css`, `design-language.css`, `App.tsx`, `specs/current/architecture/07-panel.md`; this record's prior exterior, inset, and stroke-only diagnoses; current Git diff and recent delivery history. |
| Whole-repository grep | `App.tsx` mounts one `#workspaceMain`; `.workspace-main` is the only production Workbench macro-frame compositor. The current uncommitted stroke-only token is the direct cause of flatness. Theme cascades already provide one shared `--ui-shadow-tone`; no second surface or theme-specific implementation is required. |
| Independent feedback | None. The user did not request sub-agents, and the active collaboration policy prohibits unsolicited delegation. |

### Corrected Cause Chain

1. The observable OpenCorvus boundary is now flat because the in-progress
   correction reduced the complete frame contract to a single inset stroke.
2. The earlier defects came from separate left and top directional gradients.
   Their asymmetric blur fields either painted a pointed exterior tangent or
   overlapped inside the rounded clip as a triangular gray wedge.
3. The Codex reference does not use two visible directional fields. Its depth
   reads as the projection of one elevated rounded rectangle: a uniform shadow
   contour that naturally follows the same upper-left radius.
4. A conventional zero-horizontal-offset exterior shadow is continuous around
   the rounded border box, so it can expose soft depth above and to the left
   without manufacturing an L-shaped corner field.
5. The root correction is therefore one composite semantic frame token: the
   existing zero-offset inset stroke plus one restrained exterior elevation.

### Corrected Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `design-language.css` | Replace the temporary stroke-only token with one complete frame-elevation token containing the existing inset stroke and one conventional exterior shadow. Do not restore the deleted directional channels or keep an alias. |
| `workspace.css::.workspace-main` | Consume the one frame-elevation token while preserving radius, transparent physical borders, fill, clipping, isolation, and layout. |
| `App.tsx`, rail, pane resizer, and children | Preserve unchanged; none owns macro-surface elevation. |
| Current architecture | Define the Workbench as one elevated rounded compositor with a uniform inset stroke and one continuous exterior shadow; explicitly exclude split top/left gradients. |
| UI automated tests | Do not add, modify, update, or run. Accept through the real page, exact region screenshots, and personal visual review. |

### Corrected Verification Plan

1. Commit and push this corrected diagnosis without staging concurrent product
   or native-menu changes.
2. Implement the single composite frame-elevation token and align the current
   architecture source of truth.
3. Start the real current-source desktop page with Node, inspect the full shell
   and exact upper-left crop, and tune the one shadow if it is absent, too dark,
   too broad, square, or visually detached from the curve.
4. Run Overlay typecheck, production build, documentation health, static
   integrity, and the pre-push hook without running UI automated tests.
5. Review the exact task-owned diff, commit with the `dsw-33987` prefix, push to
   `myhexin`, and verify local/remote convergence.

### Corrected Progress

- [x] Inspect both user screenshots and reject the flat stroke-only result.
- [x] Reconcile the former directional-gradient defects with the Codex reference.
- [x] Record the corrected single-elevation model and verification plan.
- [x] Commit and push the corrected diagnosis.
- [x] Implement and visually tune the single exterior elevation.
- [x] Complete non-UI validation and final review.
- [x] Commit, push, and verify remote convergence.

### Uniform-Elevation Real-Page Evidence

The final current-source page was reloaded at `http://127.0.0.1:5173/` after
the concurrent requirements were reconciled. At the native 1280-by-720
viewport and 1.75 device scale, browser-computed style preserves the same
Workbench rectangle, white fill, hidden overflow, no outline, and `24px 0 0`
radius. Its complete frame now resolves to the one-pixel inset stroke followed
by one conventional `0 3px 24px -4px` exterior projection.

- `.scratch/workspace-corner-uniform-elevation-full.png`
- `.scratch/workspace-corner-uniform-elevation-user-region.png`
- `.scratch/workspace-corner-uniform-elevation-crop.png`
- `.scratch/workspace-corner-uniform-elevation-crop-4x.png`

The full page, exact 208-by-159 user region, and four-times crop were personally
inspected. The white surface retains restrained depth along the top and left,
the shadow contour follows the quarter-circle continuously, and neither the
former internal gray wedge nor a detached pointed tangent remains.

### Uniform-Elevation Review

The single exterior projection replaces both directional inset fields and does
not introduce a second owner, wrapper, pseudo-element, mask, theme branch,
fallback, or geometry change. The exact product diff changes only the canonical
frame token, its sole consumer, and the matching current architecture paragraph.
Concurrent native-menu, Rust, index, and obsolete UI-test deletion changes
remain outside this correction's delivery set. No remaining correctness issue
was found in the reviewed Workbench diff.

### Uniform-Elevation Delivery

Implementation commit `a18059f47c` was pushed to
`myhexin/work-v0.0.30beta-yr-0804`. The pre-push hook passed Software
Development Kit (SDK) imports, Artificial Intelligence (AI) runtime validation,
all scoped package typechecks, route inventory, generated documentation,
Overlay internationalization, and secret scanning. Local and remote branch tips
both resolved to `a18059f47c3aee185f6744d1c2adeedada85677a` before this final
record update.

## 2026-08-05 User Correction: The Edge Contour Is Still Pointed

The user's continued rejection supersedes the uniform-elevation visual
acceptance. Comparing the delivered OpenCorvus crop directly with the supplied
Codex reference shows that the remaining defect is the edge compositor itself,
not the direction of the shadow.

### Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Continue until the highlighted Workbench upper-left boundary no longer reads as a pointed or triangular corner. |
| Acceptance criteria | Match the reference's single crisp quarter-circle edge with restrained nearby elevation. No broad white or gray diagonal fade, doubled curve, detached tangent, or loss of top/left depth. Preserve the 24-pixel macro radius and all layout and interaction geometry. |
| Hard constraints | Desktop-only. Keep `.workspace-main` as the sole boundary owner. Use native Cascading Style Sheets (CSS) border and shadow composition with existing semantic theme sources. Do not add wrappers, pseudo-elements, masks, fallbacks, gates, state, local browser overrides, or UI automated tests. Use the real current-source page and exact-region screenshots for personal review. Commit subjects retain the `dsw-33987` prefix and push only to `myhexin`. |
| Sources read | The user's latest correction and highlighted crop; supplied Codex reference crop; current `workspace.css`, `design-language.css`, current panel architecture, prior corner repair record and commit history; real-page screenshots from each earlier attempt. |
| Whole-repository search | `.workspace-main` remains the only production Workbench radius/boundary owner. Its current outer top and left borders are transparent, while an inset box-shadow draws a second inner contour and a 24-pixel exterior blur—equal to the complete corner radius—draws the outer elevation. No child surface owns the marked geometry. |
| Independent feedback | None. The user did not request sub-agents, and unsolicited delegation is not permitted. |

### Edge-Contour Cause Chain

1. The Codex reference crop has one narrow gray contour on the actual outside
   quarter-circle, followed by a short, restrained fade into the rail.
2. OpenCorvus reserves a one-pixel transparent physical border, then recreates
   the line as an inset shadow. The transparent outer fill edge and the inset
   stroke are therefore two concentric rasterized curves rather than one edge.
3. The exterior projection uses a 24-pixel blur, the same size as the complete
   corner radius. Its fade occupies the whole quadrant instead of remaining an
   edge treatment, visually turning the curved transition into a broad diagonal
   wedge.
4. Changing the projection direction did not remove either structural cause,
   which is why the user's marked point remained through the previous repairs.
5. The root correction is to paint the already-reserved physical top and left
   borders with the semantic border color, delete the duplicate inset contour,
   and use one compact exterior elevation whose blur is materially smaller than
   the radius.

### Edge-Contour Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `workspace.css::.workspace-main` | Keep the same border box but paint its existing top and left borders with `--border`, so the visible line follows the actual outer radius exactly once. Preserve radius, fill, overflow, isolation, dimensions, and layout. |
| `design-language.css` | Rename the composite frame token to a single workspace-elevation token. Remove the inset stroke and replace the radius-sized projection with one compact semantic shadow. Do not keep the prior token alias. |
| `App.tsx`, rail, pane resizer, and children | Preserve unchanged; none owns the marked edge. |
| Current architecture | Replace the transparent-border/inset-stroke contract with one physical outer contour and compact exterior elevation. |
| UI automated tests | Do not add, modify, update, or run. Accept only through the real page and personal screenshot review. |

### Edge-Contour Verification Plan

1. Commit and push this corrected diagnosis before product edits.
2. Replace the doubled transparent-border/inset-stroke composition with one
   physical border and one compact semantic elevation; update the current
   architecture source of truth.
3. Reload the real desktop page, capture the full shell, exact user-sized
   region, and nearest-neighbor corner enlargement, then compare the edge width
   and fade directly with the Codex reference.
4. Rerun Overlay typecheck/build, documentation health, static integrity, and
   the complete pre-push hook without running UI tests.
5. Review the exact task diff twice, commit, push to `myhexin`, and verify local
   and remote convergence while preserving unrelated work.

### Edge-Contour Progress

- [x] Re-open the rejected result and Codex reference at original resolution.
- [x] Identify the doubled contour and radius-sized blur as the remaining cause.
- [x] Record the corrected cause chain, call-site disposition, and verification plan.
- [x] Commit and push the corrected diagnosis.
- [x] Implement the single physical contour and compact elevation.
- [x] Complete real-page visual acceptance and non-UI validation.
- [x] Complete second review, commit, push, and remote convergence.

### Edge-Contour Real-Page Evidence

The real current-source Overlay was loaded at `http://127.0.0.1:5173/` in the
Node-started Vite page. No iframe, query override, local signal, fixture, style
injection, or UI automated test was used. The full 1280-by-720 page and exact
marked region were inspected at a 1.75 device scale after each source edit.

- `.scratch/workspace-edge-before-region.png`
- `.scratch/workspace-edge-physical-compact-region-v2.png`
- `.scratch/workspace-edge-physical-compact-crop-v2.png`
- `.scratch/workspace-edge-physical-compact-crop-v2-4x.png`
- `.scratch/workspace-edge-physical-compact-full-v2.png`
- `.scratch/codex-reference-corner-crop-4x.png`

The final full page, user-sized region, nearest-neighbor enlargement, and Codex
reference crop were personally compared. The final white surface has one
continuous quarter-circle contour with no broad diagonal white/gray field and
no second inner curve. Top and left elevation remain visible but end close to
the physical edge. Browser-computed style confirms the unchanged `24px 0 0`
radius and Workbench rectangle, a single 0.571429-pixel physical border in
`rgba(32, 38, 40, 0.22)`, and one `0 2px 8px -2px` exterior projection at
7.2-percent black.

### Edge-Contour Validation

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed. |
| Overlay production Vite build | Passed after transforming 7,073 modules; existing third-party module-directive and large-chunk warnings remain informational. |
| Historical links, product-document single source, and document health | Passed 70 tests and 1,188 assertions with the 60-second runner timeout. |
| Static integrity | `git diff --check` passed. |
| Production ownership search | Exactly one `--ui-workspace-elevation` definition and one `.workspace-main` consumer remain; the superseded frame-elevation token has no production owner or consumer. |
| Real-page visual review | Passed on the full desktop page, exact marked region, four-times crop, and direct Codex-reference comparison. |
| UI automated tests | None added, modified, updated, or run. |

### Edge-Contour Second Review

The task-owned diff replaces transparent border paint with a semantic physical
border on the already-reserved top and left edges, removes the duplicate inset
stroke, narrows the sole projection from radius-sized 24 pixels to eight
pixels, renames the one token to its remaining responsibility, and aligns the
current architecture. The radius, border-box dimensions, layout, fill,
clipping, isolation, children, and interactions remain unchanged. A second
production search found no alias, parallel boundary owner, or stale production
consumer. No remaining correctness issue was found in the exact task diff.

### Edge-Contour Delivery

Implementation commit `6131ed8967` was pushed to
`myhexin/work-v0.0.30beta-yr-0804`. The pre-push hook passed Software
Development Kit (SDK) imports, Artificial Intelligence (AI) runtime validation,
all scoped package typechecks, route inventory, generated documentation,
Overlay internationalization, and secret scanning. The final record commit is
pushed on the same branch, followed by an explicit local/remote identity check.

## 2026-08-05 Packaged-Client Correction: Subpixel Contour Coverage

The user's screenshot from the latest packaged client supersedes the preceding
development-page acceptance. The compact elevation is present in the package,
but the upper-left arc still resolves as a sequence of high-contrast subpixel
steps at the packaged WebView's display scale.

### Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Continue the repair in the latest packaged client until the highlighted upper-left Workbench arc no longer reads as pointed. |
| Acceptance criteria | Preserve the existing 24-pixel macro radius and compact elevation. The physical arc must read as one continuous, quiet contour at desktop display scaling, without a dotted diagonal, isolated dark step, broad wedge, doubled curve, or geometry change. |
| Hard constraints | Desktop-only. Keep `.workspace-main` as the sole boundary owner. Do not add a wrapper, pseudo-element, mask, fallback, gate, state, theme branch, or User Interface (UI) automated test. Validate the real current-source page and the packaged desktop runtime visually. Preserve concurrent database-transfer and native-menu work. Commit subjects use `dsw-33987` and push only to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser control skill; the user's packaged-client screenshot and nearest-neighbor enlargement; the Codex reference screenshot; current and compiled `workspace.css` / `design-language.css`; `theme.ts`; `layout-tokens.ts`; Tauri build configuration; the complete prior repair record; and current Git history. |
| Whole-repository search | The production Vite asset contains the physical border and compact elevation, proving the previous source change entered the package. `.workspace-main` remains the single production contour owner. Radius, spacing, and typography participate in `--ui-scale`, while its current contour is the shared raw one-pixel border at 22-percent black. No child surface paints the marked arc. |
| Independent feedback | None. The user did not request sub-agents, and unsolicited delegation is not permitted. |

### Packaged-Runtime Cause Chain

1. The latest screenshot no longer contains the former radius-sized or split
   directional shadow. The package therefore loaded the corrected compact
   elevation; stale assets are not the cause.
2. The screenshot's 24-CSS-pixel radius occupies roughly 36 captured pixels,
   identifying the desktop WebView's approximately 150-percent raster scale.
3. The current semantic physical contour is still a raw one-CSS-pixel stroke
   in `--border-strong`. At a fractional device scale, its diagonal coverage
   alternates across device pixels while the straight segments are snapped.
4. Because the stroke uses a relatively high 22-percent black alpha, those
   alternating coverage values appear as separated dark steps. The shadow is
   compact and continuous underneath, but cannot repair the crisp border's
   discontinuous diagonal.
5. The prior real-page review ran at a different raster scale and therefore
   validated geometry but missed packaged-runtime coverage. The root repair is
   a Workbench-specific semantic contour with slightly wider low-alpha coverage,
   preserving the same perceived weight while giving the diagonal enough pixel
   coverage to remain continuous. The shared global border token must not change.

### Packaged-Runtime Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `design-language.css` | Add one complete Workbench contour token that owns its scale-aware width, solid style, and reduced semantic border alpha. Keep the existing compact elevation token unchanged. |
| `workspace.css::.workspace-main` | Consume the same contour token for the existing top and left physical borders. Preserve radius, fill, clipping, isolation, layout, and child ownership. |
| Shared `--oc-border-width` and theme border colors | Preserve unchanged so unrelated controls and dividers do not inherit a packaged-runtime corner fix. |
| Tauri `frontendDist` / Vite output | Preserve the single build path; verify the rebuilt asset contains the new contour contract before packaged launch. |
| Current architecture | Record that the macro contour uses wider low-alpha coverage to remain continuous under fractional desktop raster scales. |
| UI automated tests | Do not add, modify, update, or run. Use real-page and packaged-client screenshots with personal visual review. |

### Packaged-Runtime Verification Plan

1. Commit and push this corrected diagnosis before product edits, staging only
   this task record and preserving unrelated working-tree changes.
2. Implement the single Workbench contour token, update its sole consumer, and
   align the current architecture source of truth.
3. Inspect the real current-source page at native resolution, compare an exact
   corner crop against the current result, and tune only contour coverage if it
   becomes heavy or still appears stepped.
4. Build the production Vite asset, confirm the final package input contains
   the new token, build and launch the real desktop client, and personally
   inspect a native packaged-runtime screenshot and enlarged corner crop.
5. Run Overlay typecheck, documentation health, static integrity, and the full
   pre-push hook without running UI automated tests. Review only the task-owned
   diff twice, commit, push to `myhexin`, and verify remote convergence.

### Packaged-Runtime Progress

- [x] Inspect the latest packaged screenshot and reject the development-only acceptance.
- [x] Prove that the corrected compact elevation entered the package.
- [x] Trace the residual arc to fractional raster coverage of the physical border.
- [x] Record the corrected cause chain and verification plan.
- [x] Commit and push the corrected plan.
- [x] Implement and visually tune the semantic contour.
- [x] Complete packaged-runtime visual acceptance and non-UI checks.
- [x] Complete second review, commit, push, and remote convergence.

### Packaged-Runtime Visual Evidence

The real current-source page was loaded at `http://127.0.0.1:5173/` from a
Node-started Vite process. No iframe, query override, local signal, fixture,
style injection, or UI automated test was used. Browser-computed geometry
preserved the Workbench rectangle at `x=382`, `y=36`, its `24px 0 0` radius,
white fill, hidden overflow, and compact `0 2px 8px -2px` elevation. At device
scale one, Chromium quantized the new 1.5-pixel declaration back to one physical
pixel, proving that the ordinary-scale contour does not become heavier.

- `.scratch/workspace-contour-source-corner.png`

The production Vite build then generated `main-D0fWh-d-.css`; direct inspection
confirmed that it defines `--ui-workspace-contour` and that both physical edges
consume that single token. Cargo embedded that exact `dist-vite` directory into
a new Release executable before any packaged screenshot was taken.

The newly built `opencorvus-overlay.exe` was launched as a real Windows desktop
client, allowed to render its native WebView, captured from its actual window,
and then stopped by its verified process identity. The 1330-by-821 native
window, exact corner crop, and nearest-neighbor enlargement were personally
inspected:

- `.scratch/workspace-contour-packaged-window.png`
- `.scratch/workspace-contour-packaged-corner.png`
- `.scratch/workspace-contour-packaged-corner-8x.png`

The packaged enlargement shows one continuous low-alpha quarter-circle. Its
diagonal coverage no longer breaks into isolated dark steps, and both tangents
join their straight edges without a pointed cluster. The top and left lines
remain quiet; the compact exterior elevation remains present; and no interior
wedge, doubled contour, broad fade, square backing paint, or radius change was
introduced.

### Packaged-Runtime Validation

| Check | Result |
| --- | --- |
| Overlay production Vite build | Passed after transforming 7,073 modules in 1 minute 9 seconds; existing third-party module-directive and large-chunk warnings remain informational. |
| Overlay TypeScript typecheck | Passed with `tsc --noEmit`. TypeScript is the typed JavaScript language used by the Overlay source. |
| Production asset ownership | `main-D0fWh-d-.css` contains one contour definition and the two intended top/left consumers. |
| Tauri Release build | Passed in 9 minutes 11 seconds. The resulting 209,065,984-byte executable was written at `2026-08-05 20:45:04.934` with SHA-256 digest `54B62EC91B7688E108337631A61DE9C4DDCAB849975F4FA3357E8A7724EF905C`. SHA-256 means Secure Hash Algorithm 256-bit and identifies the exact reviewed binary. |
| Historical links and product-document single source | Passed all 10 contracts. |
| Document health | Passed 59 of 60 contracts. The sole repository-wide failure names three unrelated concurrent records already linked from the dirty monthly index but not yet tracked: Composer personal-model usage, Environment close-anchor follow, and large MySQL transfer statement closure. MySQL means My Structured Query Language. This task preserved those files and their index edits. |
| Current-source visual review | Passed on the full desktop page and exact corner crop. |
| Packaged-client visual review | Passed on the native Windows window, exact crop, and eight-times enlargement. |
| Static integrity | Task-owned `git diff --check` passed. |
| UI automated tests | None added, modified, updated, or run. |

### Packaged-Runtime Second Review

The task-owned product diff introduces one semantic contour token, replaces the
two raw Workbench border declarations with that token, and aligns the current
architecture paragraph. The shared border width, global theme colors, compact
elevation, radius, rectangle, layout, clipping, isolation, children, and
interactions remain unchanged. At device scale one the browser keeps one
physical contour pixel; the fractional desktop runtime receives sufficient
low-alpha coverage to close the diagonal. No alias, second paint owner, wrapper,
pseudo-element, mask, fallback, gate, or theme fork was introduced. Concurrent
database-transfer, provider, Composer, native-menu, localization, and unrelated
documentation work remains outside this task's delivery set.

### Packaged-Runtime Delivery

Implementation commit `5535f2be7f` was pushed to
`myhexin/work-v0.0.31beta-yr-0805`. Before that push, a concurrently created
scratch-only local commit and five previously staged MySQL files were removed
from the task history without deleting or overwriting their working-tree
content. The delivered implementation commit therefore contains exactly the
two Workbench style files, the current panel architecture, and this record.

The full pre-push hook passed Software Development Kit (SDK) imports,
Artificial Intelligence (AI) runtime validation, all scoped package typechecks,
route inventory, generated documentation, Overlay internationalization, and
secret scanning. Local and remote implementation identities both resolved to
`5535f2be7f001e64c24970fa1eab40d5764ada4a` after the push.

## 2026-08-05 User Correction: No Exterior Shadow

The user's annotated enlargement rejects the retained compact elevation. Both
red regions identify Workbench-owned translucent paint outside the top and left
physical contour. The prior packaged-runtime acceptance solved contour
continuity but incorrectly treated that exterior paint as required depth.

### Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Continue adjusting because the highlighted top and left areas still contain shadow. |
| Acceptance criteria | Keep the smooth 24-pixel rounded contour, but make the complete exterior region pure rail material with no Workbench shadow, glow, haze, or directional depth above, left of, or around the corner. Preserve all geometry, clipping, children, and interactions. |
| Hard constraints | Desktop-only. Keep `.workspace-main` as the sole radius and contour owner. Delete the obsolete elevation source instead of replacing it with a weaker shadow, `none` override, fallback, wrapper, pseudo-element, mask, gate, state, or theme branch. Do not add, modify, update, or run User Interface (UI) automated tests. Validate the real current-source page and a newly built Release desktop client visually. Preserve concurrent Provider, MySQL, Composer, Environment, Software Development Kit, web-documentation, and index work. Commit subjects use `dsw-33987`; push only to `myhexin`. |
| Sources read | Root `AGENTS.md`; the supplied annotated enlargement; current and production Workbench contour/elevation styles; current panel architecture; this complete correction record; current Git history and working-tree state. |
| Whole-repository search | `.workspace-main` consumes exactly one `--ui-workspace-elevation`; the token resolves to the visible `0 2px 8px -2px` exterior projection. The user-marked pixels align with that projection above and left of the physical border. No child, pane resizer, or rail layer owns those pixels. |
| Independent feedback | None. The user did not request sub-agents, and unsolicited delegation is not permitted. |

### No-Shadow Cause Chain

1. The latest packaged screenshot proves that the contour itself is now
   continuous; the highlighted defect is the lighter band outside it.
2. That band is directly produced by `box-shadow: var(--ui-workspace-elevation)`
   on the sole Workbench compositor. The token's conventional exterior shadow
   deliberately paints beyond the rounded border box.
3. The prior repair optimized the shadow's shape and raster coverage but kept
   the wrong product requirement: visible macro-surface elevation.
4. Reducing blur, opacity, spread, or offset would retain Workbench-owned paint
   in the region the user requires to be pure rail material and would repeat
   the same category of error.
5. The root correction is deletion: remove the elevation token and its sole
   consumer, leaving the scale-aware physical contour as the only Workbench
   paint at the boundary.

### No-Shadow Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `design-language.css` | Delete `--ui-workspace-elevation` completely. Preserve the single scale-aware contour token. |
| `workspace.css::.workspace-main` | Delete the sole `box-shadow` consumer. Preserve radius, contour, fill, overflow, isolation, dimensions, and layout. |
| Current panel architecture | Replace the compact-elevation contract with an explicit no-exterior-paint invariant: rail material owns every pixel outside the contour. |
| Production asset | Verify the rebuilt stylesheet contains the contour definition and no workspace-elevation definition or consumer. |
| UI automated tests | Do not add, modify, update, or run. Use only real-page and packaged-client screenshots with personal visual review. |

### No-Shadow Verification Plan

1. Commit and push this corrected requirement and diagnosis before product edits
   without staging or committing concurrent work.
2. Delete the elevation token and its sole consumer, update current architecture,
   and confirm production ownership search finds no remaining elevation path.
3. Inspect the current-source page and exact corner crop, confirming the exterior
   pixels are rail material immediately up to the physical contour.
4. Build production Vite assets and a new Tauri Release executable, launch the
   real desktop client, and personally inspect a native window screenshot and
   nearest-neighbor enlargement.
5. Run typecheck, documentation contracts, static integrity, and complete
   pre-push hooks without UI automated tests. Review the task diff twice, push
   to `myhexin`, and verify the delivered commits remain ancestors of the remote
   branch if concurrent work advances its tip.

### No-Shadow Progress

- [x] Inspect the user's annotated packaged-client enlargement.
- [x] Identify the retained elevation as the sole exterior paint source.
- [x] Record the corrected no-shadow requirement and root deletion plan.
- [x] Commit and push the corrected plan.
- [x] Delete exterior elevation and complete real-page visual review.
- [x] Complete Release packaged-client visual review and non-UI checks.
- [x] Complete second review, commit, push, and remote convergence.

### No-Shadow Visual Evidence

The real current-source page was reopened at `http://127.0.0.1:5173/` through
the existing Node-started Vite process. Browser-computed style for the actual
`.workspace-main` reported `boxShadow: none`, retained its `24px` radius,
hidden overflow, white fill, and one physical top/left contour pixel at device
scale one. The full page and exact corner crop were personally inspected:

- `.scratch/workspace-no-shadow-source-corner.png`

The production Vite build transformed 7,073 modules and generated
`main-CHYt5Rzd.css`. Direct asset inspection found two contour references—the
definition and its intended physical-edge consumers—and zero workspace
elevation references.

The first direct `cargo build --release` launch was rejected as evidence
because that binary still loaded the development address and rendered a
localhost connection error. The official `bun run tauri build --no-bundle`
path then rebuilt both the production frontend and Tauri application. Launching
that exact executable beside the already-running installed client correctly
failed closed on database ownership, naming runtime process `19024`; the
validation client was stopped without touching the installed client. A second
launch used an isolated `OPENCORVUS_HOME` under `.scratch`, allowing the same
binary to start its own embedded backend and render the real native Workbench.

- `.scratch/workspace-no-shadow-tauri-window.png`
- `.scratch/workspace-no-shadow-tauri-corner.png`
- `.scratch/workspace-no-shadow-tauri-corner-8x.png`

The native 1330-by-821 window and nearest-neighbor enlargement were personally
inspected. The gray pixels are confined to the one physical contour and its
rounded-edge antialiasing. Above and left of that contour, the pixels return
immediately to one continuous rail material; no translucent band projects into
either user-highlighted region. The isolated Tauri process and its managed
sidecar were stopped by verified process identity after capture, while the
pre-existing installed client process `30696` remained running.

### No-Shadow Validation

| Check | Result |
| --- | --- |
| Overlay production Vite build | Passed after transforming 7,073 modules. Existing third-party module-directive and large-chunk warnings remain informational. |
| Production asset ownership | `main-CHYt5Rzd.css` contains two contour references and zero workspace-elevation references. |
| Official Tauri production build | `bun run tauri build --no-bundle` passed. The resulting 219,332,096-byte executable was written at `2026-08-05 21:32:12.946 +08:00` with SHA-256 digest `6B6B337ABD8D4E9CBD622B58C65CF9F324B65BC4762CE8353DB8FE934E3FCECF`. SHA-256 means Secure Hash Algorithm 256-bit and identifies the exact reviewed binary. |
| Overlay TypeScript typecheck | Passed with `tsc --noEmit`. TypeScript is the typed JavaScript language used by the Overlay source. |
| Documentation contracts | Historical links and product-document single-source contracts passed. The long-running source-audit contract initially exceeded the requested 60-second suite timeout but passed independently in 1.2 seconds with a 180-second allowance. |
| Concurrent monthly-index state | The only remaining documentation failure names the unrelated concurrent `2026-08-05-composer-personal-model-usage-hover.md` record, which its owner linked from the dirty August index before tracking it. This task did not alter, stage, or commit either file. |
| Current-source visual review | Passed on the actual desktop page and exact corner crop; computed `boxShadow` is `none`. |
| Packaged-client visual review | Passed on the native Windows Workbench, exact crop, and eight-times enlargement from the official production build. |
| Static integrity | Task-owned `git diff --check` passed; source ownership search finds one contour definition, two physical-edge consumers, and no elevation token or consumer. |
| UI automated tests | None added, modified, updated, or run. |

### No-Shadow Second Review

The task-owned product diff deletes the obsolete elevation token and its sole
consumer, then aligns the current panel architecture with the visible result.
The one contour token remains the only Workbench boundary owner. Radius, fill,
dimensions, clipping, isolation, layout, children, and interactions are
unchanged. No weaker shadow, `none` override, second source, wrapper,
pseudo-element, mask, fallback, gate, state, or theme fork was introduced.
Concurrent Provider, MySQL, Composer, Software Development Kit, web-document,
index, and unrelated record changes remain outside this delivery set.

### No-Shadow Delivery

The corrected diagnosis was committed as `7368906b59` before product edits.
Implementation commit `915f350e42` contains exactly the two Workbench style
files, current panel architecture, and this record, and was pushed to
`myhexin/work-v0.0.31beta-yr-0805`.

The full pre-push hook passed Software Development Kit imports, Artificial
Intelligence runtime validation, all scoped package typechecks, route inventory,
generated documentation, Overlay internationalization, and secret scanning.
No hook was bypassed. After the push, local and git-cc implementation identities
both resolved to `915f350e422931a1cd9173f509ad7658889ed834`.

## 2026-08-05 User Correction: Remove the Square Backing Corner

The user's fifth annotated enlargement rejects the square color break that
remains behind the rounded Workbench. Earlier reviews incorrectly classified
that region as contour antialiasing or exterior shadow. It is neither.

### Recall

| Item | Evidence and requirement |
| --- | --- |
| User requirement | Identify the exact element creating the visible sharp corner and make the result genuinely rounded instead of continuing to display it. |
| Acceptance criteria | The complete region outside the Workbench quarter-circle must continue the same left-rail ambient material without a square color boundary at the Workbench border-box origin. Preserve the 24-pixel Workbench radius, white interior, contour, transcript scrolling, layout, and interactions. |
| Hard constraints | Fix the backing surface owner rather than changing radius, contour, shadow, chat geometry, or adding another rounded wrapper. Keep one ambient rail paint owner across the panel row. Do not add, modify, update, or run User Interface (UI) automated tests. Validate the current real page and a new production desktop build visually. Preserve unrelated work. Commit subjects use `dsw-33987`; push only to `myhexin`. |
| Sources read | Root `AGENTS.md`; Browser skill; the supplied fifth enlargement; live computed style and hit-test stacks around `.workspace-main`; `App.tsx`; light/dark theme palettes; Activity, Workspace, Conversation, and current panel architecture styles; this complete record; current Git state. |
| Whole-repository search | `.left-activity-shell` alone paints `--rail-background-image`; `.panel-body` is the direct Workbench backing but is transparent; `body` paints only solid `--body-bg`. The existing `--panel-body-bg` token has no consumer. No other panel-row owner paints the ambient rail image behind the rounded cutout. |
| Independent feedback | None. The user did not request sub-agents, and unsolicited delegation is not permitted. |

### Square-Backing Cause Chain

1. The real Workbench border box begins at `x=382`, `y=36` with a computed
   `24px 0 0` radius and hidden overflow.
2. At `x=384`, `y=38`, the point lies outside that quarter-circle. Live
   `elementsFromPoint` evidence passes through transparent `#panelBody.panel-body`
   and `.panel` to the global `body`, whose solid light-theme paint is
   `rgb(247,247,247)`.
3. Immediately to the left, `.left-activity-shell` paints the fixed ambient rail
   gradient, whose same-height pixel is approximately `rgb(240,247,249)`.
4. The Workbench radius therefore reveals a square patch of a different backing
   material at its border-box origin. The color discontinuity, not an unrounded
   Workbench element, creates the visible sharp corner.
5. Adding radius to transcript children or changing the Workbench radius cannot
   repair that backing mismatch. The root correction is to move the existing
   rail ambient paint from `.left-activity-shell` to its row owner `.panel-body`,
   leaving the left shell transparent so both the rail and rounded cutout reveal
   one continuous material.

### Square-Backing Call-Site Disposition

| Owner or consumer | Decision |
| --- | --- |
| `.panel-body` | Become the single panel-row ambient owner: consume `--panel-body-bg` and the existing fixed `--rail-background-image` geometry. |
| `.left-activity-shell` | Remove its duplicate color/image paint and remain a transparent layout root over the parent ambient material. |
| `.workspace-main` | Preserve radius, contour, white fill, overflow clipping, isolation, dimensions, and layout unchanged. |
| `#chatScroll` and Conversation children | Preserve unchanged; live hit testing disproves them as the square border-box-origin owner. |
| Current panel architecture | Record that the panel row, rather than only the left rail child, owns the continuous ambient backing visible through the Workbench radius. |
| UI automated tests | Do not add, modify, update, or run. Use current-page and production-client screenshots with personal visual review. |

### Square-Backing Verification Plan

1. Commit and push this corrected element-level diagnosis before product edits.
2. Transfer the existing rail ambient paint to `.panel-body`, delete the child
   paint from `.left-activity-shell`, and update current architecture.
3. Reload the real current page, re-run the same corner hit test, and personally
   inspect a native-resolution screenshot and enlarged exact crop.
4. Build production Vite assets and the official Tauri executable, then inspect
   the real native client at the same corner.
5. Run typecheck, documentation contracts, static integrity, and full pre-push
   hooks without UI automated tests; review the task diff twice, commit, push,
   and verify local/git-cc convergence.

### Square-Backing Progress

- [x] Inspect the fifth annotated enlargement and reject the earlier antialiasing explanation.
- [x] Identify the transparent `.panel-body` / solid `body` backing as the square color-break source.
- [x] Prove the rail gradient has a narrower child owner than the Workbench backing region.
- [x] Commit and push the corrected diagnosis.
- [x] Transfer ambient paint ownership and complete current-page visual review.
- [x] Complete production-client visual review and non-UI checks.
- [x] Complete second review, commit, push, and remote convergence.

### Square-Backing Visual Evidence

The real current page was loaded from a Node-started Vite server at
`http://127.0.0.1:5173/`. Before the change, the Workbench border box was
`x=382`, `y=36`; the point at `x=384`, `y=38` resolved through transparent
`.panel-body` and `.panel` to the solid global `body`. The corresponding
captured pixel was `247,247,247`, while the visible rail pixel immediately to
its left was `240,247,249`.

After transferring ambient ownership, computed style reported the left activity
shell as transparent with no image and `.panel-body` as the sole content-row
owner of `--panel-body-bg` plus the fixed `--rail-background-image`. The
Workbench retained its white fill, `24px 0 0` radius, and hidden overflow.
The exact former square-corner point at `x=384`, `y=38` and the left rail point
at `x=374`, `y=38` both captured as `239,247,249`.

- `.scratch/workspace-square-corner-source-window.png`
- `.scratch/workspace-square-corner-source-exact.png`
- `.scratch/workspace-square-corner-source-exact-6x.png`

The official `bun run tauri build --no-bundle` path rebuilt the production
frontend and Tauri Release executable. The exact binary was launched with an
isolated `OPENCORVUS_HOME`, allowed to start its embedded backend and render the
real native Workbench, then captured from its actual Windows window. The
2256-by-1018 window and six-times nearest-neighbor crop were personally
inspected. At the former square origin and every sampled point to its left, the
native capture returned one continuous `240,247,249` ambient material; only the
true quarter-circle boundary transitions into the white Workbench.

- `.scratch/workspace-square-corner-tauri-window.png`
- `.scratch/workspace-square-corner-tauri-crop.png`
- `.scratch/workspace-square-corner-tauri-crop-6x.png`

The isolated Tauri process, its managed sidecar, and the task-owned Vite process
were stopped by verified identity after capture. The pre-existing installed
client process `30696` remained running.

### Square-Backing Validation

| Check | Result |
| --- | --- |
| Overlay TypeScript typecheck | Passed with `tsc --noEmit`. TypeScript is the typed JavaScript language used by the Overlay source. |
| Node-started production Vite build | Passed after transforming 7,073 modules in 3 minutes 29 seconds. Existing third-party module-directive and large-chunk warnings remain informational. |
| Official Tauri production build | Passed in 7 minutes 20 seconds, including a fresh 7,073-module frontend build and Rust Release compilation. The resulting 219,331,584-byte executable was written at `2026-08-05 22:34:25.221 +08:00` with SHA-256 digest `4DC8BB8524DDFBB640BEBA240283E77AF47D2B9E115FD25DF0BE33A317139321`. SHA-256 means Secure Hash Algorithm 256-bit and identifies the exact reviewed binary. |
| Production stylesheet | The reviewed asset is `main-BTUVrOOT.css`, written at `2026-08-05 22:29:53.387 +08:00`. |
| Documentation contracts | Passed all 70 historical-link, product single-source, and document-health contracts. |
| Current-source visual review | Passed on the full page, exact crop, six-times enlargement, computed surface ownership, and former-corner pixel comparison. |
| Packaged-client visual review | Passed on the real native Windows client, exact crop, six-times enlargement, and former-corner pixel comparison. |
| Static integrity | Task-owned `git diff --check` passed. Ownership search finds the content-row ambient consumer only on `.panel-body`; `.left-activity-shell` has no remaining ambient paint. |
| UI automated tests | None added, modified, updated, or run. |

### Square-Backing Second Review

The product diff moves the existing ambient rail declarations from the narrower
left activity layout root to its full-row parent and updates the architecture
source of truth. It does not introduce a new color, gradient, radius, wrapper,
pseudo-element, mask, fallback, gate, state, or theme fork. Workbench geometry,
contour, fill, clipping, children, scrolling, Composer behavior, resizers, and
interactions remain unchanged. The titlebar continues to own the same fixed
ambient material only in its disjoint top region; `.panel-body` owns the content
row below it. No unrelated files are part of this implementation.

### Square-Backing Delivery

The corrected element-level diagnosis was committed as `535e70e3aa` before
product edits. During the long production build, concurrent work advanced the
shared branch; implementation commit `3172160ca2` was therefore created directly
on the fetched git-cc tip `e68893c85d`, preserving the complete shared history.
It contains exactly the two surface styles, current panel architecture, and this
record, and was pushed to `myhexin/work-v0.0.31beta-yr-0805`.

The full pre-push hook passed Software Development Kit imports, Artificial
Intelligence runtime validation, all scoped package typechecks, route inventory,
generated documentation, Overlay internationalization, and secret scanning.
No hook was bypassed. After the push, the implementation remained an ancestor of
the shared remote branch and its exact identity was
`3172160ca2e2a931b6be8841cc44c90aa73a9137`.
