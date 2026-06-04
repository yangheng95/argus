export interface TuiHostTerminalWriter {
  write(data: string): void
  reset(): void
}

export interface TuiHostTerminalSize {
  cols: number
  rows: number
}

export interface TuiHostTerminalOutput {
  data: string
  truncated: boolean
}

export function hasTuiHostTerminalSizeChanged(previous: TuiHostTerminalSize | undefined, next: TuiHostTerminalSize) {
  return previous?.cols !== next.cols || previous.rows !== next.rows
}

export function writeTuiHostTerminalOutput(input: {
  terminal: TuiHostTerminalWriter
  renderedBuffer: string
  output: TuiHostTerminalOutput
}) {
  if (!input.output.data) return input.renderedBuffer
  if (input.output.truncated) {
    input.terminal.reset()
    input.terminal.write(input.output.data)
    return input.output.data
  }
  input.terminal.write(input.output.data)
  return `${input.renderedBuffer}${input.output.data}`
}
