import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs"
import os from "os"
import path from "path"

const scriptPath = path.resolve(import.meta.dir, "../../../../script/sync-host-wsl.ps1")

function source() {
  return fs.readFileSync(scriptPath, "utf8")
}

function localWslHarnessSource() {
  const text = source()
  const functionStart = text.indexOf("function Invoke-WslGitLines {")
  const nextFunction = text.indexOf("function Get-ContentHash", functionStart)
  if (functionStart < 0 || nextFunction < functionStart) {
    throw new Error("Invoke-WslGitLines function boundary not found")
  }
  const hashFunctionStart = text.indexOf("function Get-ContentHash", nextFunction)
  const afterHashFunction = text.indexOf("function Join-RepoPathPortable", hashFunctionStart)
  if (hashFunctionStart < 0 || afterHashFunction < hashFunctionStart) {
    throw new Error("Get-ContentHash function boundary not found")
  }

  const localInvokeWsl = String.raw`function Invoke-WslGitLines {
  param(
    [string]$Distro,
    [string]$Root,
    [string[]]$GitArgs
  )
  $fixtureRoot = $env:OPENCORVUS_SYNC_TEST_WSL_GIT_ROOT
  $output = & git -C $fixtureRoot -c core.quotepath=false @GitArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "git failed in local WSL fixture: git -C $fixtureRoot $($GitArgs -join ' ')"
  }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($output)) {
    if ($line -ne $null -and $line -ne "") {
      $lines.Add([string]$line)
    }
  }
  return @($lines)
}

`
  const localContentHash = String.raw`function Get-ContentHash($Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  $stream = [IO.File]::OpenRead($Path)
  try {
    $sha = [Security.Cryptography.SHA256]::Create()
    return ([BitConverter]::ToString($sha.ComputeHash($stream)) -replace "-", "").ToLowerInvariant()
  } finally {
    $stream.Dispose()
  }
}

`

  return (
    text.slice(0, functionStart) +
    localInvokeWsl +
    text
      .slice(nextFunction, hashFunctionStart) +
    localContentHash +
    text
      .slice(afterHashFunction)
      .replace(
        "$WslUncRoot = ConvertTo-WslUncPath $WslDistro $WslRoot",
        "$WslUncRoot = (Resolve-Path -LiteralPath $env:OPENCORVUS_SYNC_TEST_WSL_UNC_ROOT).Path",
      )
      .replace(
        "$wslDiff = & wsl.exe -d $WslDistro -- git -C $WslRoot diff --binary",
        "$wslDiff = & git -C $env:OPENCORVUS_SYNC_TEST_WSL_GIT_ROOT diff --binary",
      )
  )
}

async function initRepo(root: string, files: Record<string, string>) {
  fs.mkdirSync(root, { recursive: true })
  await $`git init`.cwd(root).quiet()
  await $`git config user.email test@example.com`.cwd(root).quiet()
  await $`git config user.name "Sync Test"`.cwd(root).quiet()
  for (const [relative, content] of Object.entries(files)) {
    const full = path.join(root, relative)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, content)
  }
  await $`git add .`.cwd(root).quiet()
  await $`git commit -m initial`.cwd(root).quiet()
  expect((await $`git status --porcelain`.cwd(root).quiet().text()).trim()).toBe("")
}

function latestReport(hostRoot: string) {
  const scratch = path.join(hostRoot, ".scratch")
  const reports = fs
    .readdirSync(scratch)
    .filter((entry) => entry.startsWith("sync-host-wsl-"))
    .sort()
  const report = reports.at(-1)
  if (!report) throw new Error("sync report was not created")
  return path.join(scratch, report)
}

