# Real OpenCorvus Client Promotional Recording

## Recall

| Item | Recorded context |
| --- | --- |
| User correction | The promotional video must not be a browser-opened page or a static demo. It must show the real OpenCorvus desktop client running a real requirement, preferably a complex one; a controlled rerun is acceptable. |
| Acceptance target | Replace the eight-second slideshow with a concise recording of the installed `opencorvus-overlay.exe` selecting and continuing a real Task, then expose the real requirement, agent activity, tool/evidence flow, code change, regression verification, and delivery state inside the desktop client. |
| Selected real Task | `tsk_fa275a5bc0014ZlNbF2edo5ylt` in `D:\yerui\code\opencorvus-test-demo\test-E9`: investigate several maintained open-source projects, select a public unresolved issue, reproduce it safely, determine layered root cause, implement a minimal fix and regression test, run independent verification, and prepare reviewable diff/PR text without publishing upstream. |
| Existing Task evidence | The live client backend on `127.0.0.1:7878` reports OpenCorvus `0.0.19-beta`. The Task has a six-goal contract, 324+ recorded events, real agent sessions, repository acquisition, candidate comparison, a fixed Rust upstream revision, code diffs, artifacts, and test/acceptance evidence. The task has also recorded an Orchestrator prompt-loop failure; the recording must not present that state as completed until a real continuation produces terminal evidence. |
| Client boundary | The already-running desktop client is `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`, window title `OpenCorvus`, with its managed sidecar listening on port `7878`. The user explicitly requested operating this real client. Do not restart or replace it. Use its normal accessible controls and task APIs only; preserve all existing tasks and records. |
| Recording boundary | Capture the actual native `OpenCorvus` window by handle with Windows Graphics Device Interface (GDI) screen capture. Do not use the browser build, Overlay browser fixture, mocked routes, static posters, iframe, synthetic message state, or canned tool events as video source. Encode captured frames with the installed FFmpeg binary through the existing WebM asset path. |
| Visual acceptance | Inspect the captured native-window frames before encoding. Then build the Web Docs site, start only the independent docs preview, and verify the resulting video metadata, playback, poster, captions, English/Chinese copy, and desktop layout in the supported browser. |
| Existing records read | `specs/records/2026-07/2026-07-27-codebuddy-inspired-product-demo-landing.md`; current `Lander.astro`, `landing.ts`, `build-client-demo.mjs`, and `web-landing-page.test.ts`. |
| Whole-repository grep | `packages/web/public/media/opencorvus-client-demo.webm` is the only landing video source; `build-client-demo.mjs` is its only builder; `Lander.astro` is the only renderer; `landing.ts` owns both duration/caption strings; `web-landing-page.test.ts` is the focused regression owner. The prior three client PNGs also feed feature stories and remain valid still evidence, but they must no longer generate the video. |
| Independent agent feedback | None. The user did not request delegation, and the current collaboration rule forbids spawning sub-agents without that request. The real Task's own recorded agents are product evidence, not Codex sub-agent delegation for this implementation. |

## Call-site disposition

| Call site / artifact | Decision |
| --- | --- |
| `packages/web/qa/build-client-demo.mjs` | Replace slideshow assembly with a native-window recording encoder. Require an explicit captured-frame directory and FFmpeg executable; reject non-sequential or undersized capture sets. |
| `packages/web/qa/record-real-client-demo.ps1` | Add the single native capture owner. Resolve the running `OpenCorvus` window by process name/title, capture its client-visible bounds through GDI, and write sequential frames plus recording metadata. |
| `packages/web/public/media/opencorvus-client-demo.webm` | Replace with the real desktop-client recording. |
| `packages/web/src/assets/lander/client-agent-workspace.png` | Replace the hero/video poster with a selected frame from the real Task recording. |
| `packages/web/src/content/landing.ts` | Update the duration and caption so the page accurately describes a real open-source bug-fix run rather than an eight-second walkthrough. |
| `packages/web/src/components/Lander.astro` | Preserve one native video renderer and existing poster ownership; no new playback implementation. |
| `packages/opencorvus/test/script/web-landing-page.test.ts` | Assert that the builder consumes native capture frames, the capture script targets the real client window, static slideshow generation is absent, and the copy names the real requirement. |
| Specs indexes | Index this correction as the latest product-demo recording record. |

## Implementation

