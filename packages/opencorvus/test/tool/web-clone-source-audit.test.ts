import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { Instance } from "../../src/project/instance"
import { WebCloneSourceAuditTool } from "../../src/tool/web-clone-source-audit"
import { tmpdir } from "../fixture/fixture"

const ctx = {
  sessionID: "test-web-clone-source-audit",
  messageID: "message",
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.web_clone_source_audit", () => {
  test("rejects omitted sourcePackageDir instead of using an implicit package path", async () => {
    await using tmp = await tmpdir()
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneSourceAuditTool.init()
        await expect(tool.execute({ projectDir } as never, ctx)).rejects.toThrow()
      },
    })
  }, 30_000)

  test("writes a failing audit for default framework scaffold output", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(
      path.join(projectDir, "src", "App.tsx"),
      `
      import reactLogo from './assets/react.svg'
      import viteLogo from '/vite.svg'

      export default function App() {
        return <p>Get started by editing src/App.tsx with Vite logo and React logo</p>
      }
    `,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneSourceAuditTool.init()
        const result = await tool.execute(
          { projectDir, sourcePackageDir: webpageEvidenceDir, finalAcceptanceMode: "visual_baseline_allowed" },
          ctx,
        )

        expect(result.title).toBe("Source-skeleton consumption audit failed")
        expect(result.output).toContain("Passed: false")
        expect(result.output).toContain("Default framework scaffold")
        expect(result.metadata.auditPath).toBe(
          path.join(projectDir, "web-clone-source-skeleton-consumption-audit.json"),
        )
        expect(result.metadata.audit.passed).toBe(false)
        expect(await Bun.file(result.metadata.auditPath).exists()).toBe(true)
      },
    })
  }, 30_000)

  test("writes a passing audit for a component/data-loop implementation", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(
      path.join(projectDir, "src", "data", "calendar.ts"),
      `
      export const calendarEvents = [
        { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
        { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
      ]
    `,
    )
    await Bun.write(
      path.join(projectDir, "src", "components", "CalendarTable.tsx"),
      `
      import { calendarEvents } from "../data/calendar"
      export function CalendarTable() {
        return <table><tbody>{calendarEvents.map((row) => <tr key={row.time}><td>{row.time}</td><td>{row.country}</td><td>{row.event}</td><td>{row.actual}</td></tr>)}</tbody></table>
      }
    `,
    )
    await Bun.write(
      path.join(projectDir, "src", "App.tsx"),
      `
      import { CalendarTable } from "./components/CalendarTable"
      export default function App() {
        return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /></main>
      }
    `,
    )

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneSourceAuditTool.init()
        const result = await tool.execute(
          { projectDir, sourcePackageDir: webpageEvidenceDir, finalAcceptanceMode: "visual_baseline_allowed" },
          ctx,
        )

        expect(result.title).toBe("Source-skeleton consumption audit passed")
        expect(result.output).toContain("Passed: true")
        expect(result.metadata.audit.passed).toBe(true)
      },
    })
  }, 30_000)

  test("rejects outputPath outside the audited project directory", async () => {
    await using tmp = await tmpdir()
    const webpageEvidenceDir = await writeFixtureEvidence(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await WebCloneSourceAuditTool.init()
        await expect(
          tool.execute(
            {
              projectDir,
              sourcePackageDir: webpageEvidenceDir,
              finalAcceptanceMode: "visual_baseline_allowed",
              outputPath: "../audit.json",
            },
            ctx,
          ),
        ).rejects.toThrow("outputPath must stay inside the audited project directory")
      },
    })
  }, 30_000)
})

async function writePassingProject(projectDir: string): Promise<void> {
  await Bun.write(
    path.join(projectDir, "src", "data", "calendar.ts"),
    `
    export const calendarEvents = [
      { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
      { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
    ]
  `,
  )
  await Bun.write(
    path.join(projectDir, "src", "components", "CalendarTable.tsx"),
    `
    import { calendarEvents } from "../data/calendar"
    export function CalendarTable() {
      return <table><tbody>{calendarEvents.map((row) => <tr key={row.time}><td>{row.time}</td><td>{row.country}</td><td>{row.event}</td><td>{row.actual}</td></tr>)}</tbody></table>
    }
  `,
  )
  await Bun.write(
    path.join(projectDir, "src", "App.tsx"),
    `
    import { CalendarTable } from "./components/CalendarTable"
    export default function App() {
      return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /></main>
    }
  `,
  )
}

async function writeFixtureEvidence(root: string): Promise<string> {
  const webpageEvidenceDir = path.join(root, "web-clone-source")
  await Bun.write(path.join(webpageEvidenceDir, "reference.png"), minimalPngBytes())
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "index.html"),
    `
    <main class="economic-calendar">
      <nav><a href="/markets">Markets</a></nav>
      <h1>Economic calendar</h1>
      <table>
        <thead><tr><th>Time</th><th>Country</th><th>Event</th><th>Actual</th></tr></thead>
        <tbody>
          <tr><td>08:30</td><td>US</td><td>GDP Growth Rate</td><td>2.1%</td></tr>
          <tr><td>09:45</td><td>US</td><td>Manufacturing PMI</td><td>51.3</td></tr>
        </tbody>
      </table>
    </main>
  `,
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-skeleton", "critical.css"),
    ".economic-calendar { display: grid; }",
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "component-tree.json"),
    JSON.stringify(
      {
        components: [
          { name: "EconomicCalendarShell", textPreview: ["Markets", "Economic calendar"] },
          { name: "EconomicCalendarTable", textPreview: ["08:30", "GDP Growth Rate"] },
        ],
      },
      null,
      2,
    ),
  )
  await Bun.write(
    path.join(webpageEvidenceDir, "source-ir", "content-model.json"),
    JSON.stringify(
      {
        tables: [
          {
            headers: ["Time", "Country", "Event", "Actual"],
            rows: [
              ["08:30", "US", "GDP Growth Rate", "2.1%"],
              ["09:45", "US", "Manufacturing PMI", "51.3"],
            ],
          },
        ],
        repeatedGroups: [{ sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"] }],
        stats: { totalTables: 1, totalLists: 0, totalCards: 0, totalRepeatedGroups: 1 },
      },
      null,
      2,
    ),
  )
  await writeMinimalSourceManifest(webpageEvidenceDir)
  return webpageEvidenceDir
}

async function writeMinimalSourceManifest(sourcePackageDir: string): Promise<void> {
  const referenceSha256 = createHash("sha256").update(Buffer.from(minimalPngBytes())).digest("hex")
  await Bun.write(
    path.join(sourcePackageDir, "web-clone-source-manifest.json"),
    JSON.stringify(
      {
        version: 1,
        purpose: "web-clone-visible-source-package",
        provenance: {
          source: "webpage-evidence",
          webpageEvidenceDir: sourcePackageDir,
          reference: {
            path: "reference.png",
            sha256: referenceSha256,
            width: 1,
            height: 1,
            bytes: minimalPngBytes().length,
          },
        },
        files: [
          {
            path: "reference.png",
            sha256: referenceSha256,
            bytes: minimalPngBytes().length,
            source: "webpage-evidence/reference.png",
          },
        ],
      },
      null,
      2,
    ),
  )
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49,
    0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00,
    0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
  ])
}
