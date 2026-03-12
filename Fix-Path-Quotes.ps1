# Fix-Path-Quotes.ps1
# Back up and remove stray double-quote characters from User/Machine PATH
# Writes backups to Desktop, then cleans PATH entries.

$ErrorActionPreference = 'Stop'

function Test-IsAdmin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $p  = New-Object Security.Principal.WindowsPrincipal($id)
  return $p.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Backup-Text([string]$path, [string]$content) {
  $dir = Split-Path -Parent $path
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
  Set-Content -Path $path -Value $content -Encoding UTF8
}

function Clean-Path([string]$p) {
  if ([string]::IsNullOrWhiteSpace($p)) { return $p }
  $items = $p -split ';' |
    ForEach-Object { $_.Trim() } |
    ForEach-Object { $_ -replace '"', '' } |
    Where-Object { $_ -ne '' }
  return ($items -join ';')
}

$ts = Get-Date -Format 'yyyyMMdd_HHmmss'
$desktop = [Environment]::GetFolderPath('Desktop')

$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$user    = [Environment]::GetEnvironmentVariable('Path', 'User')

Backup-Text (Join-Path $desktop ("Path_machine_backup_{0}.txt" -f $ts)) $machine
Backup-Text (Join-Path $desktop ("Path_user_backup_{0}.txt" -f $ts)) $user

$cleanMachine = Clean-Path $machine
$cleanUser    = Clean-Path $user

Write-Host "== Backups written to Desktop =="
Write-Host ("Machine backup: Path_machine_backup_{0}.txt" -f $ts)
Write-Host ("User backup:    Path_user_backup_{0}.txt" -f $ts)
Write-Host ""

# Always try to clean user PATH (no admin required)
[Environment]::SetEnvironmentVariable('Path', $cleanUser, 'User')
Write-Host "[OK] Cleaned USER Path"

# Clean machine PATH only if admin, otherwise warn
if (Test-IsAdmin) {
  [Environment]::SetEnvironmentVariable('Path', $cleanMachine, 'Machine')
  Write-Host "[OK] Cleaned MACHINE Path (admin)"
} else {
  Write-Host "[WARN] Not running as Administrator: MACHINE Path was NOT changed."
  Write-Host "       Re-run this script in an elevated PowerShell to clean MACHINE Path."
}

Write-Host ""
Write-Host "== Quote scan (registry values) =="
try {
  (Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment').Path -split ';' |
    Where-Object { $_ -match '"' } |
    ForEach-Object { Write-Host ("HKLM: {0}" -f $_) }
} catch {
  Write-Host ("[WARN] Unable to read HKLM Path: {0}" -f $_.Exception.Message)
}

try {
  (Get-ItemProperty 'HKCU:\\Environment').Path -split ';' |
    Where-Object { $_ -match '"' } |
    ForEach-Object { Write-Host ("HKCU: {0}" -f $_) }
} catch {
  Write-Host ("[WARN] Unable to read HKCU Path: {0}" -f $_.Exception.Message)
}

Write-Host ""
Write-Host "== Done =="
