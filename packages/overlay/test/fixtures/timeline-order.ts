export function testTimelineOrderKey(rank: number, time: number, id: string, sequence = 0, domain = "test"): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

export function testTaskOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(10, time, id, 0, "task")
}

export function testMessageOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(30, time, id, 0, "message")
}

export function testPartOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(31, time, id, 0, "part")
}

export function testBoardOrderKey(id: string, time: number, rank: number): string {
  return testTimelineOrderKey(rank, time, id, 0, "board")
}

export function testInteractionOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(70, time, id, 0, "interaction")
}

export function testEventOrderKey(type: string, time: number, sequence = 0): string {
  return testTimelineOrderKey(40, time, `evt_${type}_${time}`, sequence, "event")
}

export function testSessionOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(50, time, id, 0, "session")
}

function requireExplicitOrderKey(value: unknown, label: string, domain?: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`test fixture ${label} missing orderKey`)
  if (domain) {
    const actualDomain = value.split(":", 6)[4] || ""
    if (actualDomain !== domain) {
      throw new Error(`test fixture ${label} expected ${domain} orderKey, got ${actualDomain}: ${value}`)
    }
  }
  return value
}

export function stampTestBoard(board: any): any {
  if (!board || typeof board !== "object" || Array.isArray(board)) return board
  const task = board.task && typeof board.task === "object" ? board.task : undefined
  const taskCreated = Number(task?.time?.created || 1)
  return {
    ...board,
    ...(task
      ? {
          task: {
            ...task,
            orderKey: task.orderKey || testTaskOrderKey(String(task.id || "task"), taskCreated),
          },
        }
      : {}),
    workflow:
      board.workflow && typeof board.workflow === "object"
        ? {
            ...board.workflow,
            steps: Array.isArray(board.workflow.steps)
              ? board.workflow.steps.map((step: any) => ({
                  ...step,
                  orderKey:
                    step.orderKey ||
                    testBoardOrderKey(
                      `${String(task?.id || "task")}-${String(step?.stepID || step?.id || "step")}`,
                      taskCreated,
                      61,
                    ),
                }))
              : board.workflow.steps,
          }
        : board.workflow,
    goalWorkflows: Array.isArray(board.goalWorkflows)
      ? board.goalWorkflows.map((goal: any) => {
          const goalCreated = Number(goal?.time?.created || goal?.startedAt || taskCreated)
          return {
            ...goal,
            orderKey: goal.orderKey || testBoardOrderKey(String(goal?.goalID || "goal"), goalCreated, 60),
            steps: Array.isArray(goal?.steps)
              ? goal.steps.map((step: any) => {
                  const stepStarted = Number(step?.startedAt || goalCreated)
                  return {
                    ...step,
                    orderKey:
                      step.orderKey ||
                      testBoardOrderKey(
                        `${String(goal?.goalID || "goal")}-${String(step?.stepID || "step")}`,
                        stepStarted,
                        61,
                      ),
                    phases:
                      step.phases && typeof step.phases === "object" && !Array.isArray(step.phases)
                        ? Object.fromEntries(
                            Object.entries(step.phases).map(([phaseID, phase]: [string, any]) => {
                              const phaseStarted = Number(phase?.startedAt || stepStarted)
                              return [
                                phaseID,
                                {
                                  ...phase,
                                  orderKey:
                                    phase?.orderKey ||
                                    testBoardOrderKey(
                                      `${String(goal?.goalID || "goal")}-${String(step?.stepID || "step")}-${phaseID}`,
                                      phaseStarted,
                                      62,
                                    ),
                                },
                              ]
                            }),
                          )
                        : step.phases,
                  }
                })
              : goal?.steps,
          }
        })
      : board.goalWorkflows,
    interactions: Array.isArray(board.interactions)
      ? board.interactions.map((interaction: any) => {
          const created = Number(interaction?.time?.created || taskCreated)
          return {
            ...interaction,
            orderKey:
              interaction.orderKey || testInteractionOrderKey(String(interaction?.id || "interaction"), created),
          }
        })
      : board.interactions,
  }
}

export function stampTestTranscript(transcript: any[]): any[] {
  return (Array.isArray(transcript) ? transcript : []).map((message) => {
    const info = message?.info || {}
    const messageID = String(info.id || "")
    const sessionID = String(info.sessionID || "")
    return {
      ...message,
      info: {
        ...info,
        orderKey: requireExplicitOrderKey(info.orderKey, `message ${messageID || "<unknown>"}`, "message"),
      },
      parts: Array.isArray(message?.parts)
        ? message.parts.map((part: any) => {
            const partID = String(part?.id || "")
            return {
              ...part,
              orderKey: requireExplicitOrderKey(part.orderKey, `part ${partID || "<unknown>"}`, "part"),
            }
          })
        : message?.parts,
    }
  })
}

export function stampTestViewMessages(messages: any[]): any[] {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    orderKey: requireExplicitOrderKey(
      message.orderKey,
      `view message ${String(message.messageID || "<unknown>")}`,
      "message",
    ),
  }))
}

export function stampTestViewSessions(sessions: any[]): any[] {
  return (Array.isArray(sessions) ? sessions : []).map((session) => ({
    ...session,
    orderKey: requireExplicitOrderKey(
      session.orderKey,
      `view session ${String(session.sessionID || "<unknown>")}`,
      "session",
    ),
  }))
}

export function stampTestEvent(event: any): any {
  const eventType = String(event?.type || "event")
  const base = {
    ...event,
    orderKey: requireExplicitOrderKey(event?.orderKey, `event ${eventType}`),
  }
  const props = base?.properties && typeof base.properties === "object" ? base.properties : base?.payload
  if (!props || typeof props !== "object") return base

  if (props.info && typeof props.info === "object") {
    const messageID = String(props.info.id || "")
    const messageOrderKey = requireExplicitOrderKey(
      props.info.orderKey,
      `event message ${messageID || "<unknown>"}`,
      "message",
    )
    if (base.orderKey !== messageOrderKey) {
      throw new Error(`test fixture event ${eventType} orderKey does not match message ${messageID || "<unknown>"}`)
    }
    return {
      ...base,
      orderKey: messageOrderKey,
      properties: {
        ...props,
        info: {
          ...props.info,
          orderKey: messageOrderKey,
        },
      },
    }
  }

  if (props.part && typeof props.part === "object") {
    const messageID = String(props.part.messageID || "")
    const partID = String(props.part.id || "")
    const messageOrderKey = requireExplicitOrderKey(
      props.orderKey,
      `event part owner ${messageID || "<unknown>"}`,
      "message",
    )
    const partOrderKey = requireExplicitOrderKey(props.part.orderKey, `event part ${partID || "<unknown>"}`, "part")
    if (base.orderKey !== messageOrderKey) {
      throw new Error(`test fixture event ${eventType} orderKey does not match owner message ${messageID || "<unknown>"}`)
    }
    return {
      ...base,
      orderKey: messageOrderKey,
      properties: {
        ...props,
        orderKey: messageOrderKey,
        part: {
          ...props.part,
          orderKey: partOrderKey,
        },
      },
    }
  }

  if (props.task && typeof props.task === "object") {
    return {
      ...base,
      properties: {
        ...props,
        task: {
          ...props.task,
          orderKey: requireExplicitOrderKey(
            props.task.orderKey,
            `event task ${String(props.task.id || props.taskID || "<unknown>")}`,
            "task",
          ),
        },
      },
    }
  }

  return base
}