1. Use the desktop client's command palette to select the real Task and request a continuation from the client composer. The continuation reached the real runtime but failed on its provider connection, so retain that as honest failure evidence rather than presenting it as success. Record the Task's persisted execution and agent evidence directly from the native client.
2. Keep the recording concise by showing the requirement, multi-goal/agent work, concrete tool or artifact evidence, changed files, verification results, and honest final status. Speed up only the final presentation timeline; do not synthesize application states.
3. Encode the sequential native frames to WebM with dimensions divisible by two, no audio, and a bounded bitrate suitable for the documentation site.
4. Replace the poster with a readable real-Task frame and update bilingual duration/caption copy.

## Verification

- Prove the selected Task ID, directory, requirement, event count, goal graph, artifacts, and final status through the live sidecar API.
- Inspect representative raw capture frames and the encoded WebM.
- Run the focused landing tests, historical-doc links, document health, Astro check, and production build.
- In an independent docs preview, visually inspect English and Chinese hero/demo regions, play the video, confirm duration and ready state, and check console output and horizontal overflow.
- Review the exact diff for single-source ownership and verify that no browser fixture or synthetic task payload entered the media pipeline.
- Commit with a `dsw-33987` subject and push the current branch to `legacy-remote`; report legacy remote network failure explicitly if it remains unreachable.

## Recorded evidence

- The native recorder validated process `29340` as `opencorvus-overlay`, window title `OpenCorvus`, and Task `tsk_fa275a5bc0014ZlNbF2edo5ylt`.
- The accepted capture contains 540 contiguous `2328 × 1310` frames recorded at 6 frames per second and presented at 12 frames per second.
- Representative frames were visually inspected at the Task overview and Squad agents states. They show the real `+105/-40` repository change count, six goals, eight requirements, two working and four completed agents, GitHub investigation commands, and coordination evidence.
- The generated WebM is 45 seconds long. It is native-window evidence from the existing Task; it does not assert that the blocked provider continuation or the Task itself reached terminal success.

## Follow-up: interface coverage and demo-stage treatment

### Recall

| Item | Recorded context |
| --- | --- |
| User follow-up | Reduce the large white background behind the video and add more OpenCorvus interface content to the recording. |
| Acceptance target | Give the complete Demo section a dark OpenCorvus workspace treatment, then replace the mostly two-state recording with a real native-client walkthrough that visibly covers the Task conversation, environment/change evidence, Goals, Requirements, Architecture, and tool activity. |
| Hard boundary | Preserve the real desktop client as the only video source. Do not compose browser footage, static slides, mocked panels, synthetic messages, or manually drawn interface frames into the video. |
| Current-state evidence | The existing native Task remains open and responsive. Its accessible controls expose `Environment information`, `Changes +105 -40`, `Goals`, `Requirements 0/8`, `Architecture 6`, real tool cards, and the existing Task/Squad agent surfaces. |
| Whole-repository grep | `Lander.astro` owns the Demo section background and stage styling; `landing.ts` owns its bilingual narration; `record-real-client-demo.ps1` and `build-client-demo.mjs` remain the single recording and encoding path; `web-landing-page.test.ts` remains the focused regression owner. |
| Independent agent feedback | None. The user did not request delegation, and the current collaboration rule forbids spawning sub-agents without that request. |

### Implementation

1. Re-record the same real Task while operating the native client through its accessible controls, deliberately dwelling on the Environment, Review, Goals, Requirements, and Architecture surfaces rather than leaving one panel static.
2. Keep the final media at 45 seconds by recording 90 seconds at 6 frames per second and presenting at 12 frames per second; use a representative multi-panel frame as the poster.
3. Change the entire Demo section from white paper to a dark gridded workspace field with readable light typography and restrained green/blue ambient accents. Keep the following feature section visually separate.
4. Extend focused tests to pin the dark section treatment and multi-interface narration, then repeat production build, playback, overflow, console, and screenshot acceptance.

### Follow-up verification

- The replacement capture again contains 540 contiguous native-window frames and encodes to a 45-second `2328 × 1310` WebM.
- Representative raw frames visually confirm the real Environment, four-file Review with `+105/-40` diff, six-item Goals board, eight-item Requirements board, and six-contract Architecture board.
- Desktop browser acceptance reports Demo background `rgb(7, 10, 8)`, no horizontal overflow, video duration 45 seconds, ready state 4, and no page console errors or warnings.
- Live playback visually reached the code Review at 21.99 seconds and Architecture at 40.81 seconds. The poster now uses the Review frame rather than the earlier Squad agents frame.

