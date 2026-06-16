param(
  [string]$HostRoot = (Get-Location).Path,
  [string]$WslDistro = "Ubuntu-24.04",
  [string]$WslRoot = "/home/yangheng/myhexin-local/opecorvus",
  [switch]$PreferHostForConflicts,
  [switch]$PreferWslForConflicts,
  [switch]$PreferHostForWslChanges,
  [string[]]$OnlyPath = @(),
  [switch]$Apply
)

$ErrorActionPreference = "Stop"

if ($PreferHostForConflicts -and $PreferWslForConflicts) {
  throw "[sync-host-wsl] choose only one conflict preference"
}
if ($PreferHostForWslChanges -and $PreferWslForConflicts) {
  throw "[sync-host-wsl] PreferHostForWslChanges cannot be combined with PreferWslForConflicts"
}

function Fail($Message) {
  throw "[sync-host-wsl] $Message"
}

function Require-CleanPath($Path, $Name) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    Fail "$Name must not be empty"
  }
}

function ConvertTo-WslUncPath($Distro, $LinuxPath) {
  Require-CleanPath $Distro "WSL distro"
  Require-CleanPath $LinuxPath "WSL root"
  $trimmed = $LinuxPath.Trim()
  if (-not $trimmed.StartsWith("/")) {
    Fail "WSL root must be an absolute Linux path: $LinuxPath"
  }
  $relative = $trimmed.TrimStart("/") -replace "/", "\"
  return "\\wsl.localhost\$Distro\$relative"
}

function Invoke-HostGitLines {
  param(
    [string]$Root,
    [string[]]$GitArgs
  )
  $output = & git -C $Root -c core.quotepath=false @GitArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "git failed in host workspace: git -C $Root $($GitArgs -join ' ')"
  }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($output)) {
    if ($line -ne $null -and $line -ne "") {
      $lines.Add([string]$line)
    }
  }
  return @($lines)
}

function Invoke-WslGitLines {
  param(
    [string]$Distro,
    [string]$Root,
    [string[]]$GitArgs
  )
  $output = & wsl.exe -d $Distro -- git -C $Root -c core.quotepath=false @GitArgs
  if ($LASTEXITCODE -ne 0) {
    Fail "git failed in WSL workspace: git -C $Root $($GitArgs -join ' ')"
  }
  $lines = [System.Collections.Generic.List[string]]::new()
  foreach ($line in @($output)) {
    if ($line -ne $null -and $line -ne "") {
      $lines.Add([string]$line)
    }
  }
  return @($lines)
}

function Get-ContentHash($Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return $null
  }
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Join-RepoPathPortable($Root, $RelativePath) {
  $normalized = $RelativePath -replace "/", [IO.Path]::DirectorySeparatorChar
  return Join-Path $Root $normalized
}

function Copy-RepoFile($SourceRoot, $DestinationRoot, $RelativePath) {
  $source = Join-RepoPathPortable $SourceRoot $RelativePath
  $destination = Join-RepoPathPortable $DestinationRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source -PathType Leaf)) {
    Fail "source file is missing: $source"
  }
  $parent = Split-Path -Parent $destination
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  Copy-Item -LiteralPath $source -Destination $destination -Force
}

function Remove-RepoFile($Root, $RelativePath) {
  $target = Join-RepoPathPortable $Root $RelativePath
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    Remove-Item -LiteralPath $target
  }
}

function Copy-BackupFile($SourceRoot, $BackupRoot, $RelativePath, $DeletedList) {
  $source = Join-RepoPathPortable $SourceRoot $RelativePath
  if (Test-Path -LiteralPath $source -PathType Leaf) {
    $destination = Join-RepoPathPortable $BackupRoot $RelativePath
    $parent = Split-Path -Parent $destination
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    Copy-Item -LiteralPath $source -Destination $destination -Force
    return
  }
  Add-Content -LiteralPath $DeletedList -Value $RelativePath -Encoding UTF8
}

