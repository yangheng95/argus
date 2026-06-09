import { describe, expect, test } from "bun:test"
import { Database as Sqlite } from "bun:sqlite"
import { ProtocolEnvelope, ProtocolInboxMessage } from "../../src/protocol/schema"
import { SCHEMA_DDL } from "../../src/storage/ddl"

describe("protocol.v2", () => {
  test("parses protocol envelope and companion records", () => {
    const envelope = ProtocolEnvelope.parse({
      id: "pev_000000000001abcdefghijklmn",
      kind: "event",
      type: "run.started",
      aggregate: "run",
      aggregate_id: "run_1",
      task_id: "tsk_000000000001abcdefghijklmn",
      run_id: "run_000000000001abcdefghijklmn",
      source: "runtime",
      seq: 1,
      emitted_at: Date.now(),
      payload: { hello: "world" },
    })
    const inbox = ProtocolInboxMessage.parse({
      id: "pib_000000000001abcdefghijklmn",
      envelope_id: envelope.id,
      actor: "run",
      actor_id: envelope.aggregate_id,
      status: "pending",
      attempt: 0,
      visible_at: Date.now(),
    })
    expect(inbox.envelope_id).toBe(envelope.id)
  })

  test("schema ddl includes protocol v2 tables", () => {
    const sqlite = new Sqlite(":memory:")
    sqlite.exec("PRAGMA foreign_keys = ON")
    sqlite.exec(SCHEMA_DDL)

    const names = sqlite.query("select name from sqlite_master where type = 'table'").all() as Array<{ name: string }>

    expect(names.some((item) => item.name === "protocol_event")).toBe(true)
    expect(names.some((item) => item.name === "protocol_inbox")).toBe(true)

    sqlite.close()
  })
})
