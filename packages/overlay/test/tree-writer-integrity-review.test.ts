import { test, expect } from "bun:test";

(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test";

const { applyEvent, resetWriter } = await import("../src/services/tree-writer");
const { cardTreeStore } = await import("../src/store/card-tree");

function stampedInfo(channel: string, info: Record<string, any>) {
  return {
    ...info,
    resolvedRole: info.resolvedRole ?? channel,
    agent: info.agent ?? channel,
    channel,
  };
}

function applyIntegrityMessage(input: {
  sessionID: string
  messageID: string
  parentSessionID?: string
  created: number
}) {
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: "tsk_team",
      info: stampedInfo("integrity", {
        id: input.messageID,
        sessionID: input.sessionID,
        parentSessionID: input.parentSessionID,
        role: "assistant",
        time: { created: input.created },
      }),
    },
  });
}

test("retired legacy gate event is not accepted by the tree writer", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "delivery.gate.rejected",
      emittedAt: 1700000000000,
      properties: {
        taskID: "tsk_abc",
        iteration: 0,
        summary: "Runtime-evidence gate rejected delivery.",
        violations: [{ kind: "empty_root_shell", detail: "empty root" }],
      },
    }),
  ).toThrow(/unhandled event type/);
});

test("legacy delivery evidence remains pass-through and does not materialize a card", () => {
  resetWriter();

  applyEvent({
    type: "delivery.evidence.updated",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_manifest",
      runID: "run_manifest",
      deliveryID: "dlv_manifest",
      manifestID: "artifact_manifest",
      iteration: 2,
      status: "failed",
      summary: "Legacy evidence failed 1 required check.",
      failedCheckCount: 1,
      failedReviewCount: 1,
      failureDetails: [
        {
          kind: "check",
          id: "check:build",
          name: "Build",
          status: "failed",
          command: "bun run build",
          exitCode: 1,
          evidence: "tsc exited with code 1",
        },
      ],
    },
  });

  expect(cardTreeStore.cards["delivery-evidence:tsk_manifest:2"]).toBeUndefined();
  expect(cardTreeStore.order.includes("delivery-evidence:tsk_manifest:2")).toBe(false);
});

test("retired delivery review completion event is not accepted by the tree writer", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "delivery.review.completed",
      emittedAt: 1700000000200,
      properties: {
        taskID: "tsk_review",
        reviewID: "delivery:tsk_review:2",
        verdict: "rejected",
        source: "host_gate",
        summary: "Host gate rejected",
        hostGatePassed: false,
        failureKinds: ["runtime"],
        rejectionCount: 1,
        deferredCount: 0,
        details: ["Runtime render failed"],
      },
    }),
  ).toThrow(/unhandled event type/);
});

test("integrity review stream builds the integrity session card", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_integrity",
      reviewID: "integrity:ses_integrity",
      phase: "integrity",
      sessionID: "ses_integrity",
    },
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000100,
    properties: {
      taskID: "tsk_integrity",
      reviewID: "integrity:ses_integrity",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "reason",
    },
  });

  const card = cardTreeStore.cards["integrity:session:ses_integrity"];
  expect(card).toBeDefined();
  expect(card?.stage).toBe("integrity");
  expect(card?.parts[0]).toMatchObject({
    partID: "review:integrity:ses_integrity:reasoning:1",
    text: "reason",
  });
});

test("integrity review chunk reconstructs running card when started is outside the loaded event window", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000100,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_late_chunk",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "late reasoning",
    },
  });

  const card = cardTreeStore.cards["integrity:session:ses_late_chunk"];
  expect(card?.status).toBe("running");
  expect(card?.sessionID).toBe("ses_late_chunk");
  expect(card?.parts).toEqual([
    {
      type: "reasoning",
      partID: "review:integrity:ses_late_chunk:reasoning:1",
      text: "late reasoning",
    },
  ]);
});

test("integrity review progress reconstructs running card when started is outside the loaded event window", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.progress",
    emittedAt: 1700000020000,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_late_progress",
      phase: "integrity",
      currentStep: "agent",
      attempt: 2,
      elapsedMs: 20_000,
      summary: "reviewing loaded tail",
    },
  });

  const card = cardTreeStore.cards["integrity:session:ses_late_progress"];
  expect(card?.status).toBe("running");
  expect(card?.sessionID).toBe("ses_late_progress");
  expect(card?.subtitle).toContain("integrity.attempt_label");
  expect(card?.reviewStream).toMatchObject({
    phase: "integrity",
    currentStep: "agent",
    elapsedMs: 20_000,
    summary: "reviewing loaded tail",
  });
  expect(card?.time).toBe(1700000000000);
});

