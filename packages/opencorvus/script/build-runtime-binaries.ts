import fs from "node:fs"
import path from "node:path"
import {
  artifactHostCanProvideNodeRuntime,
  artifactRipgrepExecutableName,
  type ArtifactNodeRuntimeHost,
  type ArtifactNodeRuntimeTarget,
} from "./build-artifact"

export function findExecutableOnPath(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: string = process.platform,
): string | undefined {
  const paths = (env.PATH ?? env.Path ?? "").split(path.delimiter).filter(Boolean)
  const extensions = platform === "win32" ? (env.PATHEXT ?? env.PathExt ?? ".EXE;.CMD;.BAT").split(";") : [""]
  for (const dir of paths) {
    for (const ext of extensions) {
      const hasExtension = ext.length > 0 && name.toLowerCase().endsWith(ext.toLowerCase())
      const candidate = path.join(dir, hasExtension ? name : `${name}${ext}`)
      if (fs.existsSync(candidate)) return candidate
    }
  }
}

export function resolveHostRipgrepBuildPath(input: {
  env?: NodeJS.ProcessEnv
  host: ArtifactNodeRuntimeHost
  target: ArtifactNodeRuntimeTarget
}): string {
  if (!artifactHostCanProvideNodeRuntime(input.target, input.host)) {
    throw new Error(
      `Cannot copy ripgrep for target ${targetName(input.target)} from host ${hostName(input.host)}. ` +
        "Build on the target platform so the packaged rg binary matches the runtime artifact.",
    )
  }

  const source = findExecutableOnPath("rg", input.env, input.host.platform)
  if (!source) {
    throw new Error(`Missing ripgrep executable on build host PATH for target ${targetName(input.target)}.`)
  }
  return source
}

export async function copyRipgrepRuntime(input: {
  env?: NodeJS.ProcessEnv
  host: ArtifactNodeRuntimeHost
  outdir: string
  target: ArtifactNodeRuntimeTarget
}): Promise<string> {
  const source = resolveHostRipgrepBuildPath(input)
  const destination = path.join(input.outdir, "bin", artifactRipgrepExecutableName(input.target.os))
  await fs.promises.mkdir(path.dirname(destination), { recursive: true })
  await fs.promises.copyFile(source, destination)
  if (input.target.os !== "win32") {
    await fs.promises.chmod(destination, 0o755)
  }
  return destination
}

function targetName(target: ArtifactNodeRuntimeTarget): string {
  return `${target.os}-${target.arch}${target.abi ? `-${target.abi}` : ""}`
}

function hostName(host: ArtifactNodeRuntimeHost): string {
  return `${host.platform}-${host.arch}${host.linuxLibc ? `-${host.linuxLibc}` : ""}`
}
