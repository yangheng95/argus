// API means Application Programming Interface. HTTP means HyperText Transfer Protocol.
// JSON means JavaScript Object Notation. URL means Uniform Resource Locator.

import { randomUUID } from "node:crypto"
import configurationSource from "../../assets/ifind.json" with { type: "text" }

export const IFIND_CHANNELS = [
  "news",
  "report",
  "announcement",
  "usnotice",
  "teleconference",
  "interact",
  "community",
  "knowledge",
  "yike",
  "en_paper",
  "web",
] as const

export const IFIND_MAX_RESULTS = 10
export const IFIND_MAX_EVIDENCE_CHARACTERS = 2_000
export const IFIND_PROVIDER_DL = IFIND_MAX_EVIDENCE_CHARACTERS - 1
export const IFIND_MAX_TOOL_OUTPUT_BYTES = 48 * 1_024
const IFIND_PUBLIC_REQUEST_POLICY = {
  output: "block",
  need_content: false,
  dl: IFIND_PROVIDER_DL,
} as const
const IFIND_DYNAMIC_REQUEST_FIELDS = new Set(["query", "channels", "size", "qid"])
export type IfindChannel = (typeof IFIND_CHANNELS)[number]

export interface IfindSearchInput {
  query: string
  channels: IfindChannel[]
  size: number
}

export interface IfindSearchResult {
  schema_version: 1
  provider: "ifind-search"
  request: {
    query: string
    channels: IfindChannel[]
    size: number
    qid: string
  }
  result_count: number
  provider_status: {
    status_code: 0
    status_msg: "OK"
    total: number
    took: number
  }
  results: Array<{
    channel: IfindChannel
    title: string
    url: string
    publish_date?: string
    evidence_field: "summary"
    evidence: string
  }>
}

type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

interface IfindConfig {
  endpoint: string
  headers: Headers
  request_entries: ReadonlyArray<readonly [string, string | number | boolean]>
  evidence_field: "summary"
  max_result_count: number
  max_evidence_characters: number
  inactivity_timeout_ms: number
  max_response_bytes: number
}

class IfindSearchError extends Error {}

function fail(message: string): never {
  throw new IfindSearchError(`iFind search: ${message}`)
}

function nonemptyString(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) fail(`${context} must be a nonempty string`)
  return value
}

function nonnegativeInteger(value: unknown, context: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) fail(`${context} must be a nonnegative integer`)
  return Number(value)
}

function positiveInteger(value: unknown, context: string): number {
  const parsed = nonnegativeInteger(value, context)
  if (parsed === 0) fail(`${context} must be positive`)
  return parsed
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${context} must be a JSON object`)
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], context: string) {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${context} must contain exactly: ${expected.join(", ")}`)
  }
}

