import fs from "node:fs/promises"
import path from "node:path"
import { runProcessWithInactivityTimeout } from "./inactivity-timeout-process"
import { clip } from "./types"

const INSTALL_TIMEOUT_MS = 300_000

export type SupportedPackageManager = "npm" | "bun" | "pnpm" | "yarn"

export type RuntimeReadinessCheck = {
  id: string
  name: string
  status: "passed" | "failed" | "skipped"
  evidence: string[]
  command?: string
  exitCode?: number
}

export type ProjectRuntimeReadiness = {
  id: string
  projectRoot: string
  status: "passed" | "failed" | "skipped"
  packageManager?: string
  packageManagerName?: SupportedPackageManager
  lockfile?: string
  checks: RuntimeReadinessCheck[]
  failedReadinessIds: string[]
  evidence: string[]
  timeCreated: number
}

type RuntimePackage = {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packageManager?: string
}

const PACKAGE_MANAGER_LOCKFILES: Record<SupportedPackageManager, string> = {
  npm: "package-lock.json",
  bun: "bun.lock",
  pnpm: "pnpm-lock.yaml",
  yarn: "yarn.lock",
}

const ALL_LOCKFILES = new Set(Object.values(PACKAGE_MANAGER_LOCKFILES))

export async function ensureProjectReadyForRuntime(input: { projectRoot: string }): Promise<ProjectRuntimeReadiness> {
  const projectRoot = path.resolve(input.projectRoot)
  const checks: RuntimeReadinessCheck[] = []
  const timeCreated = Date.now()
  const pkg = await readRuntimePackage(projectRoot)
  if (!pkg) {
    checks.push({
      id: "runtime-readiness:package-json",
      name: "Runtime package manifest",
      status: "skipped",
      evidence: ["No package.json found; project has no JavaScript/TypeScript runtime contract."],
    })
    return readinessResult({ projectRoot, checks, timeCreated })
  }

  if (!declaresRuntimeContract(pkg)) {
    checks.push({
      id: "runtime-readiness:package-json",
      name: "Runtime package manifest",
      status: "skipped",
      evidence: ["package.json does not declare scripts, dependencies, or devDependencies."],
    })
    return readinessResult({ projectRoot, checks, timeCreated })
  }

  const packageManager = pkg.packageManager?.trim()
  const packageManagerNameValue = packageManagerName(pkg)
  checks.push({
    id: "runtime-readiness:package-manager",
    name: "Package manager declaration",
    status: packageManagerNameValue ? "passed" : "failed",
    evidence: packageManagerNameValue
      ? [`packageManager=${packageManager}`]
      : [`package.json must declare packageManager as one of ${Object.keys(PACKAGE_MANAGER_LOCKFILES).join(", ")}`],
  })
  if (!packageManagerNameValue) {
    return readinessResult({ projectRoot, checks, timeCreated, packageManager })
  }

  const lockfileCheck = await validateLockfile({ projectRoot, packageManagerName: packageManagerNameValue })
  checks.push(lockfileCheck)
  if (lockfileCheck.status === "failed") {
    return readinessResult({
      projectRoot,
      checks,
      timeCreated,
      packageManager,
      packageManagerName: packageManagerNameValue,
    })
  }

  const installCheck = await ensureDependenciesInstalled({
    projectRoot,
    pkg,
    packageManagerName: packageManagerNameValue,
  })
  checks.push(installCheck)

  return readinessResult({
    projectRoot,
    checks,
    timeCreated,
    packageManager,
    packageManagerName: packageManagerNameValue,
    lockfile: PACKAGE_MANAGER_LOCKFILES[packageManagerNameValue],
  })
}

export function packageManagerName(pkg: { packageManager?: string } | undefined): SupportedPackageManager | undefined {
  const raw = pkg?.packageManager?.trim()
  if (!raw) return undefined
  const manager = raw.split("@", 1)[0]
  if (manager === "npm" || manager === "bun" || manager === "pnpm" || manager === "yarn") return manager
  return undefined
}

export function packageManagerExecutable(manager: SupportedPackageManager) {
  if (process.platform !== "win32") return manager
  return manager === "bun" ? manager : `${manager}.cmd`
}

export function runtimeReadinessInstallCommand(manager: SupportedPackageManager) {
  switch (manager) {
    case "npm":
      return { executable: packageManagerExecutable(manager), args: ["ci"], command: "npm ci" }
    case "bun":
      return {
        executable: packageManagerExecutable(manager),
        args: ["install", "--frozen-lockfile"],
        command: "bun install --frozen-lockfile",
      }
    case "pnpm":
      return {
        executable: packageManagerExecutable(manager),
        args: ["install", "--frozen-lockfile"],
        command: "pnpm install --frozen-lockfile",
      }
    case "yarn":
      return {
        executable: packageManagerExecutable(manager),
        args: ["install", "--immutable"],
        command: "yarn install --immutable",
      }
  }
}

function readinessResult(input: {
  projectRoot: string
  checks: RuntimeReadinessCheck[]
  timeCreated: number
  packageManager?: string
  packageManagerName?: SupportedPackageManager
  lockfile?: string
}): ProjectRuntimeReadiness {
  const failedReadinessIds = input.checks.filter((check) => check.status === "failed").map((check) => check.id)
  const effectiveChecks = input.checks.filter((check) => check.status !== "skipped")
  const status = failedReadinessIds.length > 0 ? "failed" : effectiveChecks.length === 0 ? "skipped" : "passed"
  return {
    id: "runtime-readiness:project",
    projectRoot: input.projectRoot,
    status,
    packageManager: input.packageManager,
    packageManagerName: input.packageManagerName,
    lockfile: input.lockfile,
    checks: input.checks,
    failedReadinessIds,
    evidence: input.checks.flatMap((check) => check.evidence.map((item) => `${check.id}: ${item}`)),
    timeCreated: input.timeCreated,
  }
}

