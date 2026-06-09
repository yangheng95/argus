import { describe, expect, test } from "bun:test"
import { extractSdkRoutesFromText } from "../../script/check/sdk-route-extractor"

describe("api routes check", () => {
  test("extracts routes from the generated SDK client call shape", () => {
    const routes = extractSdkRoutesFromText(`
      return (options?.client ?? this.client).get<BrowserPreviewReadTaskEvidenceResponses, unknown, ThrowOnError>({
        url: "/task/{taskID}/browser-preview/evidence/{evidenceID}",
        ...options,
        ...params,
      })
    `)

    expect([...routes]).toEqual(["GET /task/{taskID}/browser-preview/evidence/{evidenceID}"])
  })

  test("extracts server sent event routes from the generated SDK client", () => {
    const routes = extractSdkRoutesFromText(`
      return (options?.client ?? this.client).sse.get<EventStreamResponses, unknown, ThrowOnError>({
        url: "/task/events",
        ...options,
        ...params,
      })
    `)

    expect([...routes]).toEqual(["GET /task/events"])
  })
})
