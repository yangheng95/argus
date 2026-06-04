export interface TuiHostTerminalWriter {
  write(data: string): void
  reset(): void
}

export interface TuiHostTerminalSize {
  cols: number
  rows: number
}

export function syncTuiHostTerminalBuffer(input: {
  terminal: TuiHostTerminalWriter
  renderedBuffer: string
  nextBuffer: string
}) {
  if (input.nextBuffer === input.renderedBuffer) return input.renderedBuffer
  if (input.nextBuffer.startsWith(input.renderedBuffer)) {
    input.terminal.write(input.nextBuffer.slice(input.renderedBuffer.length))
    return input.nextBuffer
  }
  input.terminal.reset()
  input.terminal.write(input.nextBuffer)
  return input.nextBuffer
}

export function hasTuiHostTerminalSizeChanged(previous: TuiHostTerminalSize | undefined, next: TuiHostTerminalSize) {
  return previous?.cols !== next.cols || previous.rows !== next.rows
}
