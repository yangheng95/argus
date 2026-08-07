# Streaming conversation live activity repair

## Recall

- User request: repair four defects in the right-side streaming conversation: repeated `正在生成` after every parent/child message; unstable Agent header time/action controls during generation; no distinct animated `正在执行` treatment for active tools; and incomplete expanded tool content.
- Acceptance: each running session has at most one live activity marker, attached only to its current trailing rendered part; a running tool shows `正在执行` with a left-to-right color wave; header metadata/actions retain a stable layout while content streams; expanded tool disclosures preserve the complete title, detail, input, and output surface.
- Hard constraints: preserve one real message/session projection, do not add synthetic messages or a parallel state source; do not create or run UI automation tests; validate the rendered native client manually and then package the Windows client.
- Read records: `2026-08-03-streaming-conversation-rendering-prototype-design.md`, `2026-08-03-streaming-conversation-rendering-prototype-implementation-plan.md`, and `2026-08-03-streaming-conversation-empty-state-repair.md`.
- Full-repository call-site search: `CardParts`, `TextPart`, `msg-streaming-status`, `ExecutionDisclosureRun`, `describeCurrentToolPart`, `msg-work-details`, `chat-bubble__hover-actions`, `CardHeaderChrome`, `projectSessionStatus`, `applyProjectedSessionStatus`, and `regroupTimelineSegments` were searched across the Overlay source.
- Independent agent feedback: none; the repair is a single rendering path and was investigated directly.

## Evidence and decision

`Card.tsx` currently passes a card-wide `node.status === "running"` flag into `CardParts`; `CardParts` then forwards it to every `TextPart` in every persisted message run. A consolidated session card therefore renders one `正在生成` marker for every historical text part. Session lifecycle writes use the session-keyed `activeCardID` path in `tree-writer.ts`; no cross-session status mutation was found.

The renderer will derive one trailing live part from the card's chronological parts. A marker belongs only to a trailing text part; a trailing running/pending tool owns the live activity marker instead. The header action slot remains mounted and keeps its width during streaming, with no hover opacity transition while the card is running. Expanded tools retain their subtitle and switch their disclosure text to wrapping rather than truncation.

## Verification

- Run Overlay typecheck.
- Run the specification-link health check after updating indexes.
- Build and stage the Windows GUI package.
- Open the freshly staged native executable, exercise a streaming conversation and an expanded tool disclosure, then manually inspect screenshots.
