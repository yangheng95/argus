import { beforeEach, expect, test } from "bun:test"
import { conversationMessages } from "../src/utils/conversation"
import { appendAgentEvent, clearAgentEvents, messageStore, setMessages, setAgentEvents, setSelectedTaskID } from "../src/store/messages"
import { setBoardStore } from "../src/store/board"

function resetStores() {
  setMessages([])
  clearAgentEvents()
  setSelectedTaskID("")
  setBoardStore("board", null)
  setBoardStore("selectedTaskID", "")
  setBoardStore("taskSequence", 0)
}

beforeEach(() => {
  resetStores()
})

test("builds a live agent card when only agent events exist", () => {
  setBoardStore("board", {
    task: {
      status: "evaluating",
    },
  })
  setAgentEvents([
    {
      id: "judge:start",
      stage: "judge",
      kind: "status",
      summary: "Evaluator agent started",
      time: { created: 1000 },
      _targetText: "Evaluator agent started",
      _liveText: "Evaluator agent started",
    },
  ])

  const items = conversationMessages()
  const card = items.find((item: any) => item?._agentCard)

  expect(card?._agentStage).toBe("judge")
  expect(card?._agentStatus).toBe("running")
  expect(card?._agentMessages).toHaveLength(1)
  expect(card?._agentMessages?.[0]?.parts?.[0]?.text).toBe("Evaluator agent started")
})

test("keeps transcript-backed cards canonical for the same stage", () => {
  setBoardStore("board", {
    task: {
      status: "planning",
    },
  })
  setMessages([
    {
      info: {
        id: "planner-msg-1",
        role: "assistant",
        agent: "planner",
        sessionID: "planner-session-1",
        time: { created: 2000 },
      },
      parts: [{ id: "planner-part-1", type: "text", text: "First planning note" }],
    },
  ])
  setAgentEvents([
    {
      id: "planner-status-1",
      stage: "planner",
      kind: "status",
      summary: "Planner agent started",
      time: { created: 1500 },
      _targetText: "Planner agent started",
      _liveText: "Planner agent started",
    },
  ])

  const cards = conversationMessages().filter((item: any) => item?._agentCard)

  expect(cards).toHaveLength(1)
  expect(cards[0]?._agentStage).toBe("planner")
  expect(cards[0]?._agentMessages).toHaveLength(1)
  expect(cards[0]?._agentMessages?.[0]?.parts?.[0]?.text).toBe("First planning note")
})

test("prunes live agent events per stage and ignores other tasks", () => {
  setSelectedTaskID("task-live")
  setBoardStore("selectedTaskID", "task-live")
  setBoardStore("board", {
    task: {
      status: "planning",
    },
  })

  for (let i = 0; i < 20; i += 1) {
    appendAgentEvent({
      type: "agent.updated",
      timestamp: 1000 + i,
      payload: {
        taskID: "task-live",
        stage: "goal",
        kind: "status",
        id: `goal-${i}`,
        summary: `Goal event ${i}`,
      },
    })
  }
  appendAgentEvent({
    type: "agent.updated",
    timestamp: 5000,
    payload: {
      taskID: "other-task",
      stage: "goal",
      kind: "status",
      id: "goal-other",
      summary: "Should be ignored",
    },
  })

  expect(messageStore.agentEvents).toHaveLength(12)
  expect(messageStore.agentEvents[0]?.summary).toBe("Goal event 8")
  expect(messageStore.agentEvents.at(-1)?.summary).toBe("Goal event 19")

  const cards = conversationMessages().filter((item: any) => item?._agentCard)
  expect(cards).toHaveLength(1)
  expect(cards[0]?._agentMessages).toHaveLength(12)
  expect(cards[0]?._agentMessages?.[0]?.parts?.[0]?.text).toBe("Goal event 8")
})
