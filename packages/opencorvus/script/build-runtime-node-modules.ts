import fs from "fs"
import path from "path"
import { createRequire } from "module"
import {
  artifactRuntimeNodeModules,
  type ArtifactNodeRuntimeTarget,
  type ArtifactRuntimeNodeModule,
} from "./build-artifact"

function packageDestination(nodeModules: string, packageName: string) {
  return path.join(nodeModules, ...packageName.split("/"))
}

async function copyPackageDirectory(source: string, destination: string) {
  await fs.promises.rm(destination, { recursive: true, force: true })
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  await fs.promises.cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (entry) => {
      const rel = path.relative(source, entry)
      return rel === "" || !rel.split(path.sep).includes("node_modules")
    },
  })
}

function readPackageJson(source: string) {
  return JSON.parse(fs.readFileSync(path.join(source, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>
  }
}

function resolvePackageSource(
  packageName: string,
  requireFrom: NodeJS.Require,
  target: ArtifactNodeRuntimeTarget,
): string {
  let packageJson: string
  try {
    packageJson = requireFrom.resolve(`${packageName}/package.json`)
  } catch (error) {
    const targetName = `${target.os}-${target.arch}${target.abi ? `-${target.abi}` : ""}`
    throw new Error(
      `Missing runtime package '${packageName}' for target ${targetName}. ` +
        "Run the package manager for that target platform; do not install a different platform package into this workspace.",
      { cause: error },
    )
  }
  return path.dirname(packageJson)
}

async function copyRuntimePackageTree(
  packageName: string,
  outNodeModules: string,
  requireFrom: NodeJS.Require,
  target: ArtifactNodeRuntimeTarget,
  copied: Set<string>,
  rootPackageNames: Set<string>,
  copiedPackageNames: Map<string, string>,
  conflictNodeModules: string,
  runtimeDependencies: string[] = [],
) {
  const source = resolvePackageSource(packageName, requireFrom, target)
  const copiedKey = fs.realpathSync(source).toLowerCase()
  const existingSource = copiedPackageNames.get(packageName)
  const hasVersionConflict = existingSource !== undefined && existingSource !== copiedKey
  const destinationNodeModules = hasVersionConflict ? conflictNodeModules : outNodeModules
  const destination = packageDestination(destinationNodeModules, packageName)
  const destinationKey = `${copiedKey}\0${destination.toLowerCase()}`
  if (copied.has(destinationKey)) return
  copied.add(destinationKey)
  if (!hasVersionConflict) copiedPackageNames.set(packageName, copiedKey)

  await copyPackageDirectory(source, destination)

  const packageJson = readPackageJson(source)
  const dependencyNames = [...Object.keys(packageJson.dependencies ?? {}), ...runtimeDependencies].filter(
    (dependencyName) => !rootPackageNames.has(dependencyName),
  )
  if (dependencyNames.length === 0) return

  const packageRequire = createRequire(path.join(source, "package.json"))
  for (const dependencyName of dependencyNames) {
    await copyRuntimePackageTree(
      dependencyName,
      outNodeModules,
      packageRequire,
      target,
      copied,
      rootPackageNames,
      copiedPackageNames,
      path.join(destination, "node_modules"),
    )
  }
}

export async function copyRuntimeNodeModules(
  target: ArtifactNodeRuntimeTarget,
  outdir: string,
  packageRoot: string,
  modules: ArtifactRuntimeNodeModule[] = artifactRuntimeNodeModules(target),
) {
  const nodeModules = path.join(outdir, "node_modules")
  await fs.promises.mkdir(nodeModules, { recursive: true })
  const requireFromPackage = createRequire(path.join(packageRoot, "package.json"))
  const copied = new Set<string>()
  const copiedPackageNames = new Map<string, string>()
  const rootPackageNames = new Set(modules.map((item) => item.name))
  for (const item of modules) {
    await copyRuntimePackageTree(
      item.name,
      nodeModules,
      requireFromPackage,
      target,
      copied,
      rootPackageNames,
      copiedPackageNames,
      nodeModules,
      item.runtimeDependencies,
    )
  }
}
