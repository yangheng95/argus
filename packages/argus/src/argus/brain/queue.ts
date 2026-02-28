import { Bus } from "../../bus"
import { Log } from "../../util/log"
import { MonitorEvent } from "../monitor/events"
import type { StagedCommand } from "../monitor/types"

const log = Log.create({ service: "monitor-queue" })

const PRIORITY_ORDER: Record<StagedCommand["priority"], number> = {
  urgent: 0,
  high: 1,
  normal: 2,
  low: 3,
}

export namespace CommandQueue {
  const queue: StagedCommand[] = []
  const listeners: Array<() => void> = []

  export function stage(command: StagedCommand): void {
    queue.push(command)
    // Sort: lower priority number = higher priority, same priority = FIFO (stable sort)
    queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])

    log.info("command staged", {
      id: command.id,
      priority: command.priority,
      source: command.source,
    })

    Bus.publish(MonitorEvent.CommandStaged, {
      id: command.id,
      priority: command.priority,
      source: command.source,
      content: command.content,
      timestamp: command.timestamp,
    })

    for (const listener of listeners) {
      listener()
    }
  }

  export function peek(): StagedCommand | undefined {
    return queue[0]
  }

  export function dequeue(): StagedCommand | undefined {
    return queue.shift()
  }

  export function size(): number {
    return queue.length
  }

  export function list(): StagedCommand[] {
    return [...queue]
  }

  export function clear(): void {
    queue.length = 0
    log.info("queue cleared")
  }

  export function onEnqueue(listener: () => void): () => void {
    listeners.push(listener)
    return () => {
      const index = listeners.indexOf(listener)
      if (index !== -1) listeners.splice(index, 1)
    }
  }
}
