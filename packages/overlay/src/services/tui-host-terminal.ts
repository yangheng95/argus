export interface TuiHostTerminalSize {
  cols: number
  rows: number
}

export function hasTuiHostTerminalSizeChanged(previous: TuiHostTerminalSize | undefined, next: TuiHostTerminalSize) {
  return previous?.cols !== next.cols || previous.rows !== next.rows
}
