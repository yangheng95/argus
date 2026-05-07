# Recursively find and delete stubborn "nul" files on Windows.
#
# Files named "nul" (also "con", "aux", "prn", "com1".."lpt9") are reserved
# DOS device names. Most tools (Explorer, del, Remove-Item) refuse to touch
# them because the path resolves to the device, not the file. The trick is
# to bypass Win32 path parsing with the `\\?\` prefix, which forwards the
# literal path to the NT object manager.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File script\remove-nul-files.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File script\remove-nul-files.ps1 -Root .
#   powershell -NoProfile -ExecutionPolicy Bypass -File script\remove-nul-files.ps1 -DryRun

[CmdletBinding()]
param(
    [string]$Root = (Get-Location).Path,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# Reserved DOS device basenames (case-insensitive). Default: just "nul".
# Extend via -Names if you also want to nuke con/aux/prn/com*/lpt*.
$reservedPattern = '^(nul)(\..*)?$'

$rootFull = (Resolve-Path -LiteralPath $Root).Path
Write-Host "Scanning: $rootFull"
if ($DryRun) { Write-Host "(dry run -- no files will be deleted)" -ForegroundColor Yellow }

# Use cmd's `dir /s /b /a-d` which lists files via Win32 short paths and
# tolerates reserved names better than Get-ChildItem -Recurse.
$listing = & cmd.exe /c "dir /s /b /a-d `"$rootFull`"" 2>$null

$victims = @()
foreach ($line in $listing) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    $name = Split-Path -Leaf $line
    if ($name -match $reservedPattern) {
        $victims += $line
    }
}

if ($victims.Count -eq 0) {
    Write-Host "No reserved-name files found." -ForegroundColor Green
    exit 0
}

Write-Host ("Found {0} file(s):" -f $victims.Count) -ForegroundColor Cyan
$victims | ForEach-Object { Write-Host "  $_" }

if ($DryRun) { exit 0 }

$failed = @()
foreach ($path in $victims) {
    # Build the extended-length path. Normalize to backslashes and ensure no
    # trailing slash. UNC paths (\\server\share) need `\\?\UNC\server\share`.
    $abs = [System.IO.Path]::GetFullPath($path)
    if ($abs.StartsWith('\\')) {
        $extended = '\\?\UNC\' + $abs.Substring(2)
    } else {
        $extended = '\\?\' + $abs
    }

    try {
        [System.IO.File]::Delete($extended)
        Write-Host "deleted: $abs" -ForegroundColor Green
    } catch {
        Write-Warning ("failed:  {0} -- {1}" -f $abs, $_.Exception.Message)
        $failed += $abs
    }
}

if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host ("{0} file(s) could not be deleted." -f $failed.Count) -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
