import fs from "node:fs/promises"
import path from "node:path"
import { Identifier } from "@/id/id"
import { discoverPackageRoot } from "./checks/discovery"
import type { AcceptanceSpec } from "@/acceptance/types"

export type AcceptanceSurface = "frontend" | "backend_api" | "client_contract" | "test_integration" | "security_data"

export type AcceptanceSurfaceEvidence = {
  surface: AcceptanceSurface
  reason: string
  refs: Array<{
    kind: "file" | "command" | "route" | "dependency" | "runtime_probe"
    ref: string
  }>
}

export type AcceptanceSurfaceManifest = {
  id: string
  taskId?: string
  acceptanceId?: string
  projectRoot: string
  surfaces: AcceptanceSurface[]
  evidence: AcceptanceSurfaceEvidence[]
  timeCreated: number
}

const FRONTEND_DEPS = [
  "react",
  "@angular/core",
  "@angular/cli",
  "next",
  "vue",
  "svelte",
  "solid-js",
  "vite",
  "@vitejs/plugin-react",
  "@sveltejs/kit",
  "astro",
  "@solidjs/start",
]

const BACKEND_DEPS = [
  "express",
  "hono",
  "fastify",
  "koa",
  "@nestjs/core",
  "@hono/node-server",
  "elysia",
  "trpc",
  "@trpc/server",
]

const CLIENT_DEPS = ["@trpc/client", "@apollo/client", "graphql-request", "openapi-fetch", "axios"]

const SECURITY_DEPS = [
  "next-auth",
  "@auth/core",
  "passport",
  "jsonwebtoken",
  "bcrypt",
  "bcryptjs",
  "multer",
  "formidable",
  "stripe",
  "prisma",
  "drizzle-orm",
]

const WALK_EXCLUDED = new Set([
  ".git",
  ".opencorvus",
  ".opencorvus-worktrees",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "build",
  "node_modules",
  "out",
])

export async function detectAcceptanceSurfaces(input: {
  taskID?: string
  acceptanceID?: string
  projectRoot?: string
  changedFiles?: string[]
  taskRequest?: string
  metadata?: Record<string, unknown>
  goals?: Array<{
    acceptance_spec_count?: number
    acceptance_scenarios?: AcceptanceSpec[]
  }>
}): Promise<AcceptanceSurfaceManifest> {
  const projectRoot = input.projectRoot
    ? path.resolve(input.projectRoot)
    : await discoverPackageRoot(input.changedFiles)
  const evidence: AcceptanceSurfaceEvidence[] = []
  const surfaces = new Set<AcceptanceSurface>()
  const pkg = await readPackage(projectRoot)
  const files = await listProjectFiles(projectRoot)
  const changedFiles = (input.changedFiles ?? []).map((item) => item.replaceAll("\\", "/"))
  const allFileRefs = [...new Set([...files, ...changedFiles])]

  const deps = new Set([...Object.keys(pkg?.dependencies ?? {}), ...Object.keys(pkg?.devDependencies ?? {})])
  const scripts = pkg?.scripts ?? {}
  const scriptText = Object.values(scripts).join("\n")

  addDependencySurface({ evidence, surfaces, surface: "frontend", deps, names: FRONTEND_DEPS })
  if (/\b(vite|next|astro|svelte-kit|solid-start)\b/.test(scriptText)) {
    addEvidence(evidence, surfaces, "frontend", "frontend package script detected", {
      kind: "command",
      ref: scriptText,
    })
  }
  const frontendFiles = allFileRefs.filter(
    (file) =>
      /(^|\/)(src\/)?(app|pages|components)\//.test(file) ||
      /\.(tsx|jsx|vue|svelte|astro|css|scss)$/.test(file) ||
      /(^|\/)(index\.html|vite\.config\.|next\.config\.)/.test(file),
  )
  if (frontendFiles.length > 0) {
    addEvidence(evidence, surfaces, "frontend", "frontend source files detected", ...fileRefs(frontendFiles))
  }

  addDependencySurface({ evidence, surfaces, surface: "backend_api", deps, names: BACKEND_DEPS })
  const routeFiles = allFileRefs.filter(
    (file) =>
      /(^|\/)(api|routes|server|controllers|handlers)\//.test(file) ||
      /(^|\/)app\/api\//.test(file) ||
      /(server|routes|api)\.[cm]?[jt]s$/.test(file),
  )
  if (routeFiles.length > 0) {
    addEvidence(evidence, surfaces, "backend_api", "API route files detected", ...routeRefs(routeFiles))
  }

  const clientFiles = allFileRefs.filter(
    (file) =>
      /(^|\/)(sdk|client|clients|lib\/api|services\/api|generated)\//.test(file) ||
      /(openapi|graphql|fetch|api-client|client)\.[cm]?[jt]sx?$/.test(file),
  )
  if (clientFiles.length > 0) {
    const clientDependencyRefs = [...deps]
      .filter((dep) => CLIENT_DEPS.includes(dep))
      .map((dep) => ({
        kind: "dependency" as const,
        ref: dep,
      }))
    addEvidence(
      evidence,
      surfaces,
      "client_contract",
      "client/API contract files detected",
      ...fileRefs(clientFiles),
      ...clientDependencyRefs,
    )
  }
  const testFiles = allFileRefs.filter(
    (file) =>
      /(^|\/)(test|tests|e2e|integration|regression)\//.test(file) ||
      /\.(spec|test|e2e)\.[cm]?[jt]sx?$/.test(file) ||
      /^pytest\.ini$|^vitest\.config\.|^playwright\.config\./.test(file),
  )
  if (testFiles.length > 0) {
    addEvidence(evidence, surfaces, "test_integration", "test files detected", ...fileRefs(testFiles))
  }
  if (scripts.test) {
    addEvidence(evidence, surfaces, "test_integration", "test script detected", {
      kind: "command",
      ref: scripts.test,
    })
  }
  addDependencySurface({ evidence, surfaces, surface: "security_data", deps, names: SECURITY_DEPS })
  const securityFiles = allFileRefs.filter(
    (file) =>
      /(^|\/)(auth|middleware|upload|uploads|payment|payments|db|database|migrations|prisma)\//.test(file) ||
      /(auth|session|permission|upload|payment|stripe|schema|migration)\.[cm]?[jt]sx?$/.test(file) ||
      /^prisma\/schema\.prisma$/.test(file),
  )
  if (securityFiles.length > 0) {
    addEvidence(
      evidence,
      surfaces,
      "security_data",
      "security or data access files detected",
      ...fileRefs(securityFiles),
    )
  }

  return {
    id: Identifier.ascending("artifact"),
    taskId: input.taskID,
    acceptanceId: input.acceptanceID,
    projectRoot,
    surfaces: [...surfaces].sort(),
    evidence,
    timeCreated: Date.now(),
  }
}

