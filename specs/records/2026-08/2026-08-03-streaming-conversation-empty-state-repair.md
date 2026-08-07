# Streaming conversation empty-state repair

## Recall

- User request: investigate and repair the right-side streaming conversation whose confirmed design did not appear to take effect in the packaged client.
- Acceptance: a freshly packaged client must show the approved Agent reading surface; an Agent turn with no text yet must visibly say `正在生成`; a failed Agent turn must visibly explain the failure instead of showing only a red status dot.
- Follow-up acceptance: user questions share the same borderless reading surface as Agent turns while retaining their user identity row.
- Hard constraints: preserve the single stream projection; do not add UI automation tests; validate with the running native client and a manual screenshot; package only after the running client releases its artifact lock.
- Read records: `2026-08-03-streaming-conversation-rendering-prototype-design.md` and `2026-08-03-streaming-conversation-rendering-prototype-implementation-plan.md`.
- Full-repository call-site search: `ChatBubble`, `CardParts`, `TextPart`, `msg-streaming-status`, `msg-tool-error`, `assistantMessageErrorReason`, `applyAssistantMessageSettlement`, and `errorReason` were searched across Overlay and transport protocol sources.
- Runtime evidence: the previous installer staging was blocked by a running artifact executable. After restaging, the client contains the new Vite CSS. The inspected session response has an assistant `info.error` with the model socket-close reason and `parts: []`; its error status is correctly projected by `tree-writer.ts`, but `ChatBubble.tsx` does not render `errorReason` and an empty running turn has no `TextPart` from which the existing loading treatment could originate.

## Decision

Keep `CardNode.errorReason` as the existing single error source. `ChatBubble` must render that state directly only when its Agent body has no visible response content, and it must render the existing streaming-status treatment for an initially empty running Agent turn. No synthetic message or parallel card is created.

User and Agent chat bubbles share that same borderless transcript surface. Their role identity remains the only visual distinction; message content is not re-routed or duplicated.

## Verification

- Typecheck the Overlay package.
- Build and stage the Windows GUI package.
- Open the freshly staged native executable and manually inspect the conversation surface.
