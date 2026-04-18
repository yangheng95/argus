import { expect, test, describe } from "bun:test";

// Guards Phase 2 of the attachment-flicker fix: buildUserContextMessages
// (exposed as userContextMessages) must emit a stable `id` on every
// attachment part across re-derivations. Without a stable id, the
// upstream reconcile in Conversation.tsx's tree store falls back to
// index-based merge, which is fragile when an attachment is added or
// removed and reintroduces the very flicker we're preventing.

import { setBoardStore } from "../src/store/board";
import { userContextMessages } from "../src/utils/conversation";

function setBoardWithAttachments(
  attachments: Array<{ url: string; mime?: string; filename?: string }>,
) {
  // setBoardStore sidesteps the invariant checks in setBoardData — the
  // fixture is a minimal hand-constructed subset, not a full board payload,
  // and only the task.request + task.attachments fields are read by
  // buildUserContextMessages.
  setBoardStore("board", {
    task: {
      id: "task-1",
      request: "do something",
      attachments,
      time: { created: 100 },
    },
    interactions: [],
    goalWorkflows: [],
    changes: [],
    selectedTaskID: "task-1",
  } as any);
}

describe("userContextMessages attachment id stability", () => {
  test("same attachments produce the same part ids across calls", () => {
    setBoardWithAttachments([
      { url: "/attachment/proj/abc.png", mime: "image/png", filename: "chart.png" },
      { url: "/attachment/proj/def.jpg", mime: "image/jpeg", filename: "ref.jpg" },
    ]);
    const first = userContextMessages();
    const second = userContextMessages();
    expect(first.length).toBe(1);
    expect(second.length).toBe(1);
    const firstParts = first[0].parts;
    const secondParts = second[0].parts;
    expect(firstParts.map((p: any) => p.id)).toEqual(secondParts.map((p: any) => p.id));
    // Text part must carry an id too — attached to the same stable namespace.
    expect(firstParts[0].id).toBe("ctx:user-request:text");
    // Attachment ids use the url when present so reordering / swapping by
    // url (rather than by index) keeps identities correct.
    expect(firstParts[1].id).toBe("ctx:user-request:file:/attachment/proj/abc.png");
    expect(firstParts[2].id).toBe("ctx:user-request:file:/attachment/proj/def.jpg");
  });

  test("attachment without url falls back to positional id", () => {
    setBoardWithAttachments([{ url: "", filename: "pending.png" }]);
    const msgs = userContextMessages();
    expect(msgs.length).toBe(1);
    const parts = msgs[0].parts;
    expect(parts[1].id).toBe("ctx:user-request:file:idx:0");
  });
});