function Set-Union([string[]]$Left, [string[]]$Right) {
  $set = [System.Collections.Generic.SortedSet[string]]::new([StringComparer]::Ordinal)
  foreach ($item in @($Left + $Right)) {
    if (-not [string]::IsNullOrWhiteSpace($item)) {
      [void]$set.Add(($item -replace "\\", "/"))
    }
  }
  return @($set)
}

function Contains-PathItem($Set, $Item) {
  return $Set.Contains(($Item -replace "\\", "/"))
}

function Filter-Paths([string[]]$Paths, [string[]]$Allowed) {
  if ($Allowed.Count -eq 0) {
    return @($Paths)
  }
  $allowedSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($item in $Allowed) {
    if (-not [string]::IsNullOrWhiteSpace($item)) {
      [void]$allowedSet.Add(($item -replace "\\", "/"))
    }
  }
  $filtered = [System.Collections.Generic.List[string]]::new()
  foreach ($path in $Paths) {
    if ($allowedSet.Contains(($path -replace "\\", "/"))) {
      $filtered.Add($path)
    }
  }
  return @($filtered)
}

function Write-Lines($Path, [string[]]$Lines) {
  if ($null -eq $Lines) {
    $Lines = @()
  }
  [IO.File]::WriteAllLines($Path, $Lines, [Text.UTF8Encoding]::new($false))
}

$HostRoot = (Resolve-Path -LiteralPath $HostRoot).Path
$WslUncRoot = ConvertTo-WslUncPath $WslDistro $WslRoot
if (-not (Test-Path -LiteralPath $WslUncRoot -PathType Container)) {
  Fail "WSL workspace is not reachable through UNC path: $WslUncRoot"
}

$hostTop = @(Invoke-HostGitLines -Root $HostRoot -GitArgs @("rev-parse", "--show-toplevel"))[0]
$wslTop = @(Invoke-WslGitLines -Distro $WslDistro -Root $WslRoot -GitArgs @("rev-parse", "--show-toplevel"))[0]
if ((Resolve-Path -LiteralPath $hostTop).Path -ne $HostRoot) {
  Fail "HostRoot is not the git toplevel. Expected $hostTop, got $HostRoot"
}
if ($wslTop -ne $WslRoot) {
  Fail "WslRoot is not the git toplevel. Expected $wslTop, got $WslRoot"
}

$hostHead = @(Invoke-HostGitLines -Root $HostRoot -GitArgs @("rev-parse", "HEAD"))[0]
$wslHead = @(Invoke-WslGitLines -Distro $WslDistro -Root $WslRoot -GitArgs @("rev-parse", "HEAD"))[0]
$hostChanged = Set-Union (Invoke-HostGitLines -Root $HostRoot -GitArgs @("ls-files", "-m", "-o", "--exclude-standard")) @()
$wslChanged = Set-Union (Invoke-WslGitLines -Distro $WslDistro -Root $WslRoot -GitArgs @("ls-files", "-m", "-o", "--exclude-standard")) @()
$hostTracked = Invoke-HostGitLines -Root $HostRoot -GitArgs @("ls-files")
$wslTracked = Invoke-WslGitLines -Distro $WslDistro -Root $WslRoot -GitArgs @("ls-files")

$hostChanged = Filter-Paths $hostChanged $OnlyPath
$wslChanged = Filter-Paths $wslChanged $OnlyPath
$hostTracked = Filter-Paths $hostTracked $OnlyPath
$wslTracked = Filter-Paths $wslTracked $OnlyPath

$changedUnion = Set-Union $hostChanged $wslChanged
$trackedUnion = Set-Union $hostTracked $wslTracked

$hostChangedSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
$wslChangedSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
foreach ($item in $hostChanged) { [void]$hostChangedSet.Add($item) }
foreach ($item in $wslChanged) { [void]$wslChangedSet.Add($item) }

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$scratch = Join-Path $HostRoot ".scratch"
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
$reportDir = Join-Path $scratch "sync-host-wsl-$timestamp"
New-Item -ItemType Directory -Force -Path $reportDir | Out-Null

Write-Lines (Join-Path $reportDir "host-changed.txt") $hostChanged
Write-Lines (Join-Path $reportDir "wsl-changed.txt") $wslChanged
Write-Lines (Join-Path $reportDir "host-head.txt") @($hostHead)
Write-Lines (Join-Path $reportDir "wsl-head.txt") @($wslHead)

if ($Apply) {
  $hostBackup = Join-Path $reportDir "backup-host-files"
  $wslBackup = Join-Path $reportDir "backup-wsl-files"
  New-Item -ItemType Directory -Force -Path $hostBackup, $wslBackup | Out-Null
  $hostDeleted = Join-Path $reportDir "backup-host-deleted.txt"
  $wslDeleted = Join-Path $reportDir "backup-wsl-deleted.txt"
  New-Item -ItemType File -Force -Path $hostDeleted, $wslDeleted | Out-Null
  foreach ($relative in $changedUnion) {
    Copy-BackupFile $HostRoot $hostBackup $relative $hostDeleted
    Copy-BackupFile $WslUncRoot $wslBackup $relative $wslDeleted
  }
  $hostDiff = & git -C $HostRoot diff --binary
  Write-Lines (Join-Path $reportDir "host-tracked.diff") @($hostDiff)
  $wslDiff = & wsl.exe -d $WslDistro -- git -C $WslRoot diff --binary
  Write-Lines (Join-Path $reportDir "wsl-tracked.diff") @($wslDiff)
}

$actions = [System.Collections.Generic.List[string]]::new()
$conflicts = [System.Collections.Generic.List[string]]::new()
$resolutions = [System.Collections.Generic.List[string]]::new()

function Add-PreferredConflictAction($RelativePath, $HostHash, $WslHash, $Reason) {
  if ($PreferHostForConflicts) {
    if ($HostHash -eq $null) {
      $actions.Add("delete-wsl`t$RelativePath")
      $resolutions.Add("prefer-host-delete-wsl`t$Reason`t$RelativePath")
    } else {
      $actions.Add("host-to-wsl`t$RelativePath")
      $resolutions.Add("prefer-host-copy-to-wsl`t$Reason`t$RelativePath")
    }
    return $true
  }
  if ($PreferWslForConflicts) {
    if ($WslHash -eq $null) {
      $actions.Add("delete-host`t$RelativePath")
      $resolutions.Add("prefer-wsl-delete-host`t$Reason`t$RelativePath")
    } else {
      $actions.Add("wsl-to-host`t$RelativePath")
      $resolutions.Add("prefer-wsl-copy-to-host`t$Reason`t$RelativePath")
    }
    return $true
  }
  return $false
}

foreach ($relative in $changedUnion) {
  $hostPath = Join-RepoPathPortable $HostRoot $relative
  $wslPath = Join-RepoPathPortable $WslUncRoot $relative
  $hostHash = Get-ContentHash $hostPath
  $wslHash = Get-ContentHash $wslPath
  $hostTouched = Contains-PathItem $hostChangedSet $relative
  $wslTouched = Contains-PathItem $wslChangedSet $relative

  if ($hostHash -ne $null -and $wslHash -ne $null -and $hostHash -eq $wslHash) {
    $actions.Add("noop`t$relative")
    continue
  }

  if ($hostTouched -and -not $wslTouched) {
    if ($hostHash -eq $null) {
      $actions.Add("delete-wsl`t$relative")
    } else {
      $actions.Add("host-to-wsl`t$relative")
    }
    continue
  }

  if ($wslTouched -and -not $hostTouched) {
    if ($PreferHostForWslChanges) {
      if ($hostHash -eq $null) {
        $actions.Add("delete-wsl`t$relative")
        $resolutions.Add("prefer-host-delete-wsl`t$relative")
      } else {
        $actions.Add("host-to-wsl`t$relative")
        $resolutions.Add("prefer-host-copy-to-wsl`t$relative")
      }
    } else {
      if ($wslHash -eq $null) {
        $actions.Add("delete-host`t$relative")
      } else {
        $actions.Add("wsl-to-host`t$relative")
      }
    }
    continue
  }

  if (-not (Add-PreferredConflictAction $relative $hostHash $wslHash "both-touched-different")) {
    $conflicts.Add("both-touched-different`t$relative")
  }
}