async function readPackage(root: string): Promise<
  | {
      scripts?: Record<string, string>
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
  | undefined
> {
  const raw = await fs.readFile(path.join(root, "package.json"), "utf8").catch(() => undefined)
  if (!raw) return undefined
  return JSON.parse(raw)
}

async function listProjectFiles(root: string): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string) {
    if (out.length >= 1000) return
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (WALK_EXCLUDED.has(entry.name)) continue
      const abs = path.join(dir, entry.name)
      const rel = path.relative(root, abs).replaceAll("\\", "/")
      if (entry.isDirectory()) {
        await walk(abs)
      } else if (isInside(root, abs)) {
        out.push(rel)
      }
      if (out.length >= 1000) return
    }
  }
  await walk(root)
  return out
}

function isInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return !relative.startsWith("..") && !path.isAbsolute(relative)
}

function addDependencySurface(input: {
  evidence: AcceptanceSurfaceEvidence[]
  surfaces: Set<AcceptanceSurface>
  surface: AcceptanceSurface
  deps: Set<string>
  names: string[]
}) {
  const matched = input.names.filter((name) => input.deps.has(name))
  if (matched.length === 0) return
  addEvidence(
    input.evidence,
    input.surfaces,
    input.surface,
    "package dependencies detected",
    ...matched.map((name) => ({ kind: "dependency" as const, ref: name })),
  )
}

function addEvidence(
  evidence: AcceptanceSurfaceEvidence[],
  surfaces: Set<AcceptanceSurface>,
  surface: AcceptanceSurface,
  reason: string,
  ...refs: AcceptanceSurfaceEvidence["refs"]
) {
  surfaces.add(surface)
  evidence.push({
    surface,
    reason,
    refs: refs.slice(0, 12),
  })
}

function fileRefs(files: string[]): AcceptanceSurfaceEvidence["refs"] {
  return files.slice(0, 12).map((file) => ({ kind: "file", ref: file }))
}

function routeRefs(files: string[]): AcceptanceSurfaceEvidence["refs"] {
  return files.slice(0, 12).map((file) => ({ kind: "route", ref: file }))
}
