# Attachment Request-Body Separation

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | Fix HTML being injected into the request body and audit similar cases. This follows the observed Chat-to-Mission transfer where the caller message contained the complete uploaded HTML as text in addition to its canonical file part. |
| Acceptance criteria | Uploaded text and HTML bytes are never copied into persisted conversation text, `EngineTask.request`, or task follow-up text; all uploaded MIME types remain real attachment entities; the model can discover canonical text attachments without receiving duplicated file contents; focused regressions cover create, follow-up, session persistence, Mission wake replay, and provider adaptation. |
| Hard constraints | Preserve one attachment source; no fallback, compatibility branch, workflow gate, state machine, hidden message, or request keyword matching; retain strict malformed-data-URL failures; do not restart or disturb the running OpenCorvus/overlay processes; preserve unrelated dirty worktree changes. |
| Landed records read | `specs/records/2026-07/2026-07-16-chat-mission-surface-attachment-forwarding.md`, `specs/records/2026-07/2026-07-01-build-staged-reference-single-source.md`, and the current July index. |
| Production sources read | `packages/opencorvus/src/session/prompt/parts.ts`, `packages/opencorvus/src/session/message.ts`, `packages/opencorvus/src/session/text-mime.ts`, `packages/opencorvus/src/tool/panel.ts`, `packages/opencorvus/src/storage/attachment-store.ts`, and the task create/message ingress called by the panel tool. |
| Whole-repository grep | `rg` for `decodeDataUrlText`, `isDecodableText`, `attachmentTexts`, `followText`, `Host-provided file context`, and related attachment tests found three uploaded-content expansion surfaces: data-URL session parts, `panel.create_task`, and `panel.send_task_message`. No fourth production call concatenates decoded upload text into a request/message body. |
| Independent agent feedback | Not requested. The task is being handled by the primary agent without delegation. |

## Diagnosis

The HTML in the request body is produced deliberately by an old text-attachment split, not by accidental browser serialization:

1. `SessionPrompt.createUserMessage` writes a data-URL upload into `AttachmentStore`, then, for a decodable text MIME, also persists a host-context label and the complete decoded file as user text parts.
2. `panel.create_task` decodes text-like control-plane attachments and appends them to `params.request`; only non-text attachments are sent to `EngineService.createTask`.
3. `panel.send_task_message` repeats the same split for `params.text`; only non-text attachments are sent to `EngineService.handleTaskMessage`.
4. `Message.toModelInput` assumes text attachments were expanded upstream and skips their file parts. Removing the expansion without repairing this adapter would make canonical HTML/text attachments invisible to the model.

This creates two sources for one upload: the canonical `AttachmentStore` file and an unbounded prose copy. It also corrupts the meaning of the user's natural-language request and allows arbitrary HTML markup to become request text.

## Call-Point Disposition

| Surface | Current callers/consumers | Disposition |
| --- | --- | --- |
| Data-URL file branch in `session/prompt/parts.ts` | Chat, Mission wake, channel/control-plane prompts, direct prompt callers | Persist exactly one canonical file part for every MIME; delete decoded text and host-label persistence for uploaded data URLs. |
| Decodable file branch in `session/message.ts` | Provider-model replay and compaction adaptation | Serialize a canonical text-file part as a short attachment reference derived from that real part; never serialize its bytes. Keep noncanonical explicit local-file parts on their existing host-context path. |
| `panel.create_task` attachment split | Panel Chat, right-sidebar Chat, Mission, channel runtimes invoking the panel tool | Strictly decode every uploaded data URL as attachment bytes and pass every MIME through `TaskAttachmentInput`; keep `request` byte-for-byte equal to `params.request`. |
| `panel.send_task_message` attachment split | Bound task follow-ups from the same control-plane surfaces | Strictly decode every uploaded data URL as attachment bytes and pass every MIME through `TaskMessageInput.attachments`; keep `text` byte-for-byte equal to `params.text`. |
| Explicit `file:` text expansion in `session/prompt/parts.ts` | User-selected local file/range context, including paths outside the project | Retain. This is an explicit request to read host file context and cannot be replaced by an uploaded-attachment reference without changing the feature contract. |
| MCP resource text/blob expansion in `session/prompt/parts.ts` | Explicit MCP resource references | Retain. The content is returned by an invoked resource read, not decoded from an upload and appended to a task request. |
| `decodeDataUrlText` helper | Unit tests and any remaining explicit decoder consumers | Remove production attachment-flow imports/calls; retain the general helper and its strict decoder unit contract while it remains independently tested/exported. |

## Repair Contract

1. A control-plane upload has one content source: its attachment bytes in `AttachmentStore`/task attachments.
2. Natural-language request fields contain only the text authored for those fields.
3. Canonical text attachments remain discoverable to the model through a concise typed reference generated from the persisted real file part. The adapter does not create another persisted message or inline content.
4. Malformed or non-data-URL control-plane attachment inputs continue to fail before task creation/message handling.
5. Existing canonical file ownership and Chat-to-Mission replay validation remain unchanged.

## Test Plan

- Change the panel create regression to assert both HTML/text and image uploads are attachments while `request` remains exact and contains no uploaded markup.
- Add/extend panel follow-up coverage so an HTML upload is forwarded while `text` remains exact.
- Change the session prompt regression to assert a data-URL HTML/text upload persists only a canonical file part and no decoded payload text.
- Change Mission wake attachment coverage to assert the replayed payload is not persisted as text.
- Add provider-adaptation coverage proving canonical text attachments yield a short reference containing filename/MIME/URL but not file contents.
- Run focused panel/session tests, OpenCorvus typecheck, required documentation health checks, and `git diff --check`.

## Status

Implemented.

## Implementation

- `SessionPrompt.createUserMessage` now materializes every data-URL upload as one canonical file part and never persists decoded upload bytes or a synthetic host-context label.
- `Message.toModelMessages` maps a canonical decodable file part to a concise attachment reference. It does not read or copy the file payload, while the real file part remains the persisted/UI source.
- `panel.create_task` and `panel.send_task_message` now strictly decode every uploaded MIME into their existing attachment input contracts and pass the operator-authored `request`/`text` unchanged.
- The explicit `file:` and MCP resource expansion paths remain unchanged for the reasons recorded in the call-point table.

## Validation

Focused regressions passed:

```powershell
bun test packages/opencorvus/test/session/prompt.test.ts -t "materializes decodable data URL files without injecting"
bun test packages/opencorvus/test/session/message.test.ts -t "converts user text/file parts"
bun test packages/opencorvus/test/session/wake.test.ts -t "wake archives attached data URL files"
bun test packages/opencorvus/test/tool/panel-create-task-attachments.test.ts -t "text attachment bytes|text-only upload|rejects non-data-URL|forwards image"
bun test packages/opencorvus/test/tool/panel-send-task-message-attachments.test.ts
bun run --cwd packages/opencorvus typecheck
```

These commands produced 10 focused passes, zero focused failures, and a clean OpenCorvus TypeScript check. A broad four-file test invocation also exposed unrelated current-branch fixture failures in worker-session runtime contracts and the queue-choice value test; every attachment regression selected above passed independently. The running OpenCorvus process was not restarted, so no post-restart live UI claim is made.

Whole-repository production grep after implementation leaves `decodeDataUrlText` only as the exported helper definition; its only call sites are strict decoder unit tests. No production request/message concatenation consumer remains.
