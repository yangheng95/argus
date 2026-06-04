#!/usr/bin/env bun
/**
 * Wraps fetch to capture the exact JSON body @ai-sdk/openai-compatible sends
 * when streamText hits the hexin gateway. We need to know whether
 * cache_control lands on the message-content block, top-level
 * provider_options, extra_body, or somewhere else — the manual probe sent
 * it on the content block but got 0% cache hits in production, so the wire
 * shape must differ.
 */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { streamText } from "ai"

const HEXIN_URL =
  process.env.HEXIN_OPENAI_URL?.trim()
    ? `${process.env.HEXIN_OPENAI_URL.replace(/\/+$/, "")}/v1`
    : "https://aimemodeldev.myhexin.com/litellm/v1"
// Embedded fallback removed — operator must export HEXIN_API_KEY (rule 7).
const API_KEY = process.env.HEXIN_API_KEY?.trim()
if (!API_KEY) {
  console.error("HEXIN_API_KEY is not set — export it before running this script.")
  process.exit(1)
}

const originalFetch = globalThis.fetch
let captured: { url: string; body: any; headers: Record<string, string>; resp?: any } | undefined

globalThis.fetch = (async (input: any, init: any) => {
  const url = typeof input === "string" ? input : input.url
  const body = init?.body
  const headers = init?.headers as Record<string, string>
  if (typeof url === "string" && url.includes("/chat/completions")) {
    let parsed: any
    try { parsed = JSON.parse(body) } catch { parsed = body }
    captured = { url, body: parsed, headers }
  }
  const resp = await originalFetch(input, init)
  if (captured && !captured.resp) {
    const clone = resp.clone()
    try {
      const text = await clone.text()
      try { captured.resp = JSON.parse(text) } catch { captured.resp = text }
    } catch {}
  }
  return resp
}) as typeof fetch

const provider = createOpenAICompatible({
  name: "hexin",
  baseURL: HEXIN_URL,
  apiKey: API_KEY,
})

const longSystem = Array.from({ length: 200 }, (_, i) =>
  `- rule ${i}: prompt-cache benchmark padding line; payload tag p7-${i.toString(16)}`,
).join("\n")

const result = streamText({
  model: provider.chatModel("claude-sonnet-4-6"),
  messages: [
    {
      role: "system",
      content: longSystem,
      providerOptions: {
        openaiCompatible: {
          cache_control: { type: "ephemeral" },
        },
      },
    } as any,
    { role: "user", content: "Reply with OK only." },
  ],
  temperature: 0,
  maxOutputTokens: 4,
})
let text = ""
for await (const chunk of result.textStream) text += chunk

console.log("=== request URL ===")
console.log(captured?.url)
console.log("=== request body (JSON) ===")
console.log(JSON.stringify(captured?.body, null, 2))
console.log("=== response usage ===")
console.log(JSON.stringify((captured?.resp as any)?.usage, null, 2))
console.log("=== response body (first 1000 chars) ===")
const respStr = typeof captured?.resp === "string" ? captured?.resp : JSON.stringify(captured?.resp)
console.log(respStr?.slice(0, 1000))
console.log("=== text streamed ===")
console.log(text)
