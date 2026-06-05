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

## Call Points

| Area | Call point | Decision |
| --- | --- | --- |
| Overlay main | `packages/overlay/src/main.tsx` | Import only `codingAgentTuiPlugin`; do not import panel internals. |
| Overlay plugin | `packages/overlay/src/plugins/coding-agent-tui/index.tsx` | Own activity metadata, body/mount IDs, and panel component. |
| Overlay plugin panel | `packages/overlay/src/plugins/coding-agent-tui/CodingAgentTuiPanel.tsx` | Own ghostty-web terminal surface, resize, snapshots, WebSocket lifecycle. |
| Overlay plugin PTY target | `packages/overlay/src/plugins/coding-agent-tui/pty-target.ts` | Own `/pty` create/list/update/delete/connect client and coding-agent target metadata. |
| Overlay plugin terminal helper | `packages/overlay/src/plugins/coding-agent-tui/terminal-size.ts` | Own terminal resize dedupe helper. |
| OpenCorvus backend | `packages/opencorvus/src/pty/index.ts` | Remain a generic OpenCode-shaped `/pty` target. |
| OpenCorvus backend | `packages/opencorvus/src/tui/index.ts`, `packages/opencorvus/src/tui/host.ts` | Keep only process resolution/PTY host fixes needed by independent embedded TUI startup. |

## Implementation Decision

The current round separates the overlay right activity into an explicit plugin module and removes the old direct component/service imports. It does not claim visual success until a real browser screenshot shows nonblank OpenTUI content and the Tank Battle prompt can be entered through the right-sidebar TUI.

The next renderer fix must use a mature OpenTUI-compatible renderer path or an upstream-compatible OSC 66 adapter. It must not parse or synthesize coding-agent messages as a fake UI data stream.
