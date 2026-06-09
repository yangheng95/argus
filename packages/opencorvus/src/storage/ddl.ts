import { SQL } from "drizzle-orm"
import { getTableConfig, SQLiteSyncDialect } from "drizzle-orm/sqlite-core"
import * as schema from "./schema"

type Column = ReturnType<typeof getTableConfig>["columns"][number]
type IndexColumn = ReturnType<typeof getTableConfig>["indexes"][number]["config"]["columns"][number]

const dialect = new SQLiteSyncDialect()
const deferredIndexNames = new Set(["engine_channel_binding_thread_idx"])

function quoteIdentifier(name: string) {
  return `"${name.replaceAll('"', '""')}"`
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`
}

function tableName(table: unknown) {
  return getTableConfig(table as never).name
}

function renderDefault(column: Column) {
  if (column.default === undefined) return undefined
  if (typeof column.default === "number") return String(column.default)
  if (typeof column.default === "boolean") return column.default ? "1" : "0"
  if (typeof column.default === "string") return quoteLiteral(column.default)
  return quoteLiteral(JSON.stringify(column.default))
}

function renderColumn(column: Column) {
  const pieces = [quoteIdentifier(column.name), column.getSQLType()]

  if (column.primary) pieces.push("PRIMARY KEY")
  if (column.notNull) pieces.push("NOT NULL")

  const defaultValue = renderDefault(column)
  if (defaultValue !== undefined) pieces.push(`DEFAULT ${defaultValue}`)

  return pieces.join(" ")
}

function renderForeignKey(foreignKey: ReturnType<typeof getTableConfig>["foreignKeys"][number]) {
  const reference = foreignKey.reference()
  const columns = reference.columns.map((column) => quoteIdentifier(column.name)).join(", ")
  const foreignColumns = reference.foreignColumns.map((column) => quoteIdentifier(column.name)).join(", ")
  const pieces = [
    `FOREIGN KEY (${columns}) REFERENCES ${quoteIdentifier(tableName(reference.foreignTable))}(${foreignColumns})`,
  ]

  if (foreignKey.onDelete) pieces.push(`ON DELETE ${foreignKey.onDelete.toUpperCase()}`)
  if (foreignKey.onUpdate) pieces.push(`ON UPDATE ${foreignKey.onUpdate.toUpperCase()}`)

  return pieces.join(" ")
}

function renderSql(value: SQL) {
  const query = dialect.sqlToQuery(value)
  if (query.params.length > 0) {
    throw new Error(`Schema DDL SQL expressions must be static; received ${query.params.length} params`)
  }
  return query.sql
}

function renderIndexSql(value: SQL, currentTableName: string) {
  return renderSql(value).replaceAll(`${quoteIdentifier(currentTableName)}.`, "")
}

function isSql(value: unknown): value is SQL {
  return value instanceof SQL
}

function renderIndexColumn(column: IndexColumn, currentTableName: string) {
  if (isSql(column)) return renderIndexSql(column, currentTableName)
  return quoteIdentifier(column.name)
}

function renderIndex(
  config: ReturnType<typeof getTableConfig>,
  index: ReturnType<typeof getTableConfig>["indexes"][number],
) {
  const unique = index.config.unique ? "UNIQUE " : ""
  const columns = index.config.columns.map((column) => renderIndexColumn(column, config.name)).join(", ")
  const where = index.config.where ? ` WHERE ${renderIndexSql(index.config.where, config.name)}` : ""
  return `CREATE ${unique}INDEX IF NOT EXISTS ${quoteIdentifier(index.config.name)} ON ${quoteIdentifier(config.name)} (${columns})${where};`
}

function renderTable(table: unknown) {
  const config = getTableConfig(table as never)
  const definitions: string[] = config.columns.map(renderColumn)

  for (const primaryKey of config.primaryKeys) {
    definitions.push(`PRIMARY KEY (${primaryKey.columns.map((column) => quoteIdentifier(column.name)).join(", ")})`)
  }

  for (const uniqueConstraint of config.uniqueConstraints) {
    definitions.push(`UNIQUE (${uniqueConstraint.columns.map((column) => quoteIdentifier(column.name)).join(", ")})`)
  }

  for (const foreignKey of config.foreignKeys) {
    definitions.push(renderForeignKey(foreignKey))
  }

  const tableSql = [
    `CREATE TABLE IF NOT EXISTS ${quoteIdentifier(config.name)} (`,
    definitions.map((definition) => `  ${definition}`).join(",\n"),
    ");",
  ].join("\n")

  const indexSql = config.indexes
    .filter((index) => !deferredIndexNames.has(index.config.name))
    .map((index) => renderIndex(config, index))

  return [tableSql, ...indexSql].join("\n")
}

function collectTables() {
  const tables: unknown[] = []
  const seen = new Set<string>()

  for (const value of Object.values(schema)) {
    try {
      const name = tableName(value)
      if (seen.has(name)) continue
      seen.add(name)
      tables.push(value)
    } catch {}
  }

  return tables
}

function generatedSchemaDdl() {
  return collectTables().map(renderTable).join("\n\n")
}

function generatedDeferredIndexDdl() {
  const indexSql: string[] = []
  for (const table of collectTables()) {
    const config = getTableConfig(table as never)
    for (const index of config.indexes) {
      if (deferredIndexNames.has(index.config.name)) indexSql.push(renderIndex(config, index))
    }
  }
  return indexSql.join("\n")
}

// FTS is Full-Text Search. Drizzle table declarations do not model SQLite FTS5
// virtual tables, so this remains an explicit storage extension.
const STORAGE_EXTENSION_DDL = /* sql */ `
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  chunk_id UNINDEXED,
  project_id UNINDEXED
);

DELETE FROM engine_channel_binding
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM engine_channel_binding
  GROUP BY platform, channel, thread
);
${generatedDeferredIndexDdl()}

-- Baseline metric specs are immutable once written. The SQL layer catches
-- bugs that bypass src/metrics/store.ts.
CREATE TRIGGER IF NOT EXISTS engine_metric_spec_baseline_no_update
BEFORE UPDATE ON engine_metric_spec
FOR EACH ROW
WHEN OLD.source = 'baseline'
BEGIN
  SELECT RAISE(ABORT, 'engine_metric_spec: baseline row is frozen (no UPDATE)');
END;
`

export const SCHEMA_DDL = `${generatedSchemaDdl()}\n\n${STORAGE_EXTENSION_DDL}`
