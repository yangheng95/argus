# 2026-07-25 MCP Apps Production Host

## Recall

### User requirement

- Determine one detailed, complete Goal for Interactive Artifacts.
- Replace the current feature subset with comprehensive production support.
- Implement and test the whole capability instead of shipping another narrow
  increment.

### Goal and acceptance criteria

OpenCorvus must become a production MCP Apps Host for the stable MCP Apps
2026-01-26 protocol implemented by the repository's locked
`@modelcontextprotocol/ext-apps@1.3.0`.

Completion requires all of the following:

1. A real MCP tool with `_meta.ui.resourceUri` is the only producer of an MCP
   App artifact. OpenCorvus reads the matching `ui://` resource from the same
   MCP server and binds the durable artifact to the producing server, server
   configuration identity, tool definition, tool input, tool result, resource
   URI, exact HTML snapshot, resource metadata, and content digest.
2. The current model-authored raw-HTML shape under `mcp-app@1` is deleted and
   replaced in place because the renderer has not been released. There is no
   compatibility parser, raw URL iframe, arbitrary HTML publisher, inferred
   renderer, client-side payload copy, alternate resource source, or invented
   successor identity.
3. The Host implements stable-protocol capability negotiation, initialization,
   tool input, partial input, result, cancellation, dynamic Host Context,
   size, tool/resource/prompt forwarding, list-changed notifications, visible
   chat messages, model-context updates, logging, external links, downloads,
   inline/fullscreen/PiP display modes, app-requested teardown, Host teardown,
   refresh replay, MCP reconnect/OAuth, and explicit failure presentation.
4. App-originated server calls are restricted to the exact producing MCP
   server. Tool visibility is enforced from `_meta.ui.visibility`: model-only
   tools are rejected, app-visible tools are callable, and cross-server names
   cannot be smuggled through request arguments.
5. Every app-originated business action enters the real OpenCorvus permission,
   user/tool/result/message, cancellation, and audit flow. An iframe request
   never executes a hidden OpenCorvus action and never writes a synthetic or
   invisible message.
6. Resource `_meta.ui.csp` and `_meta.ui.permissions` are validated and applied
   deny-by-default. Undeclared network, nested-frame, base-URI, camera,
   microphone, geolocation, clipboard, form, popup, top-navigation, and
   same-origin powers remain unavailable.
7. The existing eleven native typed renderers remain message-owned and pass
   regression coverage. Their local presentation interactions remain local;
   only MCP Apps own the bidirectional application protocol.
8. Tests cover schema, ownership, corrupt/stale bindings, provider replacement,
   visibility, cross-server isolation, permission rejection/approval, resource
   metadata precedence, CSP, every protocol request and notification,
   cancellation, reconnect, teardown, refresh, inactive Expert Squad
   isolation, and all native renderers.
9. A real isolated MCP server and real SessionLoop tool execution must create
   the artifact. Node-launched Playwright must exercise the resulting
   Conversation UI, pointer and keyboard/focus paths, all display modes,
   app-to-tool and app-to-chat actions, cancellation/error states, refresh
   replay, and light/dark region screenshots. Fixture-only or mocked contracts
   are lower-level evidence and cannot be called end-to-end acceptance.
10. Focused suites, root typecheck, Vite production build, OpenAPI and
    JavaScript SDK generation, route/docs/i18n/document-health checks,
    `git diff --check`, and a second code/security/visual review must pass.

### Hard constraints

- Preserve every unrelated staged, unstaged, and untracked change in the shared
  main worktree. Do not stash, reset, restore, broadly stage, or create another
  worktree.
- Do not restart, close, refresh, or otherwise interfere with the user's
  running OpenCorvus or Overlay. Runtime acceptance uses isolated processes.
- Browser automation uses Node, never Bun.
- Keep the Session/Message-owned artifact row as the content and ownership
  single source. Do not add task-owned, engine-owned, or Overlay-owned copies.
- Do not add fallback, compatibility, state-machine, keyword-routing, hidden
  action, or gate-based behavior.
- Use the official MCP Apps bridge and MCP SDK schemas instead of private
  `postMessage` formats.
- Database compatibility is not retained; this unreleased project adopts the
  new strict payload directly and resets obsolete local data when needed.
- New commits use the `dsw-33987` prefix and are pushed through normal hooks to
  `myhexin/v0.0.18beta`.

### Sources read before implementation