## Follow-up: clean client bounds and immediate interface proof

### Recall

| Item | Recorded context |
| --- | --- |
| User correction | The recording exposes background outside the client, and the OpenCorvus interface content is not apparent. |
| Observable cause | The recorder uses `GetWindowRect`, which reports `288,252 2328×1310` for the current window and includes the native shadow/transparent frame. The real client rectangle begins at `300,254` and is `2304×1296`; the extra window pixels reveal the desktop around the rounded client. |
| Content cause | The accepted video does contain Review, Goals, Requirements, and Architecture, but the first interface change occurs too late. A viewer sampling the beginning can reasonably conclude that the promised surfaces are absent. |
| Acceptance target | Capture only the native client rectangle, begin on Review immediately, and present several clearly different OpenCorvus surfaces within the opening half of the 45-second video. |
| Whole-repository grep | The capture rectangle is owned only by `record-real-client-demo.ps1`; media validation/encoding remains in `build-client-demo.mjs`; the focused landing regression remains `web-landing-page.test.ts`. No second crop or playback source is required. |

### Implementation

1. Replace `GetWindowRect` capture coordinates with `GetClientRect` plus `ClientToScreen`, preserving the custom OpenCorvus title bar while excluding the Windows shadow and transparent frame.
2. Record a new real-client sequence that begins with Review, then switches through Goals, Requirements, Architecture, and Environment without a long static lead-in.
3. Pin the client-area metadata in regression tests and visually inspect the first frame, each interface transition, the final WebM, and the embedded landing-page playback.

### Follow-up verification

- The replacement recording declares `captureBounds: "native-client-area"` and contains 540 contiguous `2304 × 1296` frames. This exactly matches the native client rectangle returned by `GetClientRect` and excludes the twelve-pixel horizontal/two-pixel vertical outer-window margin.
- Raw frame `00000` immediately shows the real four-file Review and `+105/-40` code diff. Representative frames `00310`, `00390`, `00470`, and `00530` visibly show the six Goals, eight Requirements, six Architecture contracts, and Environment/Changes/branch/task controls.
- Every inspected raw frame fills the image with the OpenCorvus client; no desktop wallpaper, native window shadow, or transparent rounded-window background is present.
- The encoded WebM remains 45 seconds long and preserves the same real Task, requirement, process, and native-client evidence.
- Desktop browser acceptance at `1440 × 900` reports no horizontal overflow, Demo background `rgb(7, 10, 8)`, media `2304 × 1296`, duration 45 seconds, ready state 4, and no console errors or warnings. Live playback visually confirms the immediate Review frame and the later Architecture surface inside the final landing-page stage.

## Follow-up: selected standout capabilities

### Recall

| Item | Recorded context |
| --- | --- |
| User correction | The recording should show distinctive product capabilities, not enumerate every configuration function. The earlier task-only sequence made the right-side task components visible but omitted configuration capabilities. |
| Acceptance target | Open with a concise selection of two differentiated, visually complete capabilities, then return to the same real complex Task. Keep the recording focused enough that it reads as a product story instead of a settings inventory. |
| Selected capability evidence | `Squad Market` and `Installed Agent Squads` expose installable specialist teams, agent/skill/tool counts, package provenance, and the effective active squad. `Channel` exposes the public endpoint plus Slack, Telegram, and Discord adapters. All were inspected in the running native client. |
| Excluded surfaces | `Providers` and `Agent Models` currently expose refresh/default-model warning states, so they are not honest polished promotional candidates. Ordinary appearance, network, archive, and every individual Skill/MCP/Tool configuration are intentionally excluded because they do not improve the focused story. |
| Complex Task evidence | Continue using Task `tsk_fa275a5bc0014ZlNbF2edo5ylt` and show its real Review, six Goals, and Architecture evidence after the capability sequence. |
| Hard boundary | Record only the existing native OpenCorvus client. Do not restart it, alter configuration values, install/uninstall a squad, save a channel, compose browser footage, or synthesize application state. |
| Whole-repository grep | `landing.ts` remains the only bilingual demo narration owner; `record-real-client-demo.ps1` remains the only native capture owner; `build-client-demo.mjs` remains the only encoder; `opencorvus-client-demo.webm` remains the only video source; `web-landing-page.test.ts` remains the focused regression owner. |
| Independent agent feedback | None. The user did not request delegation, and the current collaboration rule forbids spawning sub-agents without that request. |