async function runLocalSync(input: {
  hostFiles: Record<string, string>
  wslFiles: Record<string, string>
  preference?: "host" | "wsl"
}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sync-host-wsl-test-"))
  const hostRoot = path.join(root, "host")
  const wslRoot = path.join(root, "wsl")
  const harnessPath = path.join(root, "sync-host-wsl.local.ps1")
  fs.writeFileSync(harnessPath, localWslHarnessSource())
  await initRepo(hostRoot, input.hostFiles)
  await initRepo(wslRoot, input.wslFiles)
  const wslRootForGitTopCheck = wslRoot.replace(/\\/g, "/")

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    harnessPath,
    "-HostRoot",
    hostRoot,
    "-WslRoot",
    wslRootForGitTopCheck,
    "-WslDistro",
    "LocalFixture",
    "-Apply",
  ]
  if (input.preference === "host") args.push("-PreferHostForConflicts")
  if (input.preference === "wsl") args.push("-PreferWslForConflicts")

  const systemRoot = process.env.SystemRoot ?? "C:\\Windows"
  const programFiles = process.env.ProgramFiles ?? "C:\\Program Files"
  const psModulePath =
    process.env.PSModulePath ??
    [`${programFiles}\\WindowsPowerShell\\Modules`, `${systemRoot}\\system32\\WindowsPowerShell\\v1.0\\Modules`].join(
      ";",
    )
  const proc = Bun.spawn(["powershell", ...args], {
    env: {
      ...process.env,
      PSModulePath: psModulePath,
      OPENCORVUS_SYNC_TEST_WSL_GIT_ROOT: wslRoot,
      OPENCORVUS_SYNC_TEST_WSL_UNC_ROOT: wslRoot,
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  return {
    root,
    hostRoot,
    wslRoot,
    stdout,
    stderr,
    exitCode,
    reportDir: fs.existsSync(path.join(hostRoot, ".scratch")) ? latestReport(hostRoot) : undefined,
  }
}

function readFile(root: string, relative: string) {
  return fs.readFileSync(path.join(root, relative), "utf8")
}

function readReport(reportDir: string, relative: string) {
  return fs.readFileSync(path.join(reportDir, relative), "utf8")
}

describe("sync-host-wsl backups", () => {
  test("backs up final mutating action paths instead of only initially changed paths", () => {
    const text = source()

    expect(text).toContain('$mutatingActions = @($actions | Where-Object { -not $_.StartsWith("noop`t") })')
    expect(text).toContain("$mutatingActionPathSet = [System.Collections.Generic.SortedSet[string]]::new")
    expect(text).toContain("foreach ($entry in $mutatingActions)")
    expect(text).toContain("$mutatingActionPaths = @($mutatingActionPathSet)")
    expect(text).not.toContain("foreach ($relative in $changedUnion) {\n    Copy-BackupFile")
  })

  test("creates backups after conflict resolution and before copy/delete actions", () => {
    const text = source()
    const dryRunIndex = text.indexOf("if (-not $Apply) {")
    const backupIndex = text.indexOf("foreach ($relative in $mutatingActionPaths)")
    const finalActionLoopIndex = text.indexOf('foreach ($entry in $actions) {', backupIndex)
    const backupBlock = text.slice(backupIndex, finalActionLoopIndex)

    expect(dryRunIndex).toBeGreaterThanOrEqual(0)
    expect(backupIndex).toBeGreaterThan(dryRunIndex)
    expect(finalActionLoopIndex).toBeGreaterThan(backupIndex)
    expect(backupBlock).toContain("Copy-BackupFile $HostRoot $hostBackup $relative $hostDeleted")
    expect(backupBlock).toContain("Copy-BackupFile $WslUncRoot $wslBackup $relative $wslDeleted")
  })

  test("preferred clean tracked divergence actions are included in the mutating action backup set", () => {
    const text = source()
    const cleanLoopStart = text.indexOf("foreach ($relative in $trackedUnion)")
    const actionWriteIndex = text.indexOf('Write-Lines (Join-Path $reportDir "actions.tsv")', cleanLoopStart)
    const cleanLoop = text.slice(cleanLoopStart, actionWriteIndex)
    const pathSetIndex = text.indexOf("foreach ($entry in $mutatingActions)", actionWriteIndex)
    const backupIndex = text.indexOf("foreach ($relative in $mutatingActionPaths)", pathSetIndex)

    expect(cleanLoopStart).toBeGreaterThanOrEqual(0)
    expect(actionWriteIndex).toBeGreaterThan(cleanLoopStart)
    expect(cleanLoop).toContain('Add-PreferredConflictAction $relative $hostHash $wslHash "clean-tracked-divergence"')
    expect(pathSetIndex).toBeGreaterThan(actionWriteIndex)
    expect(backupIndex).toBeGreaterThan(pathSetIndex)
  })

  test("backs up both sides before preferring host over clean tracked divergence", async () => {
    const result = await runLocalSync({
      preference: "host",
      hostFiles: { "shared.txt": "host-clean\n" },
      wslFiles: { "shared.txt": "wsl-clean\n" },
    })
    try {
      expect(result.exitCode, result.stderr).toBe(0)
      expect(readFile(result.hostRoot, "shared.txt")).toBe("host-clean\n")
      expect(readFile(result.wslRoot, "shared.txt")).toBe("host-clean\n")
      expect(readReport(result.reportDir!, "actions.tsv")).toContain("host-to-wsl\tshared.txt")
      expect(readReport(result.reportDir!, "resolved-conflicts.tsv")).toContain(
        "prefer-host-copy-to-wsl\tclean-tracked-divergence\tshared.txt",
      )
      expect(readReport(result.reportDir!, "backup-host-files/shared.txt")).toBe("host-clean\n")
      expect(readReport(result.reportDir!, "backup-wsl-files/shared.txt")).toBe("wsl-clean\n")
      expect(readReport(result.reportDir!, "post-sync-diff.tsv")).toBe("")
    } finally {
      fs.rmSync(result.root, { recursive: true, force: true })
    }
  })

  test("backs up both sides before preferring WSL over clean tracked divergence", async () => {
    const result = await runLocalSync({
      preference: "wsl",
      hostFiles: { "shared.txt": "host-clean\n" },
      wslFiles: { "shared.txt": "wsl-clean\n" },
    })
    try {
      expect(result.exitCode, result.stderr).toBe(0)
      expect(readFile(result.hostRoot, "shared.txt")).toBe("wsl-clean\n")
      expect(readFile(result.wslRoot, "shared.txt")).toBe("wsl-clean\n")
      expect(readReport(result.reportDir!, "actions.tsv")).toContain("wsl-to-host\tshared.txt")
      expect(readReport(result.reportDir!, "resolved-conflicts.tsv")).toContain(
        "prefer-wsl-copy-to-host\tclean-tracked-divergence\tshared.txt",
      )
      expect(readReport(result.reportDir!, "backup-host-files/shared.txt")).toBe("host-clean\n")
      expect(readReport(result.reportDir!, "backup-wsl-files/shared.txt")).toBe("wsl-clean\n")
      expect(readReport(result.reportDir!, "post-sync-diff.tsv")).toBe("")
    } finally {
      fs.rmSync(result.root, { recursive: true, force: true })
    }
  })

  test("backs up deletion targets and missing sides for preferred clean tracked deletion", async () => {
    const result = await runLocalSync({
      preference: "host",
      hostFiles: { "host-only.txt": "host anchor\n" },
      wslFiles: { "host-only.txt": "host anchor\n", "delete-me.txt": "wsl deleted content\n" },
    })
    try {
      expect(result.exitCode, result.stderr).toBe(0)
      expect(fs.existsSync(path.join(result.wslRoot, "delete-me.txt"))).toBe(false)
      expect(readReport(result.reportDir!, "actions.tsv")).toContain("delete-wsl\tdelete-me.txt")
      expect(readReport(result.reportDir!, "resolved-conflicts.tsv")).toContain(
        "prefer-host-delete-wsl\tclean-tracked-divergence\tdelete-me.txt",
      )
      expect(readReport(result.reportDir!, "backup-wsl-files/delete-me.txt")).toBe("wsl deleted content\n")
      expect(readReport(result.reportDir!, "backup-host-deleted.txt")).toContain("delete-me.txt")
      expect(readReport(result.reportDir!, "post-sync-diff.tsv")).toBe("")
    } finally {
      fs.rmSync(result.root, { recursive: true, force: true })
    }
  })

  test("clean tracked divergence without a preference fails before mutation or backups", async () => {
    const result = await runLocalSync({
      hostFiles: { "shared.txt": "host-clean\n" },
      wslFiles: { "shared.txt": "wsl-clean\n" },
    })
    try {
      expect(result.exitCode).not.toBe(0)
      expect(readFile(result.hostRoot, "shared.txt")).toBe("host-clean\n")
      expect(readFile(result.wslRoot, "shared.txt")).toBe("wsl-clean\n")
      expect(readReport(result.reportDir!, "conflicts.tsv")).toContain("clean-tracked-divergence\tshared.txt")
      expect(fs.existsSync(path.join(result.reportDir!, "backup-host-files"))).toBe(false)
      expect(fs.existsSync(path.join(result.reportDir!, "backup-wsl-files"))).toBe(false)
    } finally {
      fs.rmSync(result.root, { recursive: true, force: true })
    }
  })
})
