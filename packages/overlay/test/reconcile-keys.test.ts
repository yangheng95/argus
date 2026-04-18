import { expect, test, describe, beforeEach } from "bun:test";
import { toCardTree } from "../src/utils/card-tree";

// Conversation.tsx runs every derivation of the CardNode tree through
// Solid's `reconcile({ key: "id" })`. In the browser bundle (solid-js/store
// store.js) reconcile performs an id-keyed array merge that preserves proxy
// identity and propagates field changes in place — eliminating the
// unmount/remount storm that made attachment images flicker.
//
// The bun test runner resolves solid-js/store to the *server* bundle, whose
// `reconcile` is a simplified shim that does not preserve array-item
// identity — so we cannot assert reconcile's own behaviour from here.
// Instead we assert the contract WE owe reconcile: every derivation of
// toCardTree must emit stable `id`s for stable inputs. If that contract
// holds, the browser-side reconcile will successfully merge by id; if it
// slips (e.g. someone reintroduces `Math.random()` into a fallback id),
// this test fires.

describe("toCardTree id stability", () => {
  test("same message item produces the same CardNode id on re-derivation", () => {
    const item = {
      info: {
        id: "ctx:user-request",
        role: "user",
        resolvedRole: "user",
        time: { created: 100 },
      },
      parts: [
        { id: "ctx:user-request:text", type: "text", text: "hi" },
      ],
    };
    const t1 = toCardTree([item]);
    const t2 = toCardTree([item]);
    expect(t1[0].id).toBe(t2[0].id);
    expect(t1[0].id).toBe("ctx:user-request");
  });

  test("agent card item produces the same id on re-derivation", () => {
    const item = {
      kind: "agent" as const,
      id: "spec:session:s1",
      stage: "spec",
      status: "running",
      round: 0,
      sessionID: "s1",
      time: 200,
      messages: [
        {
          info: { id: "m1", role: "assistant", resolvedRole: "spec", time: { created: 200 } },
          parts: [{ id: "p-m1", type: "text", text: "drafting" }],
        },
      ],
    };
    const t1 = toCardTree([item]);
    const t2 = toCardTree([item]);
    expect(t1[0].id).toBe(t2[0].id);
    expect(t1[0].id).toBe("spec:session:s1");
  });

  test("goal card item produces the same id and nested step ids on re-derivation", () => {
    const item = {
      kind: "goal" as const,
      id: "goal-group:g1",
      stage: "executor" as const,
      status: "running",
      round: 0,
      sessionID: "",
      time: 300,
      goalID: "g1",
      goalTitle: "G",
      goalStatus: "running",
      goalDescription: "",
      goalSteps: [
        { stepID: "build", label: "Build", status: "running", payload: undefined },
      ],
      internalCards: [],
    };
    const t1 = toCardTree([item]);
    const t2 = toCardTree([item]);
    expect(t1[0].id).toBe(t2[0].id);
    expect(t1[0].id).toBe("goal-group:g1");
    const step1 = t1[0].children[0];
    const step2 = t2[0].children[0];
    expect(step1.id).toBe(step2.id);
    expect(step1.id).toBe("goal-group:g1:step:build");
  });
});
