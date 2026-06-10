import { Database as BunDatabase } from "bun:sqlite"
import { SQL, sql as drizzleSql } from "drizzle-orm"
import { getTableConfig } from "drizzle-orm/sqlite-core"
import { createHash } from "node:crypto"
import { Buffer } from "node:buffer"
import z from "zod"
import { collectTables, tableName } from "./ddl"
import { Database } from "./db"

export const MYSQL_TRANSFER_FORMAT = "opencorvus.mysql-transfer.v1" as const

const BlobCell = z.object({
  opencorvusType: z.literal("blobBase64"),
  base64: z.string(),
})

export const MysqlTransferTableSnapshot = z.object({
  name: z.string(),
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string(), z.unknown())),
})

export const MysqlTransferSnapshot = z.object({
  format: z.literal(MYSQL_TRANSFER_FORMAT),
  schemaFingerprint: z.string(),
  tables: z.array(MysqlTransferTableSnapshot),
})

export type MysqlTransferSnapshot = z.infer<typeof MysqlTransferSnapshot>

export const MysqlTransferSchemaExport = z.object({
  format: z.literal(MYSQL_TRANSFER_FORMAT),
  schemaFingerprint: z.string(),
  mysqlDDL: z.string(),
  tables: z.array(z.object({ name: z.string(), columns: z.array(z.string()) })),
  derivedTables: z.array(z.string()),
  skippedIndexes: z.array(z.object({ table: z.string(), index: z.string(), reason: z.string() })),
})

export type MysqlTransferSchemaExport = z.infer<typeof MysqlTransferSchemaExport>

export const MysqlTransferFullExport = z.object({
  schema: MysqlTransferSchemaExport,
  snapshot: MysqlTransferSnapshot,
})

export type MysqlTransferFullExport = z.infer<typeof MysqlTransferFullExport>

export const MysqlTransferImportResult = z.object({
  ok: z.boolean(),
  schemaFingerprint: z.string(),
  tables: z.array(z.object({ name: z.string(), rows: z.number() })),
})

export type MysqlTransferImportResult = z.infer<typeof MysqlTransferImportResult>

type TableConfig = ReturnType<typeof getTableConfig>
type Column = TableConfig["columns"][number]
type Index = TableConfig["indexes"][number]

type ColumnShape = {
  name: string
  sqliteType: string
  columnType: string
  dataType: string
  primary: boolean
  notNull: boolean
}

type TableShape = {
  name: string
  columns: ColumnShape[]
}

function mysqlIdentifier(name: string) {
  return `\`${name.replaceAll("`", "``")}\``
}

function sqliteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function mysqlLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function tableConfigs() {
  return collectTables().map((table) => getTableConfig(table as never))
}

function columnDataType(column: Column) {
  return String((column as Column & { config?: { dataType?: unknown } }).config?.dataType ?? "")
}

function columnType(column: Column) {
  return String((column as Column & { config?: { columnType?: unknown } }).config?.columnType ?? "")
}

function isSql(value: unknown): value is SQL {
  return value instanceof SQL
}

function indexColumnNames(index: Index) {
  const names: string[] = []
  for (const column of index.config.columns) {
    if (isSql(column)) return undefined
    names.push(column.name)
  }
  return names
}

function indexedTextColumns(config: TableConfig) {
  const names = new Set<string>()
  for (const index of config.indexes) {
    const columns = indexColumnNames(index)
    if (!columns) continue
    for (const column of columns) names.add(column)
  }
  for (const primaryKey of config.primaryKeys) {
    for (const column of primaryKey.columns) names.add(column.name)
  }
  for (const unique of config.uniqueConstraints) {
    for (const column of unique.columns) names.add(column.name)
  }
  for (const foreignKey of config.foreignKeys) {
    for (const column of foreignKey.reference().columns) names.add(column.name)
  }
  for (const column of config.columns) {
    if (column.primary) names.add(column.name)
  }
  return names
}

