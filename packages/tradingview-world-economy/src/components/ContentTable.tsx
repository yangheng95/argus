export interface SourceTable {
  title?: string
  headers: string[]
  rows: string[][]
}

export function ContentTable({ table }: { table: SourceTable }) {
  const columnCount = Math.max(table.headers.length, ...table.rows.map((row) => row.length), 1)
  return (
    <article className="web-clone-table">
      <h2>{table.title}</h2>
      <table>
        {table.headers.length > 0 && (
          <thead>
            <tr>
              {table.headers.map((header, index) => <th key={`${header}-${index}`}>{header}</th>)}
            </tr>
          </thead>
        )}
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={row.join('|') || rowIndex}>
              {Array.from({ length: columnCount }, (_, columnIndex) => (
                <td key={columnIndex}>{row[columnIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </article>
  )
}