### Implementation

1. Record a native-client sequence covering `Squad Market`, `Installed Agent Squads`, and `Channel`, without mutating any configuration.
2. Return to the real Task and show Review, Goals, and Architecture as the concrete engineering outcome behind the product capabilities.
3. Keep the published duration at 45 seconds by capturing 90 seconds at 6 frames per second and presenting at 12 frames per second.
4. Update bilingual copy and focused tests to name the selected capabilities and explicitly avoid claiming exhaustive configuration coverage.

### Verification

- Inspect representative raw frames for every selected capability and every real-Task surface.
- Verify the capture remains exactly `2304 × 1296`, contains only the native client area, and encodes to a 45-second WebM.
- Run the focused landing regression, documentation health checks, Astro check/build, and desktop browser playback acceptance.
- Commit with a `dsw-33987` subject and push the current branch to `legacy-remote`; report an external legacy remote connection failure rather than bypassing hooks or changing remotes.

### Recorded evidence

- The accepted native capture contains 540 contiguous `2304 × 1296` frames recorded across 90 seconds and encoded at 12 frames per second into a 45-second WebM.
- Representative frames `00000`, `00040`, and `00090` show Installed Agent Squads, Squad Market, and Channel. Frames `00150`, `00210`, `00300`, and `00430` then show the real phase Task, four-file `+105/-40` Review, six Goals, and six Architecture contracts.
- A combined recording-and-interaction process removed the foreground-window race found during rejected capture attempts. Every accepted frame fills the image with the OpenCorvus client and contains no browser, desktop wallpaper, native shadow, or synthetic UI.
- Browser acceptance at `1440 × 900` reports media duration 45 seconds, ready state 4, source dimensions `2304 × 1296`, Demo background `rgb(7, 10, 8)`, and no horizontal overflow or console warnings/errors.
- Live playback visually confirms the Goals frame around 25 seconds and the Architecture frame at the 45-second endpoint. The poster now opens on Installed Agent Squads so the first visible proof is a selected product capability.

## Follow-up: E10 product-feedback intelligence run

### Recall

| Item | Recorded context |
| --- | --- |
| User correction | The current demo is not convincing. In project `test-E10`, submit the exact long-form requirement for collecting and auditing at least one hundred recent, traceable product-feedback records, building an insight website, and producing a prioritized quarterly roadmap; then regenerate the video. |
| Exact requirement | `选择一个拥有公开评价、社区讨论和 issue 的软件产品，收集其最近六个月至少一百条可追溯的有效用户反馈。对反馈进行去重、主题分类、情绪分析、严重度评估和证据核验，区分高频问题、高影响问题与少量高风险问题。制作一个产品洞察网站，让用户查看原始反馈、来源、分类依据、趋势、代表性证据和筛选结果；同时生成一份按影响、成本和置信度排序的下一季度产品路线图。` |
| Acceptance target | Show a newly submitted real Mission in `test-E10`, its natural agent/tool/evidence progression, the generated product-insight website in the task-scoped OpenCorvus preview, and the evidence-backed roadmap. The final recording must tell one coherent end-to-end story rather than tour unrelated settings. |
| Existing acceptance source | `specs/artifacts/长程编排测试.md` defines E10 acceptance: at least one hundred deduplicated structured records with source and date; collection, cleaning, deduplication, classification, sentiment, severity, and evidence methods; source/time/topic/sentiment/severity filters; roadmap scoring and ranking; audit tests; desktop screenshots; and traceability from conclusions to original evidence. |
| Client boundary | Reuse the running packaged `opencorvus-overlay.exe` process and its real project/task records. The user explicitly authorized operating `test-E10`; do not restart or stop unrelated OpenCorvus processes, and do not substitute a browser, fixture, static mock, or synthetic messages for client evidence. |
| Recording boundary | Capture only the native client rectangle. A persisted completed or meaningfully progressed Mission may be walked through after execution, but every screen, artifact, task-scoped preview, message, and result shown must come from the real submitted Mission. |
| Whole-repository grep | `record-real-client-demo.ps1` remains the sole native capture owner; `build-client-demo.mjs` remains the sole encoder; `opencorvus-client-demo.webm` remains the sole landing video source; `client-agent-workspace.png` remains its poster; `landing.ts` remains the bilingual narration owner; and `web-landing-page.test.ts` remains the focused regression owner. |
| Independent agent feedback | None. The user did not request delegation, and the current collaboration rule forbids spawning sub-agents without that request. |

