export type SidecarHandshakeResult = {
  port: number
  stdout: string
}

export type SidecarHandshakeOptions = {
  idleTimeoutMs: number
  label?: string
}

function stdoutTail(stdout: string) {
  return stdout.slice(-2_000)
}

function handshakeTimeoutError(options: Required<SidecarHandshakeOptions>, stdout: string) {
  return new Error(
    `${options.label}: timed out after ${options.idleTimeoutMs}ms of stdout inactivity waiting for OPENCORVUS_LISTEN. stdout-tail=${JSON.stringify(stdoutTail(stdout))}`,
  )
}

async function readWithInactivityTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: Required<SidecarHandshakeOptions>,
  stdout: string,
) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(handshakeTimeoutError(options, stdout)), options.idleTimeoutMs)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function readSidecarHandshake(
  stream: ReadableStream<Uint8Array>,
  options: SidecarHandshakeOptions,
): Promise<SidecarHandshakeResult> {
  const resolved = {
    idleTimeoutMs: options.idleTimeoutMs,
    label: options.label ?? "sidecar handshake",
  }
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let stdout = ""

  try {
    while (true) {
      let result: ReadableStreamReadResult<Uint8Array>
      try {
        result = await readWithInactivityTimeout(reader, resolved, stdout)
      } catch (error) {
        await reader.cancel().catch(() => undefined)
        throw error
      }
      if (result.done) {
        stdout += decoder.decode()
        throw new Error(
          `${resolved.label}: stdout closed before OPENCORVUS_LISTEN handshake. stdout-tail=${JSON.stringify(stdoutTail(stdout))}`,
        )
      }
      stdout += decoder.decode(result.value, { stream: true })
      const match = stdout.match(/^OPENCORVUS_LISTEN=127\.0\.0\.1:(\d+)$/m)
      if (match) {
        return { port: Number(match[1]), stdout }
      }
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {}
  }
}