foreach ($relative in $trackedUnion) {
  if (Contains-PathItem $changedUnion $relative) {
    continue
  }
  $hostHash = Get-ContentHash (Join-RepoPathPortable $HostRoot $relative)
  $wslHash = Get-ContentHash (Join-RepoPathPortable $WslUncRoot $relative)
  if ($hostHash -ne $wslHash) {
    if (-not (Add-PreferredConflictAction $relative $hostHash $wslHash "clean-tracked-divergence")) {
      $conflicts.Add("clean-tracked-divergence`t$relative")
    }
  }
}

Write-Lines (Join-Path $reportDir "actions.tsv") @($actions)
Write-Lines (Join-Path $reportDir "conflicts.tsv") @($conflicts)
Write-Lines (Join-Path $reportDir "resolved-conflicts.tsv") @($resolutions)
$mutatingActions = @($actions | Where-Object { -not $_.StartsWith("noop`t") })

if ($conflicts.Count -gt 0) {
  Write-Host "Host HEAD: $hostHead"
  Write-Host "WSL HEAD:  $wslHead"
  Write-Host "Conflicts: $($conflicts.Count)"
  Write-Host "Report: $reportDir"
  Get-Content -LiteralPath (Join-Path $reportDir "conflicts.tsv")
  Fail "conflicts detected; no files were synchronized"
}

if (-not $Apply) {
  Write-Host "Dry run only. Add -Apply to copy files."
  Write-Host "Host HEAD: $hostHead"
  Write-Host "WSL HEAD:  $wslHead"
  Write-Host "Action rows: $($actions.Count)"
  Write-Host "Copy/delete: $($mutatingActions.Count)"
  Write-Host "Report:    $reportDir"
  exit 0
}

foreach ($entry in $actions) {
  $parts = $entry -split "`t", 2
  $action = $parts[0]
  $relative = $parts[1]
  switch ($action) {
    "host-to-wsl" { Copy-RepoFile $HostRoot $WslUncRoot $relative }
    "wsl-to-host" { Copy-RepoFile $WslUncRoot $HostRoot $relative }
    "delete-host" { Remove-RepoFile $HostRoot $relative }
    "delete-wsl" { Remove-RepoFile $WslUncRoot $relative }
    "noop" { }
    default { Fail "unknown sync action: $action" }
  }
}

$postConflicts = [System.Collections.Generic.List[string]]::new()
foreach ($relative in (Set-Union $trackedUnion $changedUnion)) {
  $hostHash = Get-ContentHash (Join-RepoPathPortable $HostRoot $relative)
  $wslHash = Get-ContentHash (Join-RepoPathPortable $WslUncRoot $relative)
  if ($hostHash -ne $wslHash) {
    $postConflicts.Add("post-sync-diff`t$relative")
  }
}
Write-Lines (Join-Path $reportDir "post-sync-diff.tsv") @($postConflicts)
if ($postConflicts.Count -gt 0) {
  Fail "post-sync verification failed; see $reportDir"
}

Write-Host "Synchronized host and WSL workspaces."
Write-Host "Action rows: $($actions.Count)"
Write-Host "Copy/delete: $($mutatingActions.Count)"
Write-Host "Report:  $reportDir"
