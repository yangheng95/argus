import path from "path"

export function prepareCompiledBinaryRuntime() {
  const binDir = path.dirname(process.execPath)
  const originalCwd = process.cwd()

  // Preserve the current working directory (CWD) before native package resolution moves to the executable dir.
  process.env.OPENCORVUS_ORIGINAL_CWD = originalCwd
  process.chdir(binDir)
}