function mysqlColumnType(config: TableConfig, column: Column) {
  const type = columnType(column)
  const dataType = columnDataType(column)
  if (type === "SQLiteBoolean") return "TINYINT(1)"
  if (type === "SQLiteInteger") return "BIGINT"
  if (type === "SQLiteReal") return "DOUBLE"
  if (type === "SQLiteBlobBuffer") return "LONGBLOB"
  if (type === "SQLiteTextJson") return "LONGTEXT"
  if (type === "SQLiteText") {
    const indexed = indexedTextColumns(config)
    if (column.primary || indexed.has(column.name) || column.default !== undefined || dataType !== "string") return "VARCHAR(255)"
    return "LONGTEXT"
  }
  return column.getSQLType().toUpperCase()
}

function mysqlDefault(column: Column, mysqlType: string) {
  if (column.default === undefined) return undefined
  if (mysqlType === "LONGTEXT" || mysqlType === "LONGBLOB") return undefined
  if (typeof column.default === "number") return String(column.default)
  if (typeof column.default === "boolean") return column.default ? "1" : "0"
  if (typeof column.default === "string") return mysqlLiteral(column.default)
  return undefined
}

function renderMysqlColumn(config: TableConfig, column: Column) {
  const mysqlType = mysqlColumnType(config, column)
  const pieces = [mysqlIdentifier(column.name), mysqlType]
  if (column.notNull || column.primary) pieces.push("NOT NULL")
  const defaultValue = mysqlDefault(column, mysqlType)
  if (defaultValue !== undefined) pieces.push(`DEFAULT ${defaultValue}`)
  return pieces.join(" ")
}

function renderMysqlForeignKey(foreignKey: TableConfig["foreignKeys"][number]) {
  const reference = foreignKey.reference()
  const columns = reference.columns.map((column) => mysqlIdentifier(column.name)).join(", ")
  const foreignColumns = reference.foreignColumns.map((column) => mysqlIdentifier(column.name)).join(", ")
  const pieces = [
    `FOREIGN KEY (${columns}) REFERENCES ${mysqlIdentifier(tableName(reference.foreignTable))} (${foreignColumns})`,
  ]
  if (foreignKey.onDelete) pieces.push(`ON DELETE ${foreignKey.onDelete.toUpperCase()}`)
  if (foreignKey.onUpdate) pieces.push(`ON UPDATE ${foreignKey.onUpdate.toUpperCase()}`)
  return pieces.join(" ")
}

function renderMysqlIndex(config: TableConfig, index: Index) {
  if (index.config.where) {
    return {
      sql: undefined,
      skipped: {
        table: config.name,
        index: index.config.name,
        reason: "SQLite partial indexes have no direct MySQL staging equivalent.",
      },
    }
  }
  const columns = indexColumnNames(index)
  if (!columns) {
    return {
      sql: undefined,
      skipped: {
        table: config.name,
        index: index.config.name,
        reason: "SQLite expression indexes require generated columns before MySQL staging can index them.",
      },
    }
  }
  const unique = index.config.unique ? "UNIQUE " : ""
  return {
    sql: `CREATE ${unique}INDEX ${mysqlIdentifier(index.config.name)} ON ${mysqlIdentifier(config.name)} (${columns
      .map(mysqlIdentifier)
      .join(", ")});`,
    skipped: undefined,
  }
}

function tableShape(config: TableConfig): TableShape {
  return {
    name: config.name,
    columns: config.columns.map((column) => ({
      name: column.name,
      sqliteType: column.getSQLType(),
      columnType: columnType(column),
      dataType: columnDataType(column),
      primary: column.primary,
      notNull: column.notNull,
    })),
  }
}

function schemaShapes() {
  return tableConfigs().map(tableShape)
}

export function mysqlSchemaFingerprint() {
  const hash = createHash("sha256")
  hash.update(JSON.stringify(schemaShapes()))
  return hash.digest("hex")
}

