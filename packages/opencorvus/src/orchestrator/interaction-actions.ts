import { Database, eq } from "@/storage/db"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import {
  OrchestratorInteractionRequestTable,
  type OrchestratorInteractionStatus,
} from "./orchestrator.sql"
import type { InteractionRow } from "./store"

export function markInteraction(
  row: InteractionRow,
  status: OrchestratorInteractionStatus,
  response: Record<string, unknown>,
  now = Date.now(),
  summary = status === "answered" ? "Interaction answered" : "Interaction rejected",
) {
  Database.transaction((db) => {
    db.update(OrchestratorInteractionRequestTable)
      .set({
        status,
        response,
        time_resolved: now,
        time_updated: now,
      })
      .where(eq(OrchestratorInteractionRequestTable.id, row.id))
      .run()
    if (row.run_id) {
      const runID = row.run_id
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.InteractionResolved, {
          taskID: row.task_id,
          runID,
          interactionID: row.id,
          status,
          summary,
        }, { source: "interaction.mark" }),
      )
    }
  })
}