test("multiple reviewers with independent reviewIDs do not cross-contaminate a single part", () => {
  // Regression: before the fix in
  // specs/new-arch/2026-05-26-integrity-reviewer-stream-reviewid.md
  // all N integrity reviewers shared the supervisor's reviewID, so
  // their reasoning streams collapsed onto one overlay partID and the
  // SolidJS Store rendered ~195KB of interleaved text per task.
  resetWriter();

  // Supervisor opens the integrity review stream.
  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_super",
      phase: "integrity",
      sessionID: "ses_super",
    },
  });
  // Each reviewer opens its OWN review stream against its own session.
  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000010,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_rev_a",
      phase: "integrity",
      sessionID: "ses_rev_a",
    },
  });
  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000020,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_rev_b",
      phase: "integrity",
      sessionID: "ses_rev_b",
    },
  });
  applyIntegrityMessage({
    sessionID: "ses_super",
    messageID: "msg_super",
    created: 1700000000030,
  });
  applyIntegrityMessage({
    sessionID: "ses_rev_a",
    messageID: "msg_rev_a",
    parentSessionID: "ses_super",
    created: 1700000000040,
  });
  applyIntegrityMessage({
    sessionID: "ses_rev_b",
    messageID: "msg_rev_b",
    parentSessionID: "ses_super",
    created: 1700000000050,
  });

  // Interleaved chunks from all three sources.
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000100,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_super",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "S",
    },
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000110,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_rev_a",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "A",
    },
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000120,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_rev_b",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "B",
    },
  });
  applyEvent({
    type: "review.stream.chunk",
    emittedAt: 1700000000130,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_rev_a",
      phase: "integrity",
      kind: "reasoning",
      attempt: 1,
      delta: "AA",
    },
  });

  const supervisorCard = cardTreeStore.cards["integrity:session:ses_super"];
  const reviewerACard = cardTreeStore.cards["integrity:session:ses_rev_a"];
  const reviewerBCard = cardTreeStore.cards["integrity:session:ses_rev_b"];

  expect(supervisorCard).toBeDefined();
  expect(reviewerACard).toBeDefined();
  expect(reviewerBCard).toBeDefined();
  expect(reviewerACard?.kind).toBe("agent");
  expect(reviewerACard?.stage).toBe("integrity");
  expect(reviewerACard?.integrity).toBeUndefined();

  expect(supervisorCard?.parts[0]).toMatchObject({
    partID: "review:integrity:ses_super:reasoning:1",
    text: "S",
  });
  expect(reviewerACard?.parts[0]).toMatchObject({
    partID: "review:integrity:ses_rev_a:reasoning:1",
    text: "AAA",
  });
  expect(reviewerBCard?.parts[0]).toMatchObject({
    partID: "review:integrity:ses_rev_b:reasoning:1",
    text: "B",
  });
  expect(supervisorCard?.childIDs).toEqual([
    "integrity:session:ses_rev_a",
    "integrity:session:ses_rev_b",
  ]);
  expect(cardTreeStore.order).toContain("integrity:session:ses_super");
  expect(cardTreeStore.order).not.toContain("integrity:session:ses_rev_a");
  expect(cardTreeStore.order).not.toContain("integrity:session:ses_rev_b");
});

test("malformed reviewer chunk without a reconstructable integrity session still throws", () => {
  resetWriter();

  applyEvent({
    type: "review.stream.started",
    emittedAt: 1700000000000,
    properties: {
      taskID: "tsk_team",
      reviewID: "integrity:ses_super",
      phase: "integrity",
      sessionID: "ses_super",
    },
  });

  expect(() =>
    applyEvent({
      type: "review.stream.chunk",
      emittedAt: 1700000000100,
      properties: {
        taskID: "tsk_team",
        reviewID: "integrity:not_a_session",
        phase: "integrity",
        kind: "reasoning",
        attempt: 1,
        delta: "orphan",
      },
    }),
  ).toThrow(/arrived before started/);
});

test("review stream rejects retired delivery phase", () => {
  resetWriter();

  expect(() =>
    applyEvent({
      type: "review.stream.started",
      emittedAt: 1700000000000,
      properties: {
        taskID: "tsk_review",
        reviewID: "delivery:tsk_review:0",
        phase: "delivery",
      },
    }),
  ).toThrow(/review\.stream phase unsupported: delivery/);
});