export function mysqlSchemaExport(): MysqlTransferSchemaExport {
  const tables = tableConfigs()
  const skippedIndexes: MysqlTransferSchemaExport["skippedIndexes"] = []
  const statements: string[] = [
    "SET NAMES utf8mb4;",
    "SET FOREIGN_KEY_CHECKS = 0;",
  ]

  for (const config of tables) {
    const definitions = config.columns.map((column) => `  ${renderMysqlColumn(config, column)}`)
    const inlineConstraints: string[] = []
    const inlinePrimary = config.columns.filter((column) => column.primary)
    if (inlinePrimary.length > 0) {
      inlineConstraints.push(`PRIMARY KEY (${inlinePrimary.map((column) => mysqlIdentifier(column.name)).join(", ")})`)
    }
    for (const primaryKey of config.primaryKeys) {
      inlineConstraints.push(`PRIMARY KEY (${primaryKey.columns.map((column) => mysqlIdentifier(column.name)).join(", ")})`)
    }
    for (const unique of config.uniqueConstraints) {
      inlineConstraints.push(`UNIQUE (${unique.columns.map((column) => mysqlIdentifier(column.name)).join(", ")})`)
    }
    for (const foreignKey of config.foreignKeys) {
      inlineConstraints.push(renderMysqlForeignKey(foreignKey))
    }
    const tableSql = [
      `CREATE TABLE IF NOT EXISTS ${mysqlIdentifier(config.name)} (`,
      [...definitions, ...inlineConstraints.map((constraint) => `  ${constraint}`)].join(",\n"),
      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;",
    ].join("\n")
    statements.push(tableSql)
  }

  for (const config of tables) {
    for (const index of config.indexes) {
      const rendered = renderMysqlIndex(config, index)
      if (rendered.skipped) skippedIndexes.push(rendered.skipped)
      if (rendered.sql) statements.push(rendered.sql)
    }
  }
  statements.push("SET FOREIGN_KEY_CHECKS = 1;")

  return {
    format: MYSQL_TRANSFER_FORMAT,
    schemaFingerprint: mysqlSchemaFingerprint(),
    mysqlDDL: statements.join("\n\n"),
    tables: schemaShapes().map((table) => ({ name: table.name, columns: table.columns.map((column) => column.name) })),
    derivedTables: ["memory_fts"],
    skippedIndexes,
  }
}

function encodeSnapshotCell(value: unknown) {
  if (value instanceof Uint8Array) {
    return { opencorvusType: "blobBase64", base64: Buffer.from(value).toString("base64") }
  }
  if (Buffer.isBuffer(value)) {
    return { opencorvusType: "blobBase64", base64: value.toString("base64") }
  }
  return value
}

export function exportMysqlTransferSnapshot(): MysqlTransferSnapshot {
  try {
    const tables = schemaShapes().map((table) => {
      const rows = Database.use((db) =>
        db.all<Record<string, unknown>>(drizzleSql.raw(`SELECT * FROM ${sqliteIdentifier(table.name)}`)),
      )
        .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, encodeSnapshotCell(value)])))
      return { name: table.name, columns: table.columns.map((column) => column.name), rows }
    })
    return { format: MYSQL_TRANSFER_FORMAT, schemaFingerprint: mysqlSchemaFingerprint(), tables }
  } finally {
    Database.close()
  }
}

export function exportMysqlTransferPackage(): MysqlTransferFullExport {
  return {
    schema: mysqlSchemaExport(),
    snapshot: exportMysqlTransferSnapshot(),
  }
}

function assertExactTableSet(snapshot: MysqlTransferSnapshot, expected: TableShape[]) {
  const actualNames = new Set(snapshot.tables.map((table) => table.name))
  const expectedNames = new Set(expected.map((table) => table.name))
  for (const name of actualNames) {
    if (!expectedNames.has(name)) throw new Error(`Unexpected table in MySQL transfer snapshot: ${name}`)
  }
  for (const name of expectedNames) {
    if (!actualNames.has(name)) throw new Error(`Missing table in MySQL transfer snapshot: ${name}`)
  }
}