### Implementation

1. Open the real client, select `test-E10`, create a new Mission, paste the exact requirement without shortening it, and submit it through the normal client composer.
2. Observe the Mission through its real sidecar/task evidence until it produces enough execution evidence to verify feedback collection, processing, insight-site generation, and roadmap ranking, or honestly reaches a terminal blocker.
3. Inspect the generated task-scoped website and roadmap inside OpenCorvus. Verify representative raw records, sources, filters, trends, classification rationale, evidence links, and prioritization scores before recording.
4. Record a concise native-client walkthrough covering the submitted requirement, agent/tool activity, evidence and audits, the working insight website, and the ranked roadmap. Replace the published WebM and poster through the existing single-source pipeline.
5. Update bilingual landing narration and focused regression expectations so the page accurately describes this E10 product-intelligence run.

### Verification

- Prove the project, Mission/task identifier, exact submitted text, runtime status, source-count evidence, generated artifacts, and roadmap evidence through the real client and sidecar.
- Visually inspect representative raw capture frames, the encoded WebM, and the task-scoped website states; do not accept DOM-only or mocked evidence.
- Run the focused landing tests, relevant document-health tests, Astro check/build, and desktop playback acceptance with screenshot, console, overflow, duration, and native media dimensions.
- Review the final diff for a single video/data source, commit with a `dsw-33987` subject, and push the current branch to `legacy-remote`; report a remaining external legacy remote connection failure explicitly.

### Observed real-run blocker

- The exact requirement was submitted through the packaged OpenCorvus client into project `test-E10`. The persisted Mission is `4c9a53fae4e206e1`; its created task is `tsk_fa6a0ad50001Yh7KiKiBHOzgQ0`, titled `Phase 01: 产品反馈洞察与路线图`.
- The task did not reach an agent/tool result. Its real error envelope reports `TypeError: pt.overwrite is not a function`, while the orchestrator-owned prompt session remained pending with no activity. This is a runtime failure and cannot be presented as successful demo evidence.
- Whole-repository call-site review found one `.overwrite(...)` call in `packages/plugin/src/artifact-catalog.ts`. The source workspace resolves the plugin's Zod 4 dependency correctly, but the extracted packaged sidecar contains root Zod 3.25.76 alongside plugin-local Zod 4.1.8.
- `packages/opencorvus/src/expert-squad/package-tool-bundle.ts`, `packages/opencorvus/script/build-runtime-node-modules.ts`, `packages/opencorvus/script/build-artifact.ts`, and `packages/opencorvus/test/script/compiled-package-tool-artifact.test.ts` are the complete packaging and package-tool resolution surfaces relevant to the conflict. The current source already binds package tools to the plugin-local Zod entry and tests the conflicting packaged dependency topology, so the next verification must distinguish a stale running sidecar from an uncovered source path before changing code.
- The exact compiled-package-tool regression passes against current source. A fresh overlay-server build produced SHA-256 `2448F6285E129839377E2878777D1D400D0308562B219CE4E9CFC09D017C4EEC`; the running client's extracted sidecar is the older, different SHA-256 `982A16AFF46FE7C4B0CA3E8BACB75972EF5E492A43BBD8DACAEA65B5EBAFFEB3`. This proves the live runtime is stale relative to the existing source fix. Loading the corrected sidecar requires an explicit client restart and is therefore held for user authorization under the running-process boundary.
- The rejected full-monitor frame is `2880 × 1800`, but the useful client composition occupies only the upper portion and leaves a large blank lower field. The accepted replacement must crop the native client content to a true `16:9` presentation frame, enlarge the OpenCorvus interface, and exclude the Windows taskbar, desktop wallpaper, and window shadow.
- The capture owner now enumerates the overlay process's real visible windows, selects its largest client surface, maximizes it, and captures a configurable `16:9` native content frame. A real `2304 × 1296` probe of Mission `4c9a53fae4e206e1` shows the full OpenCorvus sidebar, `test-E10`, and the Mission execution card without taskbar, wallpaper, window frame, or blank lower half.