function validateConfig(value: unknown): IfindConfig {
  const source = record(value, "configuration")
  exactKeys(
    source,
    [
      "endpoint",
      "headers",
      "request",
      "evidence_field",
      "max_result_count",
      "max_evidence_characters",
      "max_tool_output_bytes",
      "inactivity_timeout_ms",
      "max_response_bytes",
    ],
    "configuration",
  )
  const endpoint = nonemptyString(source.endpoint, "configuration.endpoint")
  let endpointURL: URL
  try {
    endpointURL = new URL(endpoint)
  } catch {
    fail("configuration.endpoint must be a valid HTTPS URL")
  }
  if (endpointURL.protocol !== "https:") fail("configuration.endpoint must use HTTPS")
  if (endpointURL.username || endpointURL.password || endpointURL.search || endpointURL.hash) {
    fail("configuration.endpoint must not contain credentials, query parameters, or a fragment")
  }
  const headersSource = record(source.headers, "configuration.headers")
  const headerSourceEntries = Object.entries(headersSource)
  if (!headerSourceEntries.length) fail("configuration.headers must not be empty")
  const headers = new Headers()
  const canonicalHeaderNames = new Set<string>()
  for (const [index, [rawName, rawValue]] of headerSourceEntries.entries()) {
    if (!rawName.trim()) fail(`configuration.headers[${index}] name must be a nonempty string`)
    if (typeof rawValue !== "string" || !rawValue.trim()) {
      fail(`configuration.headers[${index}] value must be a nonempty string`)
    }
    const probe = new Headers()
    try {
      probe.append(rawName, rawValue)
    } catch {
      fail(`configuration.headers[${index}] must contain a valid HTTP field name and value`)
    }
    const canonicalName = probe.keys().next().value
    if (typeof canonicalName !== "string") {
      fail(`configuration.headers[${index}] must contain a valid HTTP field name and value`)
    }
    if (canonicalHeaderNames.has(canonicalName)) {
      fail("configuration.headers must not contain case-insensitive duplicate names")
    }
    if (canonicalName === "content-type") fail("configuration.headers must not redefine Content-Type")
    const canonicalValue = probe.get(canonicalName)
    if (canonicalValue === null) {
      fail(`configuration.headers[${index}] must contain a valid HTTP field name and value`)
    }
    canonicalHeaderNames.add(canonicalName)
    headers.append(canonicalName, canonicalValue)
  }
  headers.set("content-type", "application/json")
  const requestSource = record(source.request, "configuration.request")
  if (Object.keys(requestSource).some((name) => IFIND_DYNAMIC_REQUEST_FIELDS.has(name))) {
    fail("configuration.request must not redefine dynamic tool arguments")
  }
  const requestEntries: Array<readonly [string, string | number | boolean]> = []
  for (const [index, [name, item]] of Object.entries(requestSource).entries()) {
    const requestName = nonemptyString(name, `configuration.request[${index}] name`)
    if (typeof item === "string") {
      if (!item.trim())
        fail(`configuration.request[${index}] value must be a nonempty string, finite number, or boolean`)
    } else if (typeof item === "number") {
      if (!Number.isFinite(item)) {
        fail(`configuration.request[${index}] value must be a nonempty string, finite number, or boolean`)
      }
    } else if (typeof item !== "boolean") {
      fail(`configuration.request[${index}] value must be a string, number, or boolean`)
    }
    requestEntries.push([requestName, item as string | number | boolean])
  }
  const requestPolicy = new Map(requestEntries)
  if (requestPolicy.get("output") !== IFIND_PUBLIC_REQUEST_POLICY.output) {
    fail('configuration.request.output must be "block"')
  }
  if (requestPolicy.get("need_content") !== IFIND_PUBLIC_REQUEST_POLICY.need_content) {
    fail("configuration.request.need_content must be false")
  }
  const evidenceField = nonemptyString(source.evidence_field, "configuration.evidence_field")
  if (evidenceField !== "summary") fail('configuration.evidence_field must be "summary"')
  const maxResultCount = positiveInteger(source.max_result_count, "configuration.max_result_count")
  if (maxResultCount !== IFIND_MAX_RESULTS) {
    fail(`configuration.max_result_count must equal ${IFIND_MAX_RESULTS}`)
  }
  const maxEvidenceCharacters = positiveInteger(source.max_evidence_characters, "configuration.max_evidence_characters")
  if (maxEvidenceCharacters !== IFIND_MAX_EVIDENCE_CHARACTERS) {
    fail(`configuration.max_evidence_characters must equal ${IFIND_MAX_EVIDENCE_CHARACTERS}`)
  }
  if (requestPolicy.get("dl") !== IFIND_PUBLIC_REQUEST_POLICY.dl) {
    fail(`configuration.request.dl must equal ${IFIND_PROVIDER_DL}`)
  }
  const maxToolOutputBytes = positiveInteger(source.max_tool_output_bytes, "configuration.max_tool_output_bytes")
  if (maxToolOutputBytes !== IFIND_MAX_TOOL_OUTPUT_BYTES) {
    fail(`configuration.max_tool_output_bytes must equal ${IFIND_MAX_TOOL_OUTPUT_BYTES}`)
  }
  return {
    endpoint,
    headers,
    request_entries: requestEntries,
    evidence_field: evidenceField,
    max_result_count: maxResultCount,
    max_evidence_characters: maxEvidenceCharacters,
    inactivity_timeout_ms: positiveInteger(source.inactivity_timeout_ms, "configuration.inactivity_timeout_ms"),
    max_response_bytes: positiveInteger(source.max_response_bytes, "configuration.max_response_bytes"),
  }
}

export function parseIfindConfiguration(source: string): IfindConfig {
  if (new TextEncoder().encode(source).byteLength > 65_536) fail("configuration file must not exceed 65536 bytes")
  let decoded: unknown
  try {
    decoded = JSON.parse(source)
  } catch {
    fail("configuration JSON parsing failed")
  }
  return validateConfig(decoded)
}

const PACKAGE_IFIND_CONFIGURATION = parseIfindConfiguration(configurationSource)

const CHANNEL_SET = new Set<string>(IFIND_CHANNELS)