function assertExactColumns(table: z.infer<typeof MysqlTransferTableSnapshot>, expected: TableShape) {
  const actual = table.columns.join(",")
  const canonical = expected.columns.map((column) => column.name).join(",")
  if (actual !== canonical) {
    throw new Error(`Column mismatch for table ${table.name}: expected [${canonical}], received [${actual}]`)
  }
  const allowed = new Set(table.columns)
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const key of Object.keys(row)) {
      if (!allowed.has(key)) throw new Error(`Unexpected column ${table.name}.${key} at row ${rowIndex}`)
    }
  }
}

function isBlobCell(value: unknown): value is z.infer<typeof BlobCell> {
  return BlobCell.safeParse(value).success
}

function decodeBlob(value: unknown, table: string, column: string) {
  if (!isBlobCell(value)) throw new Error(`Expected blobBase64 cell for ${table}.${column}`)
  return new Uint8Array(Buffer.from(value.base64, "base64"))
}

function normalizeNumber(value: unknown, table: string, column: string) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value)
  throw new Error(`Expected numeric cell for ${table}.${column}`)
}

function sqliteValue(value: unknown, table: string, column: ColumnShape) {
  if (value === null || value === undefined) return null
  if (column.columnType === "SQLiteBlobBuffer") return decodeBlob(value, table, column.name)
  if (column.columnType === "SQLiteBoolean") {
    if (typeof value === "boolean") return value ? 1 : 0
    return normalizeNumber(value, table, column.name) ? 1 : 0
  }
  if (column.columnType === "SQLiteInteger" || column.columnType === "SQLiteReal") {
    return normalizeNumber(value, table, column.name)
  }
  if (column.columnType === "SQLiteTextJson") {
    if (typeof value === "string") return value
    return JSON.stringify(value)
  }
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  throw new Error(`Expected scalar text cell for ${table}.${column.name}`)
}

function insertRows(sqlite: BunDatabase, table: TableShape, rows: Array<Record<string, unknown>>) {
  if (rows.length === 0) return
  const columnNames = table.columns.map((column) => column.name)
  const sql = `INSERT INTO ${sqliteIdentifier(table.name)} (${columnNames.map(sqliteIdentifier).join(", ")}) VALUES (${columnNames
    .map(() => "?")
    .join(", ")})`
  const statement = sqlite.query(sql)
  for (const row of rows) {
    const values = table.columns.map((column) => sqliteValue(row[column.name], table.name, column))
    statement.run(...values)
  }
}

function rebuildMemoryFts(sqlite: BunDatabase) {
  // FTS means Full-Text Search. The SQLite virtual table is derived from
  // memory_chunk rows, so transfer snapshots carry only the source rows.
  sqlite.run("DELETE FROM memory_fts")
  sqlite.run("INSERT INTO memory_fts (content, chunk_id, project_id) SELECT content, id, project_id FROM memory_chunk")
}

export function importMysqlTransferSnapshot(rawSnapshot: unknown): MysqlTransferImportResult {
  const snapshot = MysqlTransferSnapshot.parse(rawSnapshot)
  const fingerprint = mysqlSchemaFingerprint()
  if (snapshot.schemaFingerprint !== fingerprint) {
    throw new Error(
      `MySQL transfer schema fingerprint mismatch: expected ${fingerprint}, received ${snapshot.schemaFingerprint}`,
    )
  }

  const expectedTables = schemaShapes()
  assertExactTableSet(snapshot, expectedTables)
  const tableByName = new Map(snapshot.tables.map((table) => [table.name, table]))
  for (const expected of expectedTables) {
    const table = tableByName.get(expected.name)
    if (!table) throw new Error(`Missing table in MySQL transfer snapshot: ${expected.name}`)
    assertExactColumns(table, expected)
  }

  const imported: Array<{ name: string; rows: number }> = []
  Database.rebuildSqlite((sqlite) => {
    for (const expected of expectedTables) {
      const table = tableByName.get(expected.name)
      if (!table) throw new Error(`Missing table in MySQL transfer snapshot: ${expected.name}`)
      insertRows(sqlite, expected, table.rows)
      imported.push({ name: expected.name, rows: table.rows.length })
    }
    rebuildMemoryFts(sqlite)
  })

  return { ok: true, schemaFingerprint: fingerprint, tables: imported }
}