### Accepted rerun and media

- After the user reopened the rebuilt `v0.0.21beta` client, the exact requirement was submitted again from the populated `test-E10` composer with `hexin/gpt-5.6-sol`. The client naturally classified the request as long-running work, transferred it to Mission, and created Mission-visible durable task `tsk_fa6d761a3001KqBLYdi2T5b9DK`, titled `Phase 01: 用户反馈洞察与路线图`.
- The real global task record reports `active`, no error, and two task-owned prompt sessions during the accepted recording. Mission visibly established the six-month window, at least one hundred deduplicated and traceable records, three public source classes, evidence-backed analysis, an insight website, a ranked quarterly roadmap, build/test/browser verification, and independent evidence audit as one task contract.
- The final edit contains 541 contiguous real-client frames from the submission and progress recordings. It removes only the rejected idle/missed-click intervals and retains the exact request, Chat-to-Mission transfer, Mission execution, task identifier, expert-squad selection, and delivery contract. Metadata binds the edit to the real task identifier and records both source frame ranges.
- The replaced WebM is `2880 × 1620`, 12 frames per second, and 45.083 seconds. The poster is a matching `2880 × 1620` Mission frame that exposes `test-E10`, the real task identifier, the one-hundred-record requirement, source coverage, analysis stages, website delivery, roadmap ranking, and audit constraints.
- Desktop browser acceptance at `1440 × 900` reports media ready state 4, intrinsic dimensions `2880 × 1620`, duration 45.083 seconds, and zero horizontal overflow. Live playback advanced from 0 to 30.95 seconds and visually showed both the complete requirement input and Mission execution frames; the page console remained clean. The complete video stage fills its `16:9` frame and contains no taskbar, desktop, window shadow, or blank lower half.
- Focused landing tests pass with 10 tests and 109 assertions. `astro check` completes with zero errors and one pre-existing unused-variable hint; `astro build` produces 105 pages successfully. The complete historical-docs test had one concurrency-induced five-second timeout after a 13.3-second run, and the exact timed-out governance test passes independently in 234 milliseconds with 22 assertions.
- A final default-parameter recorder probe against the still-running task selected the largest real overlay window, maximized it, measured a `2880 × 1716` native client, and captured its largest `16:9` content surface at `2880 × 1620`. The inspected final probe frame fills the image with OpenCorvus and visibly shows the real `research-investigator` fetching public GitHub/community evidence in parallel with `interface-designer`, while the Orchestrator reports eight ordered goals. The task remains `active` with no error and three task-owned prompt sessions; the recording workflow did not stop or mutate it.

## Follow-up: terminal-complete recording and user screenshots

### Recall

| Item | Recorded context |
| --- | --- |
| User correction | The published recording stops while the task is still running. Record the complete task through its final result, and evaluate the five screenshots in `C:/Users/10132/Desktop/opencorvus截图/` as replacements for current landing-page images. |
| Added recording requirement | The complete recording must also introduce selected distinctive OpenCorvus capabilities and expose the task-flow detail surfaces. The story must show agent/task details, evidence and interactive artifacts in context, then a concise feature walkthrough; it must not become an exhaustive settings tour. |
| Recording acceptance | Keep the native OpenCorvus client visible from the previously captured exact submission through continuing real execution and the eventual terminal result. Do not use another fixed 45-second wall-clock cutoff. The final promotional playback may accelerate uneventful stretches, but it must preserve chronological coverage and end on the real completion or failure evidence. |
| Current task evidence | Task `tsk_fa6d761a3001KqBLYdi2T5b9DK` remains `active` without error. A continuing `2880 × 1620` native-client capture started while the real Orchestrator and build workload were still active. |
| Screenshot assessment | `image (1).png` is the strongest multi-agent/audit view; it shows the Orchestrator, interface-integrity review, parallel agent tabs, project rail, and real tool evidence. `image (5).png` is the strongest interactive-artifact view; it shows a searchable evidence table and an embedded presentation in Work. `image (2).png` and `image (3).png` are byte-identical, mostly blank composer views; `image (4).png` is a sparse Provider configuration view. Only images 1 and 5 are accepted for replacement. |
| Existing image comparison | `client-environment-evidence.png` and `client-task-evidence.png` currently show an older mostly empty synthetic-looking task state. The accepted user screenshots provide materially stronger real product evidence and directly replace those two files; `client-agent-workspace.png` remains the E10 video poster and hero image. |
| Whole-repository grep | `Lander.astro` is the sole importer and renderer of the three `client-*.png` assets. `landing.ts` is the sole bilingual feature narration owner. `web-landing-page.test.ts` is the focused regression owner. `record-real-client-demo.ps1` and `build-client-demo.mjs` remain the only capture and encoding owners. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