function validateInput(input: IfindSearchInput, config: IfindConfig) {
  const query = nonemptyString(input.query, "query").trim()
  if (!Array.isArray(input.channels) || input.channels.length === 0) fail("channels must be a nonempty array")
  const channels = input.channels.map((channel, index) => {
    const value = nonemptyString(channel, `channels[${index}]`)
    if (!CHANNEL_SET.has(value)) fail(`channels[${index}] is not a declared iFind channel`)
    return value as IfindChannel
  })
  if (new Set(channels).size !== channels.length) fail("channels must not contain duplicates")
  const size = positiveInteger(input.size, "size")
  if (size > config.max_result_count) fail(`size must not exceed ${config.max_result_count}`)
  return { query, channels, size }
}

function createRequestWire(config: IfindConfig, input: ReturnType<typeof validateInput>, requestID: string): string {
  const dynamicEntries = [
    ["query", input.query],
    ["channels", input.channels],
    ["size", input.size],
    ["qid", requestID],
  ] as const
  const request = Object.fromEntries([...config.request_entries, ...dynamicEntries])
  let body: string
  let parsedRequest: Record<string, unknown>
  try {
    body = JSON.stringify(request)
    parsedRequest = record(JSON.parse(body), "request wire")
  } catch {
    fail("request JSON serialization failed")
  }
  for (const [name] of [...config.request_entries, ...dynamicEntries]) {
    if (!Object.hasOwn(parsedRequest, name)) fail("request JSON serialization changed its own-property shape")
  }
  return body
}

function abortFailure(signal: AbortSignal): IfindSearchError {
  if (signal.reason instanceof IfindSearchError) return signal.reason
  return new IfindSearchError("iFind search: request was aborted")
}

async function raceWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortFailure(signal)
  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortFailure(signal))
    signal.addEventListener("abort", onAbort, { once: true })
  })
  try {
    return await Promise.race([operation, aborted])
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort)
  }
}

async function cancelAndReleaseReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  activeRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined,
) {
  let cleanupFailed = false
  try {
    const cancellation = reader.cancel()
    void cancellation.catch(() => undefined)
  } catch {
    cleanupFailed = true
  }
  if (activeRead) {
    void activeRead.catch(() => undefined)
  }
  await Promise.resolve()
  try {
    reader.releaseLock()
  } catch {
    cleanupFailed = true
  }
  if (cleanupFailed) fail("response body stream cleanup failed")
}

function observeResponseBodyCancellation(response: Response) {
  if (!response.body) return
  try {
    const cancellation = response.body.cancel()
    void cancellation.catch(() => undefined)
  } catch {
    // The request is already terminal; this observes a synchronous late-body cancellation failure.
  }
}

function observeLateFetch(operation: Promise<Response>) {
  void operation.then(observeResponseBodyCancellation, () => undefined)
}

async function readResponseBody(
  response: Response,
  controller: AbortController,
  config: IfindConfig,
): Promise<Uint8Array> {
  if (!response.body) fail("response body is unavailable")
  const chunks: Uint8Array[] = []
  let total = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  const reader = response.body.getReader()
  let activeRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
  let completed = false
  const touch = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      controller.abort(new IfindSearchError("iFind search: response body became inactive"))
    }, config.inactivity_timeout_ms)
  }
  touch()
  try {
    while (true) {
      activeRead = reader.read()
      const item = await raceWithAbort(activeRead, controller.signal)
      activeRead = undefined
      if (item.done) break
      touch()
      total += item.value.byteLength
      if (total > config.max_response_bytes) fail("response body exceeded the configured byte limit")
      chunks.push(item.value)
    }
    completed = true
  } finally {
    if (timer) clearTimeout(timer)
    if (completed) reader.releaseLock()
    else await cancelAndReleaseReader(reader, activeRead)
  }
  const body = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function validateResultItem(value: unknown, index: number, config: IfindConfig): IfindSearchResult["results"][number] {
  const item = record(value, `response.data[${index}]`)
  const channel = nonemptyString(item.channel, `response.data[${index}].channel`)
  if (!CHANNEL_SET.has(channel)) fail(`response.data[${index}].channel is not declared`)
  const title = nonemptyString(item.title, `response.data[${index}].title`)
  const url = nonemptyString(item.url, `response.data[${index}].url`)
  let sourceURL: URL
  try {
    sourceURL = new URL(url)
  } catch {
    fail(`response.data[${index}].url must be a valid HTTPS URL`)
  }
  if (sourceURL.protocol !== "https:") {
    fail(`response.data[${index}].url must use HTTPS`)
  }
  if (sourceURL.username || sourceURL.password) {
    fail(`response.data[${index}].url must not contain credentials`)
  }
  const evidence = nonemptyString(item[config.evidence_field], `response.data[${index}].${config.evidence_field}`)
  if (Array.from(evidence).length > config.max_evidence_characters) {
    fail(`response.data[${index}].${config.evidence_field} exceeded the configured character limit`)
  }
  const result: IfindSearchResult["results"][number] = {
    channel: channel as IfindChannel,
    title,
    url,
    evidence_field: config.evidence_field,
    evidence,
  }
  if (Object.hasOwn(item, "publish_date")) {
    const publishDate = nonemptyString(item.publish_date, `response.data[${index}].publish_date`)
    result.publish_date = publishDate
  }
  return result
}

