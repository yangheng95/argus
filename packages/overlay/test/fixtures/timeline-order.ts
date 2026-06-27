export function testTimelineOrderKey(rank: number, time: number, id: string, sequence = 0, domain = "test"): string {
  return `v1:${String(time).padStart(16, "0")}:${String(rank).padStart(16, "0")}:${String(sequence).padStart(16, "0")}:${domain}:${id}`
}

export function testTaskOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(10, time, id)
}

export function testMessageOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(30, time, id, 0, "message")
}

export function testPartOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(31, time, id, 0, "part")
}

export function testBoardOrderKey(id: string, time: number, rank: number): string {
  return testTimelineOrderKey(rank, time, id)
}

export function testInteractionOrderKey(id: string, time: number): string {
  return testTimelineOrderKey(70, time, id)
}

export function testEventOrderKey(type: string, time: number, sequence = 0): string {
  return testTimelineOrderKey(40, time, `evt_${type}_${time}`, sequence)
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
    const created = Number(info?.time?.created || 0)
    return {
      ...message,
      info: {
        ...info,
        orderKey: info.orderKey || testMessageOrderKey(String(info.id || ""), created),
      },
    }
  })
}

export function stampTestViewMessages(messages: any[]): any[] {
  return (Array.isArray(messages) ? messages : []).map((message) => ({
    ...message,
    orderKey: message.orderKey || testMessageOrderKey(String(message.messageID || ""), Number(message.time || 0)),
  }))
}

export function stampTestViewSessions(sessions: any[]): any[] {
  return (Array.isArray(sessions) ? sessions : []).map((session) => {
    const observedAt = Number(session.firstObservedAt ?? session.firstMessageTime ?? session.lastMessageTime ?? 0)
    return {
      ...session,
      orderKey: session.orderKey || testMessageOrderKey(String(session.sessionID || ""), observedAt),
    }
  })
}

export function stampTestEvent(event: any): any {
  const emittedAt = Number(event?.emittedAt || event?.timestamp || 0)
  const base =
    emittedAt > 0 && !event?.orderKey
      ? {
          ...event,
          orderKey: testEventOrderKey(String(event?.type || "event"), emittedAt, Number(event?.sequence || 0)),
        }
      : event
  const props = base?.properties && typeof base.properties === "object" ? base.properties : base?.payload
  if (!props || typeof props !== "object") return base

  if (props.info && typeof props.info === "object") {
    const created = Number(props.info?.time?.created || 0)
    return {
      ...base,
      properties: {
        ...props,
        info: {
          ...props.info,
          orderKey: props.info.orderKey || testMessageOrderKey(String(props.info.id || ""), created),
        },
      },
    }
  }

  if (props.part && typeof props.part === "object") {
    const time = Number(base?.emittedAt || base?.timestamp || props.part?.time?.created || 1)
    const orderKey = props.orderKey || props.part.orderKey || testPartOrderKey(String(props.part.id || ""), time)
    return {
      ...base,
      properties: {
        ...props,
        orderKey,
        part: {
          ...props.part,
          orderKey: props.part.orderKey || orderKey,
        },
      },
    }
  }

  if (props.task && typeof props.task === "object") {
    const created = Number(props.task?.time?.created || base?.emittedAt || base?.timestamp || 1)
    return {
      ...base,
      properties: {
        ...props,
        task: {
          ...props.task,
          orderKey: props.task.orderKey || testTaskOrderKey(String(props.task.id || props.taskID || "task"), created),
        },
      },
    }
  }

  return base
}