### Implementation

1. Keep the continuing native-client capture alive until the task reaches a real terminal status, then retain a short terminal hold so the final result is readable.
2. Replace `client-environment-evidence.png` with user screenshot 5 and `client-task-evidence.png` with user screenshot 1. Preserve their native aspect ratio in `Lander.astro` rather than forcing the previous image dimensions.
3. Update bilingual feature narration so the replaced artifact image is described as an interactive evidence surface rather than a generic environment screenshot.
4. Rebuild the WebM from the accepted submission capture plus all subsequent chronological execution and terminal-result evidence, then update the displayed duration from the encoded media truth.
5. Continue the same native-client recording after terminal evidence long enough to open representative flow details, interactive artifacts, and selected OpenCorvus feature surfaces. Preserve the real client and task context; do not compose browser footage or static screenshots into the recording.
6. Repeat focused tests, documentation health, Astro check/build, real desktop playback, screenshot, overflow, and console acceptance before committing and pushing to `legacy-remote`.

## Follow-up: two-minute feature-first edit

### Recall

| Item | Recorded context |
| --- | --- |
| Final user direction | Do not record any more footage. Preserve the existing originals, edit the distinctive OpenCorvus capability showcase to the beginning, place the real workflow afterward, keep the complete playback near two minutes, and replace the landing-page video when accepted. |
| Required chronology | The feature montage comes first. The workflow portion then includes the prior recording of entering and submitting the complex `test-E10` requirement, Mission transfer, multi-agent execution, Goal/tool/detail activity, evidence validation, and the insight/roadmap stage. |
| Editing allowance | Use existing native-client footage only. Cropping, frame selection, time compression, fast-forwarding, short explanatory overlays, and stitching are authorized; browser footage, new recording, synthetic application states, and mocked messages remain forbidden. |
| Accepted source inventory | The exact start is in `opencorvus-e10-live-b8c934f59ad44c33b91fe5c4c02227fc`; Mission handoff is in `opencorvus-e10-progress-a17cb2675a2043b7a6222b208a68aec6`; multi-agent workflow details are in `opencorvus-e10-until-terminal-99c3dff89d7a41ffa412ed193ed11b3a`; later evidence, Goal, insight, and roadmap detail is in `opencorvus-e10-terminal-aware-20260728-1245`. All sources are real `2880 × 1620` captures of the same native client and task. |
| Visual review | Contact sheets and full-size representative frames confirm four suitable feature surfaces: side-by-side specialized agents, a live delegated work card with Goal progress, the right-hand session detail/evidence view, and an evidence-backed insight/roadmap validation card. The source ranges containing a transient non-client window or settings dropdown are rejected. |
| Whole-repository grep | `opencorvus-client-demo.webm` remains the only landing video source; `build-client-demo.mjs` remains the only encoder; `landing.ts` remains the bilingual duration/narration owner; and `web-landing-page.test.ts` remains the focused regression owner. The edit requires one configurable curation stage before the existing encoder, not a second media source. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

### Implementation

1. Build a configurable native-frame curation utility that consumes an external edit plan, preserves the source frame aspect ratio, and can select/stride ranges plus add short bilingual explanatory overlays without synthesizing product state.
2. Assemble an approximately 120-second sequence: about 24 seconds of feature highlights followed by the exact task submission, Mission handoff, accelerated multi-agent workflow, Goal/detail surfaces, and evidence-backed insight/roadmap validation.
3. Encode the curated `2880 × 1620` sequence at 12 frames per second through `build-client-demo.mjs`, replacing the existing WebM as the single source.
4. Update the English and Chinese displayed duration and demo narration to match the encoded media truth.
5. Visually inspect representative curated frames, probe the WebM, and perform real browser playback, screenshot, overflow, console, focused-test, document-health, Astro check, and production-build acceptance.

### Accepted feature-first edit

