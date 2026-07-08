# 2026-07-08 Browser Preview DOM Selection Sync

## Recall

### User request

用户要求先解析 `D:\yerui\code\open-mirror-app\open-mirror-app` 中的预览和节点选择功能，然后将这些功能同步到当前项目。用户明确指出目标行为不是点击后展开一个默认选中框，而是：hover 到真实 DOM 节点时显示该 DOM 的边框，点击确认 hover 节点后弹出评论/信息框，并拿到 DOM 节点信息。

### Acceptance criteria

- Browser preview selection uses real DOM hit-testing in the preview guest page.
- Hover shows the real DOM element rect, not a point-derived fake area.
- Click confirms the hovered DOM node and opens the comment popover.
- Selection payload includes DOM evidence: tag, selector, DOM path, JS path, text preview, role/accessibility name, page URL/title, computed style, and source hint when page markup exposes one.
- Remove or stop relying on host overlay / iframe coordinate capture as the selection implementation.
- Keep preview target/evidence under the existing task-scoped browser-preview target model.

### Hard constraints

- Do not use a temporary iframe/local signal/query overlay to fake mature preview interaction.
- Native child webview is the intended live preview surface on Tauri/Windows; host DOM click overlays are occluded by WebView2 and cannot be the primary selection mechanism.
- Do not introduce fallback selection boxes or point-based fake regions.
- Do not repair unrelated known typecheck failures such as `ExpertSquadPanel.tsx`.
- Do not commit or push unless explicitly requested in the current conversation.
- For UI-related delivery, final acceptance still needs a real page launch and screenshot review; code/test-only validation is not full visual acceptance.

### Sources read

