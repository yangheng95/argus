# Coding Agent TUI Overlay Plugin Decoupling - 2026-06-06

## Evidence

The Tank Battle prompt is a right-sidebar TUI usability case, not a request to fake a game fixture.

Real visual verification failed before this change:

- `http://127.0.0.1:43211/ui/index.html` loaded overlay CSS and connected the right TUI panel, but the terminal area stayed black.
- `/pty?directory=D%3A%2Fmyhexin-local%2Fopencorvus` created a real project-bound TUI process with `--agent tui-coding`.
- The PTY WebSocket returned OpenTUI setup sequences, terminal title `OpenCorvus`, OSC 66 span setup, and capability queries, but no visible prompt/body text.
- Sending capability responses did not produce visible UI text.
- `OTUI_NO_NATIVE_RENDER=1` still produced OSC 66 setup and no visible text.

Real visual verification after the explicit project-directory fix:

- `http://127.0.0.1:43212/ui/` loaded the overlay with `oc_directory=D:/myhexin-local/opencorvus` and `oc_workspace_directory=D:/myhexin-local/opencorvus`.
- The right TUI panel selected the plugin activity, reached `data-terminal-state="running"`, and showed the panel chrome status `Connected`.
- The canvas was nonblank at the pixel level (`232x715`, nonzero alpha pixels observed), but the screenshot still showed an empty light terminal surface rather than OpenTUI content.
- Screenshot evidence: `C:/Users/hengu/AppData/Local/Temp/opencorvus-real-overlay-tui-plugin-directory-43212.png`.
- The PTY WebSocket delivered a single 6974-byte OpenTUI setup frame. The preview included private mode setup (`?9001`, `?1004`, `?2031`), screen clear, palette queries (`OSC 4`), Kitty keyboard/capability probes, `OSC 99`, `OSC 1337`, `OSC 66`, alternate screen (`?1049`), and pixel-size query (`CSI 14t`), followed mostly by SGR-colored spaces rather than visible body text.
- Browser console evidence included `warning(stream): unimplemented mode: 9001`.
- Manual WebSocket response experiments for pixel-size, XTVERSION, Kitty keyboard, primary device attributes, OSC 99, OSC 1337, palette, and OSC 66 capability responses did not produce future OpenTUI body frames.
- Restarting the real PTY with and without explicit resize produced only terminal setup/title frames and no prompt/body text, while the child server ports remained healthy.

Root conclusion: the right-sidebar surface cannot pretend that OpenTUI is a generic terminal byte stream. The current ghostty-web PTY route can transport bytes from the real project-bound process, but it is not an equivalent OpenTUI browser embed. The overlay integration must be owned by a coding-agent TUI plugin boundary. OpenCorvus core may expose a project-bound `/pty` target, but it must not own browser panel rendering/protocol details.

Real visual verification after replacing the browser PTY terminal with an OpenTUI renderer sidecar:

- `http://127.0.0.1:43251/tui/embed/start` was invoked with `x-opencorvus-directory=D:\myhexin-local\opencorvus`, `cols=100`, and `rows=32`.
- `/tui/embed/status` returned `running=true` and a nonblank OpenTUI frame with the OpenCorvus logo, `Ask anything...`, provider/model status, and `tab agents  ctrl+p commands`.
- The blank Home root cause was in `packages/opencorvus/src/cli/cmd/tui/plugin/slots.tsx`: `Slot` initially rendered `null`, while `TuiPluginRuntime.init()` installs the host slots on mount. Home rendered before runtime setup, so fallback children such as `Logo` and `Prompt` were swallowed and no reactive invalidation forced them to re-evaluate.
- The renderer hang root cause was `BgPulse`: it is a live OpenTUI renderable, so `testRender.flush()` waits for visual idle that never arrives. The embedded worker now captures a current frame by advancing one render pass with `renderOnce()`.
- Real overlay evidence: `http://127.0.0.1:43251/ui/index.html` selected the right TUI activity, `.tui-host-terminal` reached `data-state="running"`, and rendered the real OpenTUI frame from `/tui/embed/*`.
- Screenshot evidence: `C:/Users/hengu/AppData/Local/Temp/opencorvus-real-overlay-tui-embed-43251.png`.
- Screenshot pixel check: `1440x900`, whole-image sampled colors `300`, terminal-crop sampled colors `198`, terminal-crop average brightness `25.23`. This is not an empty/transparent surface.