- The final edit contains 1,146 real-client frames at 12 frames per second: 95.5 seconds at `2880 × 1620`. It retains the four original native-client recording directories and replaces only the landing page's single published WebM.
- The first 24 seconds present four selected OpenCorvus capabilities: specialist-agent coordination, live delegated Goal progress, task/session detail evidence, and evidence-backed Goal/roadmap work. Each surface uses a restrained four-percent Ken Burns movement; the three boundaries use eight-frame crossfades so the capability changes remain visible without abrupt cuts.
- The workflow follows the feature montage and retains the exact `test-E10` submission, Mission contract, task identifier, multi-agent execution, Goal/tool/detail surfaces, evidence validation, and insight/roadmap work. Uneventful source stretches are compressed with the external edit plan instead of being replaced by browser footage or synthetic application states.
- The perceptual-still scan uses a `64 × 36` grayscale signature for every curated source frame. At visual-difference thresholds `0.05` and `0.1`, the longest near-identical run is 12 output frames, exactly one second; no unanimated still presentation exceeds the user's one-second limit.
- Real browser acceptance at `1440 × 900` loaded the new WebM with ready state 4, duration 95.5 seconds, and intrinsic dimensions `2880 × 1620`. Playback progressed to the natural ended state, visibly covered both the feature montage and later Mission evidence, reported no horizontal overflow, and produced no page console warnings or errors.
- The focused landing regression passes with 13 tests and 169 assertions. The complete historical-document health regression passes with 22 tests. `astro check` reports zero errors and one pre-existing unused-variable hint; `astro build` produces 105 pages successfully.

## Follow-up: 7×24 and three-level product narrative

### Recall

| Item | Recorded context |
| --- | --- |
| User correction | The landing page currently emphasizes generic agent/tool/evidence visibility. OpenCorvus should instead lead with 7×24-hour operation and the three product levels: interactive Chat, deliverable-oriented Work, and durable long-running Mission orchestration. |
| Acceptance target | The hero must state the 7×24 value and name Chat, Work, and Mission. The primary feature section must explain the three levels in order, with their different scope and handoff semantics. The supporting runtime section must explain how the headless server, schedules, channels, and repository automation keep work reachable and resumable. |
| Product evidence | `primary-assistant-registry.ts` defines Chat-to-Work and Chat-to-Mission recommendations. `07-panel.md` and the Work experience record define three explicit launchers and one shared ledger. `automation-service.ts`, `event-service.ts`, `schedule.ts`, the channel runtime documentation, the headless server, and repository automation provide the concrete always-on entry and wake surfaces. |
| Existing visual evidence | The hero screenshot already exposes New Chat, New Work, New mission, and Scheduled in the native client. The Work and Mission story screenshots remain real product evidence. A code-native three-level map replaces the mismatched Mission screenshot beside the Chat story. |
| Single-source boundary | `landing.ts` remains the sole bilingual content owner; `Lander.astro` remains the sole landing renderer; `web-landing-page.test.ts` remains the focused regression owner. The existing WebM remains the sole demo source and is not re-recorded for this hierarchy correction. |
| Whole-repository grep | All landing consumers resolve through the content object. Product implementation evidence resolves through `primary-assistant-registry.ts`, `panel.capability`, `tool/schedule.ts`, `scheduler/automation-service.ts`, `scheduler/event-service.ts`, the Overlay Work Ledger/launchers, and current Chat/Work/Mission architecture records. No parallel landing content source exists. |
| Independent agent feedback | None. The user did not request delegation, and the active collaboration rule forbids spawning sub-agents without that request. |

### Implementation and accepted evidence

1. The hero now leads with 7×24-hour availability and presents Chat → Work → Mission as the product's core progression.
2. The three primary stories define Chat for immediate interaction, Work for substantial review-ready deliverables, and Mission for durable long-running orchestration.
3. The first story uses the existing icon system to render one explicit three-level map. Work and Mission retain their real client screenshots; no synthetic client screenshot or second content source was introduced.
4. The four runtime cards explain desktop continuity, the headless runtime, channel reach, and scheduled repository automation as the concrete support for always-on operation.
5. Desktop browser review at `1440 × 900` confirms the new hero, level map, runtime cards, and CTA are legible with zero horizontal overflow and no page console warnings or errors.
6. The focused landing regression passes with 13 tests and 180 assertions, and the complete historical-document health regression passes with 22 tests. `astro check` reports zero errors and one pre-existing unused-variable hint; `astro build` produces 105 pages successfully.