- Reference project analysis from read-only explore agent:
  - `D:\yerui\code\open-mirror-app\open-mirror-app\apps\web\src\components\BrowserPanel.tsx`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\apps\desktop\src\browser-panel-guest-preload.ts`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\apps\desktop\src\desktop-main-app.ts`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\packages\openmirror-grab-runtime\src\runtime.ts`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\packages\openmirror-grab-contract\src\index.ts`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\apps\web\src\components\BrowserPanel.selection.ts`
  - `D:\yerui\code\open-mirror-app\open-mirror-app\apps\web\src\components\BrowserDesignCommentPanel.tsx`
- Current project analysis from read-only explore agent:
  - `packages/overlay/src/components/BrowserPreviewPanel.tsx`
  - `packages/overlay/src-tauri/src/main.rs`
  - `packages/overlay/src/services/browser-preview-native.ts`
  - `packages/overlay/src/services/host-transport.ts`
  - `packages/overlay/src/services/tauri-transport.ts`
  - `packages/transport-protocol/src/index.ts`
  - `packages/overlay/src/styles/surfaces/inspector.css`
  - `packages/overlay/test/browser-preview-panel.test.ts`
  - `packages/overlay/test/host-transport-capabilities.test.ts`
  - `packages/transport-protocol/test/contract.test.ts`

### Whole-repository search evidence

- `selection.area_label`, `captureNodeSelection`, `browserPreviewElementSelectionFromFrame`, and `browser-preview-selection-capture` occur in `packages/overlay/src/components/BrowserPreviewPanel.tsx`, `packages/overlay/src/styles/surfaces/inspector.css`, `packages/overlay/test/browser-preview-panel.test.ts`, and i18n files.
- `BrowserPreviewNodeSelectionLayer`, `browser-preview-node-selection`, and `nodeSelectionEnabled` occur in `BrowserPreviewPanel.tsx`, CSS, and tests.
- Current protocol type includes `browserPreview.selection.setEnabled` and `browserPreview.selection.take`, but `isNativeCommand` still lacks validator cases.

### Independent agent feedback

- Reference project uses a guest runtime + bridge + host overlay model. Runtime handles `pointermove` hover, `pointerup` capture, click prevention, DOM/source evidence, nonce/pageEpoch session filtering, and host-rendered selection/comment UI.
- Current project already added Tauri native child-webview runtime injection, but also has native + web iframe dual render paths and a coordinate-based iframe selection path. The iframe path is currently parameter-mismatched and should not be the primary implementation.
- Current native selection returns only captured/canceled via polling; it does not stream hover events to the host. Since host DOM overlays are occluded by native WebView2, immediate hover visuals should be rendered inside the guest page unless/until a robust event bridge and native overlay strategy exists.

## Reference behavior summary

OpenMirror's selection is a guest-runtime model:

1. Host mounts an Electron `<webview>` preview.
2. Desktop main process injects a guest preload bridge.
3. Host injects a browser grab runtime with a nonce and page epoch.
4. Runtime listens to pointer movement in the guest page and uses `elementsFromPoint` / `elementFromPoint` to identify the real DOM node.
5. Hover emits `selectionUpdated`; click/pointerup emits `selectionCaptured`.
6. Host validates session envelope, renders selection box/HUD/comment popover, and saves comment drafts.

The important principle for OpenCorvus is not Electron-specific. The transferable invariant is: **hit-test and DOM evidence capture must happen inside the preview guest document**.

## Current project delta

Current OpenCorvus already has a native child-webview runtime injected from `packages/overlay/src-tauri/src/main.rs`. That runtime can perform in-guest DOM hit-testing and render a guest-internal hover outline/HUD. This is aligned with the requested behavior because Windows WebView2 occludes host overlays.

Remaining gaps:

1. `BrowserPreviewPanel.tsx` still contains an iframe web preview path and coordinate-based selection helper.
2. Tests still assert iframe selection/capture surfaces.
3. Transport protocol validator does not recognize selection native commands.
4. Host capability tests do not include selection native commands.
5. Native captured handling hides the native preview via `requestNativePreviewClose(false)`, causing the UI to fall back to iframe/web surface for the popover; this keeps a dual-surface dependency.

## Implementation plan

### 1. Make native guest selection the only node-selection implementation

- Keep `nativePreviewScope` as the live DOM selection source when native preview is available.
- Remove iframe coordinate selection helper and capture overlay from `BrowserPreviewPanel.tsx`.
- Remove CSS for `.browser-preview-web-frame` and `.browser-preview-selection-capture` if it becomes unused.
- Remove selection tests that require iframe selection.

### 2. Preserve native preview after capture

- After `takeNativeSelection()` returns captured, set `nodeSelection` and disable selection mode, but do not close/hide the native child webview.
- Keep the comment popover rendered in the host panel over the native placeholder. The native webview remains visible; the popover is host DOM and may visually compete with native child webview z-order, so the safer near-term behavior is to have the guest runtime hide the hover outline after capture and host show the popover where the panel can render it. If WebView2 occludes the popover, a follow-up must move comment input into a non-occluded surface or use Tauri window/webview layering explicitly; do not fake DOM selection.

### 3. Protocol consistency

- Add `browserPreview.selection.setEnabled` and `browserPreview.selection.take` cases to `isNativeCommand`.
- Add protocol tests for both selection commands.
- Add host capability tests for both commands.

### 4. Keep guest runtime hover/click behavior

- The Rust-injected JS should continue to:
  - use `elementsFromPoint` / `elementFromPoint`;
  - skip its own overlay root;
  - render hover outline/HUD immediately in guest;
  - prevent pointerdown/click while selection mode is active;
  - report captured selection only when a real element with a positive rect exists;
  - report cancel on Escape.

### 5. Tests

- Update source-level tests to assert no iframe selection path and no point-fake area label.
- Add protocol validator tests for selection native commands.
- Update capability matrix tests.
- Run targeted Bun tests and overlay build where feasible.

## Non-goals

- Do not migrate OpenMirror's design-editing panel wholesale.
- Do not implement React/Vue source owner recovery beyond current page-exposed source hints.
- Do not introduce a second preview target source or preview runtime state machine.
