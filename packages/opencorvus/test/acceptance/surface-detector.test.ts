import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { detectAcceptanceSurfaces } from "../../src/acceptance/surface-detector"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

describe("acceptance surface detector", () => {
  test("detects frontend surface from structural app evidence", async () => {
    const dir = await packageFixture({
      dependencies: { react: "latest", vite: "latest" },
      files: {
        "src/components/App.tsx": "export function App() { return <button>Save</button> }\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_frontend",
      acceptanceID: "dlv_frontend",
      projectRoot: dir,
      changedFiles: ["src/components/App.tsx"],
    })

    expect(manifest.surfaces).toEqual(["frontend"])
    expect(evidenceRefs(manifest, "frontend")).toContain("react")
  })

  test("detects backend API surfaces from route structure without frontend review", async () => {
    const dir = await packageFixture({
      dependencies: { hono: "latest" },
      files: {
        "src/routes/users.ts": "export const usersRoute = true\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_backend",
      acceptanceID: "dlv_backend",
      projectRoot: dir,
      changedFiles: ["src/routes/users.ts"],
    })

    expect(manifest.surfaces).toEqual(["backend_api"])
    expect(evidenceRefs(manifest, "backend_api")).toContain("src/routes/users.ts")
  })

  test("detects fullstack project surfaces from dependencies, routes, clients, and tests", async () => {
    const dir = await packageFixture({
      scripts: { test: "bun test" },
      dependencies: { react: "latest", hono: "latest", "openapi-fetch": "latest" },
      files: {
        "src/components/App.tsx": "export function App() { return null }\n",
        "src/server/routes/users.ts": "export const route = true\n",
        "src/lib/api/client.ts": "export const client = true\n",
        "test/users.test.ts": "import { test } from 'bun:test'\ntest('users', () => {})\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_fullstack",
      acceptanceID: "dlv_fullstack",
      projectRoot: dir,
      changedFiles: [
        "src/components/App.tsx",
        "src/server/routes/users.ts",
        "src/lib/api/client.ts",
        "test/users.test.ts",
      ],
      goals: [{ acceptance_spec_count: 1, imports: ["users"], exports: ["users"] }],
    })

    expect(manifest.surfaces).toEqual(["backend_api", "client_contract", "frontend", "test_integration"])
  })

  test("detects security and data surfaces from concrete dependencies and files", async () => {
    const dir = await packageFixture({
      dependencies: { bcrypt: "latest", prisma: "latest" },
      files: {
        "prisma/schema.prisma": "model User { id String @id }\n",
        "src/auth/session.ts": "export const session = true\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_security",
      acceptanceID: "dlv_security",
      projectRoot: dir,
      changedFiles: ["prisma/schema.prisma", "src/auth/session.ts"],
    })

    expect(manifest.surfaces).toEqual(["security_data"])
    expect(evidenceRefs(manifest, "security_data")).toEqual(
      expect.arrayContaining(["bcrypt", "prisma", "prisma/schema.prisma", "src/auth/session.ts"]),
    )
  })

  test("does not classify surfaces from task text without structural evidence", async () => {
    const dir = await packageFixture({
      files: {
        "README.md": "Plain package notes.\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_text_only",
      acceptanceID: "dlv_text_only",
      projectRoot: dir,
      taskRequest: "Build an auth payment upload dashboard with a beautiful visual route.",
    })

    expect(manifest.surfaces).toEqual([])
    expect(manifest.evidence).toEqual([])
  })

  test("does not classify goal imports or exports as client contract evidence", async () => {
    const dir = await packageFixture({
      dependencies: { react: "latest", vite: "latest" },
      files: {
        "src/components/Calculator.tsx": "export function Calculator() { return <button>1</button> }\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_frontend_contract_words",
      acceptanceID: "dlv_frontend_contract_words",
      projectRoot: dir,
      changedFiles: ["src/components/Calculator.tsx"],
      goals: [{ imports: ["calc-state"], exports: ["calculator-ui"] }],
    })

    expect(manifest.surfaces).toEqual(["frontend"])
    expect(evidenceRefs(manifest, "client_contract")).toEqual([])
  })

  test("does not select client contract from axios dependency without client files", async () => {
    const dir = await packageFixture({
      dependencies: { react: "latest", vite: "latest", axios: "latest" },
      files: {
        "src/components/KeyStatistics.tsx": "export function KeyStatistics() { return <section /> }\n",
      },
    })

    const manifest = await detectAcceptanceSurfaces({
      taskID: "tsk_dependency_only_client",
      acceptanceID: "dlv_dependency_only_client",
      projectRoot: dir,
      changedFiles: ["src/components/KeyStatistics.tsx"],
    })

    expect(manifest.surfaces).toEqual(["frontend"])
    expect(evidenceRefs(manifest, "client_contract")).toEqual([])
  })
})

async function packageFixture(input: {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  files: Record<string, string>
}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "oc-surface-detector-"))
  tempDirs.push(dir)
  await fs.writeFile(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        type: "module",
        scripts: input.scripts ?? {},
        dependencies: input.dependencies ?? {},
        devDependencies: input.devDependencies ?? {},
      },
      null,
      2,
    ),
  )
  for (const [file, text] of Object.entries(input.files)) {
    const target = path.join(dir, file)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}

function evidenceRefs(manifest: Awaited<ReturnType<typeof detectAcceptanceSurfaces>>, surface: string) {
  return manifest.evidence.filter((item) => item.surface === surface).flatMap((item) => item.refs.map((ref) => ref.ref))
}
