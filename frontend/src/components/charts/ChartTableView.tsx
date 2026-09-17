/**
 * The table twin of a chart.
 *
 * Every chart on the dashboard ships one. It does three jobs at once:
 *
 *  1. Accessibility. A continuous or colour-encoded scale is not readable by
 *     everyone, and a tooltip that is the only route to a value gates it
 *     behind a pointer. The table is the WCAG-clean equivalent.
 *  2. Contrast relief. Several validated palette steps sit below 3:1 against
 *     a white surface. That is permitted only when the values are reachable
 *     another way, and this is that way.
 *  3. Testability, as a side effect worth having. Charts render to SVG paths
 *     that assert badly; the table renders the same numbers as text.
 */
interface Props {
  caption: string
  columns: string[]
  rows: Array<Array<string | number>>
}

export function ChartTableView({ caption, columns, rows }: Props) {
  return (
    <table className="w-full text-left text-xs">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          {columns.map((column, index) => (
            <th
              key={column}
              scope="col"
              className={`py-1.5 pr-3 font-medium text-muted-foreground ${
                index === 0 ? '' : 'text-right'
              }`}
            >
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIndex) => (
          // Keyed by position, not by the first cell: two repos in different
          // collections can share a name, and a duplicate key would quietly
          // drop a row from the table that exists to be the complete view.
          <tr key={rowIndex} className="border-b border-border/50">
            {row.map((cell, index) => (
              <td
                key={index}
                className={`py-1.5 pr-3 ${
                  // Tabular figures only here: these are columns of numbers
                  // that must align vertically. Stat-tile values stay
                  // proportional.
                  index === 0 ? '' : 'text-right tabular-nums'
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