async function readRuntimePackage(projectRoot: string): Promise<RuntimePackage | undefined> {
  const pkgPath = path.join(projectRoot, "package.json")
  try {
    return JSON.parse(await fs.readFile(pkgPath, "utf8")) as RuntimePackage
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? (error as { code?: unknown }).code : undefined
    if (code === "ENOENT") return undefined
    return {
      scripts: {},
      dependencies: {},
      devDependencies: {},
      packageManager: undefined,
    }
  }
}

function declaresRuntimeContract(pkg: RuntimePackage) {
  return objectHasEntries(pkg.scripts) || objectHasEntries(pkg.dependencies) || objectHasEntries(pkg.devDependencies)
}

function objectHasEntries(value: Record<string, string> | undefined) {
  return !!value && Object.keys(value).length > 0
}

async function validateLockfile(input: {
  projectRoot: string
  packageManagerName: SupportedPackageManager
}): Promise<RuntimeReadinessCheck> {
  const expected = PACKAGE_MANAGER_LOCKFILES[input.packageManagerName]
  const owner = await findLockfileOwner({
    projectRoot: input.projectRoot,
    expected,
  })
  const present = owner ? await presentLockfiles(owner) : []
  const hasExpected = present.includes(expected)
  const conflicts = present.filter((item) => item !== expected)
  const ownerEvidence = owner
    ? `lockfile_owner=${(path.relative(input.projectRoot, owner) || ".").replaceAll("\\", "/")}`
    : undefined
  const evidence = [
    hasExpected ? `lockfile=${expected}` : `missing_lockfile=${expected}`,
    ownerEvidence,
    conflicts.length > 0 ? `conflicting_lockfiles=${conflicts.join(",")}` : undefined,
  ].filter((item): item is string => Boolean(item))
  return {
    id: "runtime-readiness:lockfile",
    name: "Package manager lockfile",
    status: hasExpected && conflicts.length === 0 ? "passed" : "failed",
    evidence,
  }
}

async function findLockfileOwner(input: { projectRoot: string; expected: string }): Promise<string | undefined> {
  let current = path.resolve(input.projectRoot)
  while (true) {
    const present = await presentLockfiles(current)
    if (present.includes(input.expected)) return current
    if (present.length > 0) return current
    if (await isWorkspaceOwner(current)) return current
    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
  }
}

async function isWorkspaceOwner(dir: string) {
  if (await pathExists(path.join(dir, "pnpm-workspace.yaml"))) return true
  const pkg = await readRuntimePackage(dir)
  return hasWorkspaceDeclaration(pkg)
}

function hasWorkspaceDeclaration(pkg: RuntimePackage | undefined) {
  const workspaces = (pkg as { workspaces?: unknown } | undefined)?.workspaces
  if (Array.isArray(workspaces)) return workspaces.length > 0
  if (workspaces && typeof workspaces === "object") {
    const packages = (workspaces as { packages?: unknown }).packages
    return Array.isArray(packages) && packages.length > 0
  }
  return false
}

async function presentLockfiles(projectRoot: string) {
  const entries = await fs.readdir(projectRoot).catch(() => [])
  return entries.filter((entry) => ALL_LOCKFILES.has(entry))
}

async function ensureDependenciesInstalled(input: {
  projectRoot: string
  pkg: RuntimePackage
  packageManagerName: SupportedPackageManager
}): Promise<RuntimeReadinessCheck> {
  if (!objectHasEntries(input.pkg.dependencies) && !objectHasEntries(input.pkg.devDependencies)) {
    return {
      id: "runtime-readiness:install",
      name: "Frozen dependency install",
      status: "skipped",
      evidence: ["package.json declares no dependencies or devDependencies."],
    }
  }
  if (await pathExists(path.join(input.projectRoot, "node_modules"))) {
    return {
      id: "runtime-readiness:install",
      name: "Frozen dependency install",
      status: "passed",
      evidence: ["node_modules exists for declared dependencies."],
    }
  }

  const command = runtimeReadinessInstallCommand(input.packageManagerName)
  const result = await runInstallCommand({
    executable: command.executable,
    args: command.args,
    cwd: input.projectRoot,
    timeoutMs: INSTALL_TIMEOUT_MS,
  })
  const output = clip([result.stdout, result.stderr].filter(Boolean).join("\n"), 4000)
  return {
    id: "runtime-readiness:install",
    name: "Frozen dependency install",
    status: result.exitCode === 0 ? "passed" : "failed",
    command: command.command,
    exitCode: result.exitCode,
    evidence:
      result.exitCode === 0
        ? [`${command.command} completed successfully.`]
        : [`${command.command} failed with exit_code=${result.exitCode ?? "unknown"}`, output],
  }
}

async function pathExists(target: string) {
  return fs.access(target).then(
    () => true,
    () => false,
  )
}

async function runInstallCommand(input: {
  executable: string
  args: string[]
  cwd: string
  timeoutMs: number
}): Promise<{ exitCode: number | undefined; stdout: string; stderr: string }> {
  return runProcessWithInactivityTimeout({
    executable: input.executable,
    args: input.args,
    cwd: input.cwd,
    timeoutMs: input.timeoutMs,
  })
}
