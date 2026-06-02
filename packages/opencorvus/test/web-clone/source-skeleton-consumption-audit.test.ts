import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import {
  auditWebCloneSourceSkeletonConsumption,
  generateWebCloneSkeletonProject,
  inferWebCloneFinalDeliveryMode,
  inspectWebCloneSourceSkeletonConsumptionEvidence,
  writeWebCloneSourceSkeletonConsumptionAudit,
} from "../../src/web-clone"

describe("web-clone source skeleton consumption audit", () => {
  test("rejects a default Vite/React scaffold that ignores the skeleton", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import reactLogo from './assets/react.svg'
      import viteLogo from '/vite.svg'
      import './App.css'

      export default function App() {
        return (
          <>
            <div>
              <a href="https://vite.dev" target="_blank"><img src={viteLogo} className="logo" alt="Vite logo" /></a>
              <a href="https://react.dev" target="_blank"><img src={reactLogo} className="logo react" alt="React logo" /></a>
            </div>
            <h1>Vite + React</h1>
            <p className="read-the-docs">Click on the Vite and React logos to learn more</p>
            <p>Get started by editing src/App.tsx</p>
          </>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.css"), ".logo { height: 6em; }")

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.risk.defaultScaffoldDetected).toBe(true)
    expect(audit.risk.skeletonIgnored).toBe(true)
    expect(audit.findings.join("\n")).toContain("Default framework scaffold")
  })

  test("does not count the web-clone-source handoff as implementation source", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(path.join(projectDir, "web-clone-source", "source-skeleton", "index.html"), `
      <main><h1>Economic calendar</h1><p>GDP Growth Rate</p></main>
    `)
    await Bun.write(path.join(projectDir, "web-clone-source", "source-ir", "content-model.json"), JSON.stringify({
      tables: [{ headers: ["Time", "Country", "Event", "Actual"], rows: [["08:30", "US", "GDP Growth Rate", "2.1%"]] }],
    }, null, 2))

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.projectStats.sourceFileCount).toBe(0)
    expect(audit.findings.join("\n")).toContain("No project-owned source files")
  })

  test("does not count the frontend-design skeleton sidecar as implementation source", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    await Bun.write(
      path.join(projectDir, "frontend-design-skeleton", "src", "generated", "singlefile-head-styles.html"),
      `<style>:root{--sf-img-1:url("data:image/png;base64,${"A".repeat(4000)}")}</style>`,
    )
    await Bun.write(
      path.join(projectDir, "frontend-design-skeleton", "scripts", "extract-source-html.mjs"),
      "document.createElement('template').innerHTML = '<main>raw baseline</main>'",
    )

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(true)
    expect(audit.projectStats.base64DataUriCount).toBe(0)
    expect(audit.risk.manualDomMutationDetected).toBe(false)
    expect(audit.risk.mechanicalSkeletonConversionDetected).toBe(false)
  })

  test("counts source JSON data modules as skeleton coverage and data arrays", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(path.join(projectDir, "src", "data", "calendar.json"), JSON.stringify([
      { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
      { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
    ], null, 2))
    await Bun.write(path.join(projectDir, "src", "components", "CalendarTable.tsx"), `
      import calendarEvents from "../data/calendar.json"

      export function CalendarTable() {
        return (
          <table className="economic-calendar__table">
            <tbody>{calendarEvents.map((row) => <tr key={row.time + row.event}><td>{row.time}</td><td>{row.country}</td><td>{row.event}</td><td>{row.actual}</td></tr>)}</tbody>
          </table>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { CalendarTable } from "./components/CalendarTable"
      export default function App() {
        return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /></main>
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.projectStats.dataArrayCount).toBeGreaterThan(0)
    expect(audit.sourceCoverage.matchedTextCount).toBeGreaterThanOrEqual(6)
    expect(audit.risk.skeletonIgnored).toBe(false)
    expect(audit.passed).toBe(true)
  })

  test("accepts a maintainable React implementation that consumes text, components, and repeated data", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(path.join(projectDir, "src", "data", "calendar.ts"), `
      export const calendarEvents = [
        { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
        { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
      ]
    `)
    await Bun.write(path.join(projectDir, "src", "components", "CalendarTable.tsx"), `
      import { calendarEvents } from "../data/calendar"

      export function CalendarTable() {
        return (
          <table className="economic-calendar__table">
            <thead><tr><th>Time</th><th>Country</th><th>Event</th><th>Actual</th></tr></thead>
            <tbody>
              {calendarEvents.map((row) => (
                <tr key={row.time + row.event}>
                  <td>{row.time}</td>
                  <td>{row.country}</td>
                  <td>{row.event}</td>
                  <td>{row.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { CalendarTable } from "./components/CalendarTable"
      import "./styles.css"

      export default function App() {
        return (
          <main className="economic-calendar" data-source-segment-id="segment-main">
            <nav><a href="/markets">Markets</a></nav>
            <section>
              <h1>Economic calendar</h1>
              <CalendarTable />
            </section>
          </main>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "styles.css"), `
      .economic-calendar { display: grid; grid-template-columns: 180px 1fr; gap: 16px; color: #111827; }
      .economic-calendar__table { width: 100%; border-collapse: collapse; }
    `)

    const { audit, auditPath } = await writeWebCloneSourceSkeletonConsumptionAudit({ projectDir, sourcePackageDir: mirrorDir })

    expect(auditPath).toEndWith("web-clone-source-skeleton-consumption-audit.json")
    expect(audit.passed).toBe(true)
    expect(audit.sourceCoverage.matchedTextCount).toBeGreaterThanOrEqual(6)
    expect(audit.structureCoverage.dataArrayDetected).toBe(true)
    expect(audit.structureCoverage.renderLoopDetected).toBe(true)
    expect(audit.projectStats.componentFileCount).toBeGreaterThanOrEqual(2)
  })

  test("accepts the frontend-design generated DOM/CSS baseline before component replacement", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "frontend-design-skeleton")

    await generateWebCloneSkeletonProject({
      sourcePackageDir,
      outputDir: projectDir,
    })
    await Bun.write(
      path.join(projectDir, "src", "styles", "source-critical.css"),
      Array.from(
        { length: 2600 },
        (_, index) => `.source-node-${index} { content: "data-source-node-id=node_${index}"; padding: ${index % 8}px; }`,
      ).join("\n"),
    )

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir })

    expect(audit.passed).toBe(true)
    expect(audit.risk.htmlReplayDetected).toBe(false)
    expect(audit.risk.manualDomMutationDetected).toBe(false)
    expect(audit.risk.mechanicalSkeletonConversionDetected).toBe(false)
    expect(audit.sourceCoverage.matchedTextCount).toBeGreaterThanOrEqual(6)
  })

  test("rejects frontend-design generated baseline as final maintainable replacement", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "frontend-design-skeleton")

    await generateWebCloneSkeletonProject({
      sourcePackageDir,
      outputDir: projectDir,
    })
    await Bun.write(path.join(projectDir, "src", "components", "source-dom", "TinyDebtRegion.tsx"), `
      // @ts-nocheck
      export function TinyDebtRegion() {
        return <section>GDP Growth Rate</section>
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({
      projectDir,
      sourcePackageDir,
      finalDeliveryMode: "maintainable_replacement_required",
    })

    expect(audit.passed).toBe(false)
    expect(audit.finalDeliveryMode).toBe("maintainable_replacement_required")
    expect(audit.risk.generatedBaselineDetected).toBe(true)
    expect(audit.risk.finalBaselineOnlyDetected).toBe(true)
    expect(audit.findings.join("\n")).toContain("generated DOM/CSS baseline")
    expect(audit.findings.join("\n")).toContain("Largest remaining generated source-dom regions")
    expect(audit.findings.join("\n")).toContain("TinyDebtRegion.tsx")
  })

  test("rejects source-dom skeleton sidecars left in target app source", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    await Bun.write(path.join(projectDir, "src", "data", "sourceDomReplacementPlan.ts"), `
      export const sourceDomReplacementPlan = [
        { regionComponentName: "CalendarRegion", regionFilePath: "src/components/source-dom/CalendarRegion.tsx" },
      ] as const
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({
      projectDir,
      sourcePackageDir,
      finalDeliveryMode: "maintainable_replacement_required",
    })

    expect(audit.passed).toBe(false)
    expect(audit.risk.generatedBaselineDetected).toBe(false)
    expect(audit.risk.finalSourceDomModuleResidueDetected).toBe(true)
    expect(audit.projectStats.sourceDomBaselineModuleCount).toBe(1)
    expect(audit.findings.join("\n")).toContain("Target project still contains source-dom baseline modules")
    expect(audit.findings.join("\n")).toContain("sourceDomReplacementPlan.ts")
  })

  test("does not require the provenance mirror to be reachable after source package handoff", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    const staleMirrorDir = path.join(tmp.path, "stale-runtime-mirror")
    await Bun.write(path.join(staleMirrorDir, ".keep"), "")
    await writeSelfContainedManifestWithStaleMirror(sourcePackageDir, staleMirrorDir)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir })

    expect(audit.passed).toBe(true)
    expect(audit.findings.join("\n")).not.toContain("Manifest source mirror file is missing")
  })

  test("rejects a reference screenshot replay even when text coverage is perfect", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await Bun.write(path.join(projectDir, "src", "data", "calendar.ts"), `
      export const calendarEvents = [
        { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
        { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
      ]
    `)
    await Bun.write(path.join(projectDir, "src", "components", "ReferenceCanvas.tsx"), `
      import { calendarEvents } from "../data/calendar"

      export function ReferenceCanvas() {
        return (
          <main>
            <img src="/reference.png" width="1440" height="6547" alt="Economic calendar" />
            {calendarEvents.map((row) => <p key={row.time}>{row.time} {row.country} {row.event} {row.actual}</p>)}
            <p>Markets Economic calendar Time Country Event Actual</p>
          </main>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { ReferenceCanvas } from "./components/ReferenceCanvas"
      export default function App() {
        return <ReferenceCanvas />
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.risk.referenceImageReplayDetected).toBe(true)
    expect(audit.findings.join("\n")).toContain("reference screenshot")
  })

  test("rejects hidden semantic layers used only to satisfy source coverage", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    await Bun.write(path.join(projectDir, "src", "components", "HiddenSourceCoverage.tsx"), `
      import { calendarEvents } from "../data/calendar"

      export function HiddenSourceCoverage() {
        return (
          <section className="semantic-source-layer">
            {calendarEvents.map((row) => <p key={row.time}>{row.time} {row.country} {row.event} {row.actual}</p>)}
          </section>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { CalendarTable } from "./components/CalendarTable"
      import { HiddenSourceCoverage } from "./components/HiddenSourceCoverage"
      import "./styles.css"
      export default function App() {
        return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /><HiddenSourceCoverage /></main>
      }
    `)
    await Bun.write(path.join(projectDir, "src", "styles.css"), `
      .semantic-source-layer {
        width: 1px;
        height: 1px;
        overflow: hidden;
        opacity: 0;
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.risk.hiddenSemanticContentDetected).toBe(true)
    expect(audit.findings.join("\n")).toContain("hides semantic skeleton content")
  })

  test("rejects dense inline SVG path payloads", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    const longPath = "M0 0 " + Array.from({ length: 700 }, (_, index) => `L${index} ${index % 37}`).join(" ")
    await Bun.write(path.join(projectDir, "src", "components", "InlineMap.tsx"), `
      export function InlineMap() {
        return (
          <svg viewBox="0 0 1000 500">
            <path d="${longPath}" fill="#d8dee9" />
          </svg>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { CalendarTable } from "./components/CalendarTable"
      import { InlineMap } from "./components/InlineMap"
      export default function App() {
        return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /><InlineMap /></main>
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.risk.denseInlineAssetDetected).toBe(true)
    expect(audit.findings.join("\n")).toContain("dense inline assets")
  })

  test("accepts large SVG structure when geometry is kept in sidecar asset references", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    const assetPaths = Array.from({ length: 220 }, (_, index) =>
      `<AssetPath assetPath={"../assets/svg/asset_${String(index).padStart(6, "0")}.path.txt"} id={"land-${index}"} className={"neutral"} />`,
    ).join("\n")
    await Bun.write(path.join(projectDir, "src", "components", "AssetPath.tsx"), `
      export function AssetPath(props: { assetPath: string; id?: string; className?: string }) {
        return <path data-asset-path={props.assetPath} id={props.id} className={props.className} />
      }
    `)
    await Bun.write(path.join(projectDir, "src", "components", "SidecarMap.tsx"), `
      import { AssetPath } from "./AssetPath"
      export function SidecarMap() {
        return (
          <svg viewBox="0 0 1000 500">
            ${assetPaths}
          </svg>
        )
      }
    `)
    await Bun.write(path.join(projectDir, "src", "App.tsx"), `
      import { CalendarTable } from "./components/CalendarTable"
      import { SidecarMap } from "./components/SidecarMap"
      export default function App() {
        return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /><SidecarMap /></main>
      }
    `)

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(true)
    expect(audit.risk.denseInlineAssetDetected).toBe(false)
  })

  test("rejects a source package that contains output verification artifacts", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)
    await Bun.write(path.join(mirrorDir, "actual-app.png"), minimalPngBytes())

    const audit = await auditWebCloneSourceSkeletonConsumption({ projectDir, sourcePackageDir: mirrorDir })

    expect(audit.passed).toBe(false)
    expect(audit.risk.sourcePackageContaminated).toBe(true)
    expect(audit.findings.join("\n")).toContain("not input-only")
  })

  test("infers maintainable replacement mode from Chinese maintainability requests", () => {
    expect(inferWebCloneFinalDeliveryMode("需要一个可维护的真实实现，尽量复用现有组件或者成熟组件")).toBe("maintainable_replacement_required")
  })

  test("consumption evidence reports a missing or stale audit when source-skeleton is cited", async () => {
    await using tmp = await tmpdir()
    const mirrorDir = await writeFixtureMirror(tmp.path)
    const projectDir = tmp.path
    await writePassingProject(projectDir)
    const citedText = "Use web-clone-source/source-skeleton/README.md and web-clone-source/source-ir/content-model.json"

    const missing = await inspectWebCloneSourceSkeletonConsumptionEvidence({ projectDir: tmp.path, citedText })
    expect(missing.referenced).toBe(true)
    expect(missing.ok).toBe(false)
    expect(missing.findings.join("\n")).toContain("missing web-clone-source-skeleton-consumption-audit.json")

    const { auditPath } = await writeWebCloneSourceSkeletonConsumptionAudit({ projectDir, sourcePackageDir: mirrorDir })
    const passing = await inspectWebCloneSourceSkeletonConsumptionEvidence({ projectDir: tmp.path, citedText })
    expect(passing.ok).toBe(true)
    expect(passing.auditPath).toBe(auditPath)

    const wrongMode = await inspectWebCloneSourceSkeletonConsumptionEvidence({
      projectDir: tmp.path,
      citedText,
      originalRequest: "需要一个可维护的真实实现，尽量复用现有组件或者成熟组件",
    })
    expect(wrongMode.ok).toBe(false)
    expect(wrongMode.findings.join("\n")).toContain("finalDeliveryMode must be maintainable_replacement_required")

    const staleAudit = JSON.parse(await Bun.file(auditPath).text())
    staleAudit.projectStats.sourceFileCount = 999
    await Bun.write(auditPath, JSON.stringify(staleAudit, null, 2))
    const stale = await inspectWebCloneSourceSkeletonConsumptionEvidence({ projectDir: tmp.path, citedText })
    expect(stale.ok).toBe(false)
    expect(stale.findings.join("\n")).toContain("stale")
  }, 30_000)

  test("consumption evidence is produced for web-clone-source and source IR handoffs", async () => {
    await using tmp = await tmpdir()
    const projectDir = path.join(tmp.path, "app")
    await writePassingProject(projectDir)

    for (const citedText of [
      "Build from web-clone-source/README.md",
      "Use web-clone-source/source-ir/content-model.json",
      "Source IR drives the component tree",
      "Run web_clone_source_audit before pass",
    ]) {
      const result = await inspectWebCloneSourceSkeletonConsumptionEvidence({ projectDir: tmp.path, citedText })
      expect(result.referenced).toBe(true)
      expect(result.ok).toBe(false)
      expect(result.findings.join("\n")).toContain("missing web-clone-source-skeleton-consumption-audit.json")
    }
  })

  test("consumption evidence ignores unrelated passing audits outside the delivery root", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    await writePassingProject(path.join(tmp.path, "toy-app"))
    await writeWebCloneSourceSkeletonConsumptionAudit({
      projectDir: path.join(tmp.path, "toy-app"),
      sourcePackageDir,
    })

    const result = await inspectWebCloneSourceSkeletonConsumptionEvidence({
      projectDir: tmp.path,
      citedText: "Build from web-clone-source/source-ir/content-model.json",
    })

    expect(result.referenced).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.findings.join("\n")).toContain("missing web-clone-source-skeleton-consumption-audit.json")
  }, 30_000)

  test("consumption evidence reports a canonical audit that points at a different project", async () => {
    await using tmp = await tmpdir()
    const sourcePackageDir = await writeFixtureMirror(tmp.path)
    const toyProjectDir = path.join(tmp.path, "toy-app")
    await writePassingProject(toyProjectDir)
    const { audit } = await writeWebCloneSourceSkeletonConsumptionAudit({
      projectDir: toyProjectDir,
      sourcePackageDir,
      outputPath: path.join(tmp.path, "web-clone-source-skeleton-consumption-audit.json"),
    })
    expect(audit.passed).toBe(true)

    const result = await inspectWebCloneSourceSkeletonConsumptionEvidence({
      projectDir: tmp.path,
      citedText: "Build from web-clone-source/source-ir/content-model.json",
    })

    expect(result.referenced).toBe(true)
    expect(result.ok).toBe(false)
    expect(result.findings.join("\n")).toContain("audit projectDir must be the current delivery root")
  })
})

async function writePassingProject(projectDir: string): Promise<void> {
  await Bun.write(path.join(projectDir, "src", "data", "calendar.ts"), `
    export const calendarEvents = [
      { time: "08:30", country: "US", event: "GDP Growth Rate", actual: "2.1%" },
      { time: "09:45", country: "US", event: "Manufacturing PMI", actual: "51.3" },
    ]
  `)
  await Bun.write(path.join(projectDir, "src", "components", "CalendarTable.tsx"), `
    import { calendarEvents } from "../data/calendar"

    export function CalendarTable() {
      return (
        <table>
          <tbody>
            {calendarEvents.map((row) => (
              <tr key={row.time + row.event}>
                <td>{row.time}</td>
                <td>{row.country}</td>
                <td>{row.event}</td>
                <td>{row.actual}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )
    }
  `)
  await Bun.write(path.join(projectDir, "src", "App.tsx"), `
    import { CalendarTable } from "./components/CalendarTable"
    export default function App() {
      return <main><nav>Markets</nav><h1>Economic calendar</h1><CalendarTable /></main>
    }
  `)
}

async function writeFixtureMirror(root: string): Promise<string> {
  const mirrorDir = path.join(root, "web-clone-source")
  await Bun.write(path.join(mirrorDir, "reference.png"), minimalPngBytes())
  await Bun.write(path.join(mirrorDir, "source-skeleton", "index.html"), `
    <!doctype html>
    <html>
      <body data-reference-image="../reference.png">
        <main class="economic-calendar" data-source-segment-id="segment-main">
          <nav><a href="/markets">Markets</a></nav>
          <section>
            <h1>Economic calendar</h1>
            <table>
              <thead><tr><th>Time</th><th>Country</th><th>Event</th><th>Actual</th></tr></thead>
              <tbody>
                <tr><td>08:30</td><td>US</td><td>GDP Growth Rate</td><td>2.1%</td></tr>
                <tr><td>09:45</td><td>US</td><td>Manufacturing PMI</td><td>51.3</td></tr>
              </tbody>
            </table>
          </section>
        </main>
      </body>
    </html>
  `)
  await Bun.write(path.join(mirrorDir, "source-skeleton", "critical.css"), `
    .economic-calendar { display: grid; grid-template-columns: 180px 1fr; gap: 16px; color: #111827; }
    table { border-collapse: collapse; width: 100%; }
  `)
  await Bun.write(path.join(mirrorDir, "source-ir", "component-tree.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-component-tree",
    components: [
      { id: "segment-nav", name: "NavigationRegion", textPreview: ["Markets"] },
      { id: "segment-main", name: "EconomicCalendarSection", textPreview: ["Economic calendar", "08:30", "GDP Growth Rate"] },
    ],
  }, null, 2))
  await Bun.write(path.join(mirrorDir, "source-ir", "content-model.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-content-model",
    tables: [{
      nodeId: "table-1",
      headers: ["Time", "Country", "Event", "Actual"],
      rows: [
        ["08:30", "US", "GDP Growth Rate", "2.1%"],
        ["09:45", "US", "Manufacturing PMI", "51.3"],
      ],
    }],
    lists: [],
    cards: [],
    controls: [],
    links: [{ nodeId: "link-1", text: "Markets", href: "/markets" }],
    media: [],
    repeatedGroups: [{
      parentNodeId: "tbody-1",
      count: 2,
      sampleTexts: ["08:30 US GDP Growth Rate 2.1%", "09:45 US Manufacturing PMI 51.3"],
    }],
    stats: {
      totalTables: 1,
      totalLists: 0,
      totalCards: 0,
      totalRepeatedGroups: 1,
    },
  }, null, 2))
  await writeMinimalSourceManifest(mirrorDir)
  return mirrorDir
}

async function writeMinimalSourceManifest(sourcePackageDir: string): Promise<void> {
  const referenceSha256 = createHash("sha256").update(Buffer.from(minimalPngBytes())).digest("hex")
  await Bun.write(path.join(sourcePackageDir, "web-clone-source-manifest.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-visible-source-package",
    provenance: {
      source: "mirror",
      mirrorDir: sourcePackageDir,
      reference: { path: "reference.png", sha256: referenceSha256, width: 1, height: 1, bytes: minimalPngBytes().length },
    },
    files: [{ path: "reference.png", sha256: referenceSha256, bytes: minimalPngBytes().length, source: "mirror/reference.png" }],
  }, null, 2))
}

async function writeSelfContainedManifestWithStaleMirror(sourcePackageDir: string, staleMirrorDir: string): Promise<void> {
  const referenceBytes = await Bun.file(path.join(sourcePackageDir, "reference.png")).arrayBuffer()
  const skeletonBytes = await Bun.file(path.join(sourcePackageDir, "source-skeleton", "index.html")).arrayBuffer()
  const referenceSha256 = createHash("sha256").update(Buffer.from(referenceBytes)).digest("hex")
  const skeletonSha256 = createHash("sha256").update(Buffer.from(skeletonBytes)).digest("hex")
  await Bun.write(path.join(sourcePackageDir, "web-clone-source-manifest.json"), JSON.stringify({
    version: 1,
    purpose: "web-clone-visible-source-package",
    provenance: {
      source: "mirror",
      mirrorDir: staleMirrorDir,
      reference: { path: "reference.png", sha256: referenceSha256, width: 1, height: 1, bytes: referenceBytes.byteLength },
    },
    files: [
      { path: "reference.png", sha256: referenceSha256, bytes: referenceBytes.byteLength, source: "mirror/reference.png" },
      {
        path: "source-skeleton/index.html",
        sha256: skeletonSha256,
        bytes: skeletonBytes.byteLength,
        source: "mirror/source-skeleton/index.html",
      },
    ],
  }, null, 2))
}

function minimalPngBytes(): Uint8Array {
  return Uint8Array.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
    0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
    0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
    0x42, 0x60, 0x82,
  ])
}