function parseResponse(
  text: string,
  input: ReturnType<typeof validateInput>,
  requestID: string,
  config: IfindConfig,
): IfindSearchResult {
  let decoded: unknown
  try {
    decoded = JSON.parse(text)
  } catch {
    fail("response JSON parsing failed")
  }
  const source = record(decoded, "response")
  if (source.status_code !== 0) fail("response provider status_code was not successful")
  if (source.status_msg !== "OK") fail("response provider status_msg was not successful")
  if (!Array.isArray(source.data)) fail("response.data must be an array")
  const results = source.data.map((item, index) => validateResultItem(item, index, config))
  if (results.length > input.size) fail(`response returned ${results.length} results for requested size ${input.size}`)
  const total = nonnegativeInteger(source.total, "response.total")
  const took = nonnegativeInteger(source.took, "response.took")
  const result: IfindSearchResult = {
    schema_version: 1,
    provider: "ifind-search",
    request: {
      query: input.query,
      channels: input.channels,
      size: input.size,
      qid: requestID,
    },
    result_count: results.length,
    provider_status: { status_code: 0, status_msg: "OK", total, took },
    results,
  }
  serializeIfindSearchResult(result)
  return result
}

export function serializeIfindSearchResult(result: IfindSearchResult): string {
  const output = JSON.stringify(result)
  if (new TextEncoder().encode(output).byteLength > IFIND_MAX_TOOL_OUTPUT_BYTES) {
    fail("projected tool result exceeded the package byte limit")
  }
  return output
}

export async function searchIfind(
  rawInput: IfindSearchInput,
  options: {
    fetchImplementation: FetchImplementation
    requestID?: string
    signal?: AbortSignal
  },
): Promise<IfindSearchResult> {
  if (options.signal?.aborted) fail("request was aborted by caller")
  const config = PACKAGE_IFIND_CONFIGURATION
  if (options.signal?.aborted) fail("request was aborted by caller")
  const input = validateInput(rawInput, config)
  const requestID = options.requestID ?? randomUUID()
  nonemptyString(requestID, "request_id")
  const requestBody = createRequestWire(config, input, requestID)
  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(new IfindSearchError("iFind search: request was aborted by caller"))
  options.signal?.addEventListener("abort", abortFromCaller, { once: true })
  if (options.signal?.aborted) abortFromCaller()
  let headerTimer: ReturnType<typeof setTimeout> | undefined
  try {
    if (controller.signal.aborted) throw abortFailure(controller.signal)
    headerTimer = setTimeout(() => {
      controller.abort(new IfindSearchError("iFind search: response headers became inactive"))
    }, config.inactivity_timeout_ms)
    let response: Response
    let fetchOperation: Promise<Response> | undefined
    try {
      fetchOperation = options.fetchImplementation(config.endpoint, {
        method: "POST",
        headers: config.headers,
        body: requestBody,
        signal: controller.signal,
      })
      response = await raceWithAbort(fetchOperation, controller.signal)
    } catch (error) {
      if (fetchOperation && controller.signal.aborted) observeLateFetch(fetchOperation)
      if (error instanceof IfindSearchError) throw error
      fail("request transport failed before response headers")
    } finally {
      if (headerTimer) clearTimeout(headerTimer)
      headerTimer = undefined
    }
    if (!response.ok) {
      observeResponseBodyCancellation(response)
      fail(`response returned HTTP status ${response.status}`)
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase()
    if (contentType !== "application/json") {
      observeResponseBodyCancellation(response)
      fail("response Content-Type validation failed")
    }
    let bytes: Uint8Array
    try {
      bytes = await readResponseBody(response, controller, config)
    } catch (error) {
      if (error instanceof IfindSearchError) throw error
      fail("response body stream read failed")
    }
    let text: string
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    } catch {
      fail("response UTF-8 decoding failed")
    }
    return parseResponse(text, input, requestID, config)
  } finally {
    if (headerTimer) clearTimeout(headerTimer)
    options.signal?.removeEventListener("abort", abortFromCaller)
  }
}