- Root `AGENTS.md`.
- `specs/current/architecture/02-data.md`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/15-agent-facts-and-turns.md`.
- `specs/records/2026-07/2026-07-19-inline-interactive-artifact-protocol.md`.
- `specs/records/2026-07/2026-07-23-interactive-artifact-renderer-expansion.md`.
- `packages/opencorvus/src/interactive-artifact/{schema,persist}.ts`.
- `packages/opencorvus/src/tool/publish-interactive-artifact.ts`.
- `packages/opencorvus/src/session/{loop,processor,message,session.sql}.ts`.
- `packages/opencorvus/src/mcp/index.ts`.
- `packages/opencorvus/src/server/routes/{interactive-artifact,session,mcp,app}.ts`.
- `packages/overlay/src/components/InteractiveArtifactPart.tsx`.
- `packages/overlay/src/components/interactive-artifact/**`.
- `packages/overlay/src/services/{interactive-artifact,chat,mcp}.ts`.
- Locked `@modelcontextprotocol/ext-apps@1.3.0` package README, generated
  protocol types, `AppBridge` declarations, server helpers, and SDK
  implementation.
- Stable MCP Apps 2026-01-26 specification and official MCP Apps overview/API
  documentation.

### Whole-repository search evidence

The inventory used these searches before the plan was written:

```text
rg -n "mcp-app@1|publish_interactive_artifact|InteractiveArtifactPayload|interactive_artifact|interactive-artifact" packages expert-squads specs/current specs/records/2026-07
rg -n "McpUi|AppBridge|PostMessageTransport|RESOURCE_MIME_TYPE|ui://|profile=mcp-app|_meta.ui|resourceUri" packages expert-squads specs/current specs/records/2026-07
rg -n "displayParts|result.display|dynamicTool|convertMcpTool|materializeMcpToolResult" packages/opencorvus/src
rg -n "callTool|listTools|readResource|listResources|listPrompts|MCPClient" packages/opencorvus/src/mcp packages/opencorvus/src
rg -n "permission|approve|confirmation|interaction|prompt_async" packages/opencorvus/src packages/overlay/src
find packages/opencorvus/test packages/overlay/test -type f | sort | rg -i "mcp|artifact|message|session|conversation|permission"
```

Findings:

- `InteractiveArtifactPayload` has one production schema.
- `publishInteractiveArtifact` is the only artifact-row writer.
- `publish_interactive_artifact` is the only explicit publisher tool.
- The Session processor is the only display-part persistence path.
- The session-scoped route and Overlay service are the only payload read path.
- `InteractiveArtifactPart.tsx` is the only renderer dispatch.
- `McpAppArtifact.tsx` is the only `AppBridge` Host, and it currently creates
  that bridge with a null MCP client and registers only initialization,
  tool-input/result, and size behavior.
- MCP configured and scoped connections already have real MCP clients,
  tool/resource/prompt listing, call/read operations, OAuth, timeout, owner,
  and teardown mechanisms. The production Host must reuse those authorities.
- SessionLoop already executes every model-selected MCP tool through the real
  permission path and has one result-to-visible-display persistence seam.
- No production code currently reads MCP UI tool metadata or a `ui://`
  resource.

### Independent agent feedback

None. The user did not request delegated or parallel agents. The primary agent
owns the inventory, design, implementation, tests, visual review, and second
review.

### Git and shared-worktree baseline

- Branch: `v0.0.18beta`.
- Local HEAD began one commit ahead of `myhexin/v0.0.18beta`.
- The required baseline push ran normal hooks and was rejected before network
  transfer because unrelated in-progress Subagent Dock files currently have
  two TypeScript errors. The errors and their files remain visible; this task
  does not bypass hooks or overwrite that parallel design.
- The worktree already contains broad unrelated Settings, MCP management,
  Research Studio, Subagent Dock, API-doc, SDK, localization, and spec-index
  changes. Every patch and final staging operation must be path/hunk exact.

## Diagnosis

The native renderer catalog is already broad. The incomplete surface is
`mcp-app@1`, whose name overstates its contract.

The payload contains arbitrary HTML supplied by the publishing model plus
optional tool input and result. It has no MCP provider, tool definition,
resource URI, server configuration identity, resource metadata, or content
digest. The Overlay constructs `AppBridge(null, ...)`, so the bridge has
nothing to proxy. It then denies all network and Host actions. This proves a
safe iframe renderer, not an MCP Apps Host.

Adding request handlers to that iframe would not fix the root cause. Without a
durable server/tool/resource binding, a replayed artifact cannot prove which
MCP authority owns an app request; a server with the same display name could
replace the original configuration; and an app could name another server's
tool. The resource and execution authority must therefore be established at
the real producing MCP tool call before the artifact is persisted.

## Stable protocol matrix

| Direction            | Stable capability                                       | Required OpenCorvus authority                                                     |
| -------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------- |
| View → Host          | `ui/initialize`, `ui/notifications/initialized`, `ping` | Official `AppBridge` protocol negotiation                                         |
| Host → View          | tool input, partial input, result, cancelled            | Producing Session MCP tool part and streamed tool events                          |
| Host → View          | Host Context and context changes                        | Overlay theme, locale, timezone, styles, display mode, container geometry         |
| View → Host → Server | tools list/call and list-changed                        | Exact bound MCP client and app visibility metadata                                |
| View → Host → Server | resources list/templates/read and list-changed          | Exact bound MCP client                                                            |
| View → Host → Server | prompts list and list-changed                           | Exact bound MCP client                                                            |
| View → Host          | `ui/message`                                            | Real public conversation prompt/message route and visible persisted user message  |
| View → Host          | `ui/update-model-context`                               | Artifact-owned, visible next-turn context part; last update replaces prior update |
| View → Host          | logging notification                                    | Session/artifact-scoped diagnostic log, never a business action                   |
| View → Host          | `ui/open-link`                                          | Validated HTTP(S) URL plus explicit Host action                                   |
| View → Host          | `ui/download-file`                                      | Validated embedded/bound MCP resource, explicit download action                   |
| View ↔ Host         | inline/fullscreen/PiP request and context               | One Overlay display-mode owner                                                    |
| View ↔ Host         | size and dynamic container context                      | One mounted renderer owner                                                        |
| View ↔ Host         | request teardown/resource teardown                      | Graceful bridge close before unmount                                              |

## Single-source architecture

### Production trigger

An MCP tool definition may declare `_meta.ui.resourceUri`. `MCP.tools()` keeps a
non-serializable runtime binding beside the generated AI SDK tool:

```text
runtime tool
  ↳ server ID
  ↳ server configuration digest
  ↳ exact MCP tool definition
  ↳ exact ui:// resource URI
```

SessionLoop registers the runtime binding with the Session processor before the
real MCP tool executes. At `tool-input-start`, one lifecycle controller reads
the UI resource through that same MCP server, validates the stable MCP Apps
MIME type, merges list-level resource metadata with content-item metadata
(content wins), and publishes one `mcp-app@1` artifact beside the real tool
part. Partial input, repaired full input, completion, cancellation, and failure
update that same durable row. A generic agent cannot manufacture this binding.

### Durable artifact

The unreleased `mcp-app@1` contract now owns:

```text
server: id + configuration digest + configured/projected runtime authority
tool: name + definition + strict durable lifecycle
resource: ui:// URI + MIME + validated metadata + HTML + SHA-256 digest
```

The HTML snapshot is retained inside the one message-owned artifact so replay
renders the exact historical UI even if the server later changes. It is not an
independent source: the snapshot is produced only by the bound MCP resource
read and is integrity-checked on every read. Live actions use the bound server
identity and are rejected when the current server configuration digest no
longer matches.

### Artifact-scoped Host proxy

Overlay never receives MCP credentials or a raw client. `McpAppArtifact`
registers official `AppBridge` handlers that call one artifact-scoped backend
Host route. The backend loads the artifact by session and artifact identity
before dispatching an official protocol request. It derives the server and
resource authority exclusively from the artifact, never from a client-supplied
server field.

Server tools, resources, and prompts use the bound MCP client. Tools are
filtered and called by exact original name; model-only visibility is rejected.
All execution uses the existing MCP timeout, cancellation, permission, and
connection/OAuth ownership.

### Visible conversation actions

`ui/message` submits a real user-authored message through the canonical
conversation route. The response is ingested through the existing
Conversation event/message path. The Host response contains success/error
only, never hidden conversation contents.

`ui/update-model-context` writes one visible, artifact-owned context part whose
identity is stable and whose content is consumed on the next real user turn.
Each update replaces that part; it does not trigger a turn.

App tool calls create real visible tool/result evidence linked to the artifact
and producing session. Destructive or externally mutating tools use the same
permission request path as model-initiated calls. The Host does not create a
second permission language for Apps.

### Sandbox and display

The Host creates a Blob document from the validated snapshot, injects one CSP
derived from resource metadata, and keeps the iframe opaque without
`allow-same-origin`, forms, popups, or top navigation. Requested device
permissions are deny-by-default and are reflected in both the iframe `allow`
attribute and advertised Host capability.

One renderer-level display owner supports inline, fullscreen, and PiP using the
existing Overlay dialog/Dock primitives. A requested mode is granted only when
both Host and App capabilities contain it. Theme, styles, locale, timezone,
container geometry, and display mode changes are sent through
`setHostContext`.

## Exhaustive call-site disposition

| Owner                             | Disposition                                                                                                                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `interactive-artifact/schema.ts`  | Replace the unreleased raw `mcp-app@1` shape with its strict server/tool/resource binding and request/result schemas. Preserve the `mcp-app@1` identity and eleven native payloads. |
| `interactive-artifact/persist.ts` | Keep the only row writer/read owner; validate resource digest and provide exact owner lookup for Host requests.                                                                     |
| New MCP App materializer          | Read/validate the bound `ui://` resource and merge metadata after a real MCP tool result.                                                                                           |
| `mcp/index.ts`                    | Preserve real client/connection authority; attach runtime UI bindings and expose exact-server app operations without leaking credentials.                                           |
| `session/loop.ts`                 | Register the bound lifecycle before execution, materialize at tool-input start, and update the same artifact through completion, failure, or cancellation. Reuse the existing permission flow. |
| `session/processor.ts`            | Forward partial and repaired full tool input to the registered lifecycle and persist stream-abort cancellation.                                                                      |
| `publish-interactive-artifact.ts` | Remove MCP App from model-authored choices; retain native typed renderers.                                                                                                          |
| Chat artifact guidance/tests      | Stop teaching agents to emit raw MCP App HTML; describe automatic MCP tool UI behavior.                                                                                             |
| Interactive-artifact route        | Keep exact read; add one artifact-scoped official-protocol Host request route and no server-name input.                                                                             |
| Session prompt/context path       | Reuse the canonical visible user-message path and add one explicit artifact context owner, not a hidden message.                                                                    |
| `McpAppArtifact.tsx`              | Replace null inert bridge with complete official manual handlers, metadata-derived sandbox, dynamic Host Context, all modes, cancellation, and teardown.                            |
| Overlay artifact service          | Add artifact-scoped Host request methods; never cache a second payload.                                                                                                             |
| Overlay application shell         | Provide canonical fullscreen/PiP surface and visible confirmations/download/open-link actions through existing primitives.                                                          |
| Existing renderer tests           | Update the `mcp-app@1` fixture shape; keep the existing renderer identity and eleven native renderer regressions.                                                                   |
| New backend tests                 | Real MCP server UI resource/tool/visibility/security/message lifecycle coverage.                                                                                                    |
| Browser E2E                       | Real server + real SessionLoop + Conversation + AppBridge; no fixture-injected artifact may satisfy final acceptance.                                                               |
| OpenAPI/SDK/docs/i18n             | Regenerate through existing commands after routes and schemas stabilize.                                                                                                            |

## Threat model

The implementation must reject:

- client-supplied server IDs, resource URIs, tool names, or configuration
  digests that disagree with the artifact;
- stale artifacts after same-name MCP server reconfiguration;
- model-only tools called from an App;
- app-only tools projected into the model tool list;
- cross-server tool/resource/prompt requests;
- non-`ui://` app resources and non-MCP-App MIME types;
- multiple, missing, binary, oversized, or digest-mismatched HTML resources;
- undeclared external origins, wildcard schemes, credentials in CSP origins,
  invalid dedicated domains, and permission escalation;
- `javascript:`, `data:`, `file:`, or other unsafe open-link requests;
- downloads that are neither validated embedded resources nor resources from
  the bound server;
- app messages with unsupported roles/content or a foreign session;
- hidden tool calls, hidden user messages, silent destructive actions, and
  unobservable failures;
- events from any window other than the mounted iframe;
- resource reuse after teardown or after ownership deletion.

## Verification matrix

### Backend and protocol

- Schema positive/negative cases for every renderer and every MCP App binding.
- Real MCP server capability negotiation and UI tool discovery.
- Metadata precedence, digest, MIME, size, URI, owner, cascade, corrupt-row,
  provider-replacement, OAuth/reconnect, timeout, abort, and teardown cases.
- Tools/list/call visibility and same-server enforcement.
- Resources list/templates/read and prompts list forwarding.
- Tool input partial/result/cancel and list-changed notifications.
- Visible app message and next-turn model-context consumption.
- Logging, open-link, download, display-mode, and request-teardown behavior.
- Permission approval/rejection and visible tool/result evidence.
- Runtime projection for Chat, Mission, Coding Assistant, delegated workers,
  active Expert Squad agents, and inactive package isolation.

### Overlay and real browser

- Official initialization and capability contents.
- Dynamic theme/style/locale/timezone/container updates.
- Inline, fullscreen, and PiP pointer and keyboard transitions.
- App-to-tool, app-to-resource, app-to-message, context, link, download,
  cancellation, server-offline, stale-binding, and teardown states.
- Refresh replay uses the exact persisted resource snapshot and reconnects only
  the exact bound server.
- Focus enters and leaves the iframe/mode controls without trapping the user.
- Current-goal light/dark screenshots are captured for the inline app,
  fullscreen app, PiP app, permission interaction, success result, and error
  state and are visually reviewed.

### Repository checks

```text
bun test <focused backend and Overlay suites>
node packages/overlay/test/browser-runner.mjs <real MCP Apps E2E>
bun run typecheck
bun run --cwd packages/overlay build:vite
bun packages/sdk/js/script/build.ts
bun run api:routes-check
bun run docs:check
bun run i18n:check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Progress

- [x] Goal created with the complete production acceptance contract.
- [x] Stable protocol, current implementation, MCP connection authority,
      message flow, tests, and all artifact call sites inventoried.
- [x] Root cause and single-source design recorded before implementation.
- [x] Backend resource/tool binding under the unreleased `mcp-app@1` identity.
- [x] Artifact-scoped Host proxy and exact-session visible action flow.
- [x] Overlay AppBridge Host, stable message-part ownership, and display lifecycle.
- [x] Focused unit, integration, ownership, protocol, and security coverage.
- [x] Real MCP Server + SessionLoop + Node/Playwright E2E and visual review.
- [x] Full repository checks and second review; this record is the pre-commit
      evidence used by the normal commit and git-cc push.

## Calibration evidence

- The renderer identity remains `mcp-app@1`. A whole-repository search has zero
  successor renderer identities, version-two labels, or retired flat payload
  field references. The unpublished v1 shape was replaced in place and no
  compatibility parser exists.
- The real configured MCP server plus SessionLoop integration creates one
  server/tool/resource-bound artifact from the producing tool and exact
  `ui://` resource at tool-input time, then updates its single strict lifecycle
  in place through completion, cancellation, or failure. Artifact lookup is
  project/session scoped and stale, wrong-renderer, and cross-project requests
  return the documented 404.
- The Host proxy derives all authority from the artifact, forwards exact-server
  tools/resources/templates/prompts, filters model-only tools, persists visible
  tool evidence and model context, emits list-change events, and uses the
  canonical explicit-session prompt path for `ui/message`.
- Renderer identity remains stable when the visible MCP tool part is appended,
  so the iframe and result survive message-part chronology changes.
- The Node-launched headed browser suite uses a real stdio MCP server, real
  SessionLoop artifact, exact Host route, official AppBridge, and task-scoped
  screenshots. It covers successful app-visible tool and message turns,
  resources, templates, prompts, context, logging, confirmation-owned
  link/download actions, model-only rejection, inline/fullscreen/PiP,
  light/dark rendering, replay, and teardown.
- The message turn targets the artifact-bound Session even when another
  conversation is selected. Because that real user turn becomes the active
  conversation tail, the browser suite completes explicit teardown and replay
  first, then verifies the persisted message metadata and aborts only its
  isolated fixture turn during cleanup.
- Focused backend, runtime, Overlay, and headed-browser regressions pass.
- Root typecheck passes across the nine packages that publish a typecheck task.
  JavaScript SDK/OpenAPI generation, the 291-operation bilingual API docs,
  route inventory, Overlay i18n, production Vite build, historical-link,
  document-health, route/OpenAPI, and whitespace checks pass.
- A second real browser pass exercises input-streaming, running, cancelled, and
  completed artifacts concurrently. It found and repaired mutable-artifact
  caching, per-artifact event-stream pressure, and Host Context notifications
  racing bridge teardown. One session-scoped stream now routes exact artifact
  and server events. Dynamic Host Context delivery is gated by the real
  initialized-bridge lifetime because the official `setHostContext` method is
  fire-and-forget. The final run has no page, console, request, or response
  error and its current-goal screenshots were visually reviewed.
- Final runtime isolation found that scoped connections cannot read an implicit
  `Instance.directory` while installing list-change handlers. Connection
  creation now resolves the explicit `cwd` once and supplies it to notification
  registration. The two session-owner regressions and the real headed Host
  lifecycle pass after the repair.
- OAuth credential removal now clears callback and pending-flow ownership in a
  `finally` block, including storage-failure paths. The 21-case isolated MCP
  client suite mocks only its callback listener, so it remains hermetic while
  the user's running OpenCorvus process owns the real fixed port.
- Remote client and transport close failures now remain visible until process
  or transport cleanup is proven. A failed remote close keeps the removed
  definition's runtime cleanup retryable; the next exact delete settles it.
  The complete 25-case MCP route suite and Host lifecycle regression pass.