Readability verification after the right-pane presentation fix:

- The initial overlay screenshot showed the real OpenTUI frame but the right pane was only about `263px` wide. The logo was clipped into a block cluster, the prompt was truncated, and the result was not usable even though the backend frame was real.
- TUI activity now uses a terminal-specific right-pane width and starts/resizes the embedded renderer with at least `80` columns.
- The DOM frame now uses explicit cell dimensions, `width: calc(var(--tui-cols) * var(--tui-cell-width))`, fixed line height, preserved whitespace, and terminal overflow containment instead of ordinary inline flow.
- The embedded worker serializes requests so polling, resize, and input cannot concurrently call OpenTUI `renderOnce()`.
- Real overlay evidence after the fix: `C:/Users/hengu/AppData/Local/Temp/opencorvus-real-overlay-tui-readable-43251.png`.
- Measured real layout: `frameCols=80`, right sections width `749px`, terminal width `695px`, terminal `scrollWidth=693`, `clientWidth=693`, visible logo/prompt/footer lines all readable, and no `.tui-host-error`.

## Call Points

| Area                           | Call point                                                              | Decision                                                                                                          |
| ------------------------------ | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Overlay main                   | `packages/overlay/src/main.tsx`                                         | Import only `codingAgentTuiPlugin`; do not import panel internals.                                                |
| Overlay plugin                 | `packages/overlay/src/plugins/coding-agent-tui/index.tsx`               | Own activity metadata, body/mount IDs, and panel component.                                                       |
| Overlay plugin panel           | `packages/overlay/src/plugins/coding-agent-tui/CodingAgentTuiPanel.tsx` | Render backend-captured OpenTUI spans and own focus, keyboard, paste, resize, polling, and restart controls.      |
| Overlay plugin embed target    | `packages/overlay/src/plugins/coding-agent-tui/embedded-target.ts`      | Own `/tui/embed/start`, `/status`, `/input`, `/resize`, and `/stop` client calls with explicit project directory. |
| Overlay plugin terminal helper | `packages/overlay/src/plugins/coding-agent-tui/terminal-size.ts`        | Own terminal resize dedupe helper.                                                                                |
| OpenCorvus backend             | `packages/opencorvus/src/server/routes/tui.ts`                          | Expose project-scoped embedded TUI routes as the single backend preview/evidence target for the overlay plugin.   |
| OpenCorvus backend             | `packages/opencorvus/src/tui/embedded.ts`                               | Own the sidecar process lifecycle and JSON-lines protocol.                                                        |
| OpenCorvus backend             | `packages/opencorvus/src/tui/embedded-worker.tsx`                       | Run the mature OpenTUI/Solid test renderer with `TuiRoot`, serialize styled spans, and apply input/resize.        |
| TUI root                       | `packages/opencorvus/src/cli/cmd/tui/app.tsx`                           | Export `TuiRoot` so both the CLI and embedded worker use the same OpenTUI app tree.                               |
| TUI slots                      | `packages/opencorvus/src/cli/cmd/tui/plugin/slots.tsx`                  | Render fallback children before runtime setup and notify Solid when host slot view/register state changes.        |

## Implementation Decision

The current round separates the overlay right activity into an explicit plugin module and replaces the retired ghostty-web PTY terminal with a project-scoped OpenTUI renderer sidecar. The overlay does not parse, synthesize, or fork coding-agent messages. It renders the same captured OpenTUI frame that the backend returns as task-scoped evidence, and input flows back through `/tui/embed/input`.

The remaining architectural constraint is that the embedded worker is a sidecar snapshot renderer, not a second TUI implementation. It imports `TuiRoot`; any future TUI feature must remain in the shared OpenTUI app tree or in TUI plugins, not in overlay-specific UI code.
