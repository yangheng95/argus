// JSON-RPC LSP fixture that completes initialize but deliberately leaves
// shutdown pending so client disposal rejects the outstanding request.

let readBuffer = Buffer.alloc(0)

function encode(message) {
  const json = JSON.stringify(message)
  const header = `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n`
  return Buffer.concat([Buffer.from(header, "utf8"), Buffer.from(json, "utf8")])
}

function decodeFrames(buffer) {
  const results = []
  while (true) {
    const idx = buffer.indexOf("\r\n\r\n")
    if (idx === -1) return { messages: results, rest: buffer }
    const header = buffer.slice(0, idx).toString("utf8")
    const match = /Content-Length:\s*(\d+)/i.exec(header)
    const length = match ? Number(match[1]) : 0
    const bodyStart = idx + 4
    const bodyEnd = bodyStart + length
    if (buffer.length < bodyEnd) return { messages: results, rest: buffer }
    results.push(buffer.slice(bodyStart, bodyEnd).toString("utf8"))
    buffer = buffer.slice(bodyEnd)
  }
}

function send(message) {
  process.stdout.write(encode(message))
}

function handle(raw) {
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  if (data.method === "initialize") {
    send({ jsonrpc: "2.0", id: data.id, result: { capabilities: {} } })
    return
  }
  if (data.method === "shutdown") {
    return
  }
  if (data.method === "exit") {
    process.exit(0)
  }
}

process.stdin.on("data", (chunk) => {
  readBuffer = Buffer.concat([readBuffer, chunk])
  const decoded = decodeFrames(readBuffer)
  readBuffer = decoded.rest
  for (const message of decoded.messages) handle(message)
})
