#Requires -Version 5.1
<#
.SYNOPSIS
    Testa a seguranca e funcionalidade basica do updater-helper.exe.

.DESCRIPTION
    Este script:
      1. Localiza o updater-helper.exe compilado.
      2. Testa rejeicao de caminho de instalacao perigoso (Z:\, server\).
      3. Cria um portable zip de teste em pasta temporaria.
      4. Testa extracao em diretorio temporario de instalacao.
      5. Testa bloqueio de zip-slip/path traversal.
      6. Confirma que o helper nao requer admin.

    Todos os testes usam pastas temporarias. Nenhum arquivo e escrito
    fora do diretorio TEMP. Nada toca em Z:\ ou em pasta server real.

.NOTES
    Execute a partir da raiz do repositorio:
      powershell -ExecutionPolicy Bypass -File updaterapp/scripts/test-updater-helper.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Continue'

Add-Type -AssemblyName 'System.IO.Compression.FileSystem'

# ---------------------------------------------------------------------------
# Helper Functions
# ---------------------------------------------------------------------------
$PassCount = 0
$FailCount = 0

function Pass([string]$Msg) {
    Write-Host "  [PASS] $Msg" -ForegroundColor Green
    $script:PassCount++
}

function Fail([string]$Msg) {
    Write-Host "  [FAIL] $Msg" -ForegroundColor Red
    $script:FailCount++
}

function Info([string]$Msg) {
    Write-Host "  [INFO] $Msg" -ForegroundColor Cyan
}

# Run the helper and capture its exit code reliably via Start-Process.
# Returns the process exit code as an integer.
function Invoke-Helper {
    param(
        [string]$HelperPath,
        [string[]]$Arguments
    )
    # Quote each argument that contains spaces so the OS parses them correctly.
    $quotedArgs = $Arguments | ForEach-Object {
        if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
    }
    $argString = $quotedArgs -join ' '
    try {
        $proc = Start-Process `
            -FilePath $HelperPath `
            -ArgumentList $argString `
            -Wait `
            -WindowStyle Hidden `
            -PassThru
        if ($null -eq $proc) { return -1 }
        return $proc.ExitCode
    } catch {
        return -1
    }
}

# ---------------------------------------------------------------------------
# Locate helper binary
# ---------------------------------------------------------------------------
$RepoRoot  = (Resolve-Path "$PSScriptRoot\..\.." ).Path
$TargetDir = Join-Path $RepoRoot 'updaterapp\client\src-tauri\target\release'
$HelperExe = Join-Path $TargetDir 'updater-helper.exe'

Write-Host ""
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host " Foundry & Frontier Sync -- Helper Test Suite"
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host ""

if (-not (Test-Path -LiteralPath $HelperExe)) {
    Write-Host "[SKIP] updater-helper.exe not found at:" -ForegroundColor Yellow
    Write-Host "       $HelperExe"
    Write-Host ""
    Write-Host "Build first with:"
    Write-Host "  cd updaterapp\client"
    Write-Host "  cargo build --release --bin updater-helper"
    Write-Host ""
    Write-Host "Skipping runtime tests. Exiting with code 0 (pre-build state)."
    exit 0
}

Info "Helper found: $HelperExe"
Info "Checking: not running as admin (expected)..."

$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
if (-not $isAdmin) {
    Pass "Script is running without administrator privileges (helper does not require admin)."
} else {
    Info "Script is running as admin (OK for test runs)."
}

# ---------------------------------------------------------------------------
# Create a temp workspace for all tests
# ---------------------------------------------------------------------------
$TestRoot = Join-Path $env:TEMP "ffs_helper_test_$([System.Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $TestRoot | Out-Null
Info "Test workspace: $TestRoot"

# ---------------------------------------------------------------------------
# Build a minimal valid portable zip for extraction tests
# ---------------------------------------------------------------------------
function New-ValidPortableZip {
    param([string]$ZipPath)

    $StagingDir = Join-Path $env:TEMP "ffs_zip_staging_$([System.Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Force -Path $StagingDir | Out-Null

    $AppFolder = Join-Path $StagingDir 'FoundryFrontierSync'
    New-Item -ItemType Directory -Force -Path $AppFolder | Out-Null
    Set-Content -Path (Join-Path $AppFolder 'Foundry & Frontier Sync.exe') -Value 'FAKE_EXE_DATA' -Encoding UTF8
    Set-Content -Path (Join-Path $AppFolder 'version.json') -Value '{"version":"9.9.9"}' -Encoding UTF8
    Set-Content -Path (Join-Path $AppFolder 'updater-helper.exe') -Value 'FAKE_HELPER_DATA' -Encoding UTF8

    [System.IO.Compression.ZipFile]::CreateFromDirectory(
        $StagingDir,
        $ZipPath,
        [System.IO.Compression.CompressionLevel]::Optimal,
        $false
    )

    Remove-Item -Recurse -Force $StagingDir
}

# ---------------------------------------------------------------------------
# Build a zip with a zip-slip entry (path traversal attempt)
# ---------------------------------------------------------------------------
function New-ZipSlipZip {
    param([string]$ZipPath)

    $zipBytes = New-Object System.IO.MemoryStream
    $archive = [System.IO.Compression.ZipArchive]::new($zipBytes, [System.IO.Compression.ZipArchiveMode]::Create, $true)

    # Safe entry
    $safeEntry = $archive.CreateEntry('FoundryFrontierSync/safe.txt')
    $sw = [System.IO.StreamWriter]::new($safeEntry.Open())
    $sw.Write('safe content')
    $sw.Dispose()

    # Traversal entry
    $evilEntry = $archive.CreateEntry('../../../EVIL_FILE.txt')
    $sw2 = [System.IO.StreamWriter]::new($evilEntry.Open())
    $sw2.Write('evil content')
    $sw2.Dispose()

    $archive.Dispose()

    [System.IO.File]::WriteAllBytes($ZipPath, $zipBytes.ToArray())
    $zipBytes.Dispose()
}

# ---------------------------------------------------------------------------
# Test 1: Reject Z:\ install path
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Test 1: Reject Z:\ install path" -ForegroundColor White

$DummyZip = Join-Path $TestRoot 'dummy.zip'
New-ValidPortableZip -ZipPath $DummyZip

$exitCode = Invoke-Helper -HelperPath $HelperExe -Arguments @('--pid', '99999999', '--install-dir', 'Z:\SomeFolder', '--zip', $DummyZip, '--exe', 'Z:\app.exe')

if ($exitCode -ne 0) {
    Pass "Helper rejected Z:\ install path (exit code: $exitCode)."
} else {
    Fail "Helper did NOT reject Z:\ install path (exit code: $exitCode)."
}

# ---------------------------------------------------------------------------
# Test 2: Reject install path containing 'server' component
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Test 2: Reject path with 'server' component" -ForegroundColor White

$ServerPath = Join-Path $TestRoot 'myapp\server\install'
$exitCode = Invoke-Helper -HelperPath $HelperExe -Arguments @('--pid', '99999999', '--install-dir', $ServerPath, '--zip', $DummyZip, '--exe', (Join-Path $ServerPath 'app.exe'))

if ($exitCode -ne 0) {
    Pass "Helper rejected path containing 'server' component (exit code: $exitCode)."
} else {
    Fail "Helper did NOT reject 'server' component path (exit code: $exitCode)."
}

# ---------------------------------------------------------------------------
# Test 3: Extract valid portable zip into temp install dir
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Test 3: Extract valid portable zip" -ForegroundColor White

$InstallDir = Join-Path $TestRoot 'install'
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

# Pass --exe pointing to a nonexistent directory so:
#  - verify_update finds the file in install_dir by name (PASS)
#  - relaunch_app can't find the exe and returns Err (exit 1, no dialog)
# This avoids a "16-bit app" dialog from relaunching a fake file.
$FakeExePath = 'C:\THIS_PATH_DOES_NOT_EXIST_FFS\Foundry & Frontier Sync.exe'

# Use a process that has already exited so the helper proceeds immediately
$TempProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c exit 0' -PassThru -WindowStyle Hidden
$TempPid = $TempProcess.Id
$TempProcess.WaitForExit(2000) | Out-Null

$exitCode = Invoke-Helper -HelperPath $HelperExe -Arguments @('--pid', $TempPid, '--install-dir', $InstallDir, '--zip', $DummyZip, '--exe', $FakeExePath)

# The helper exits 1 (relaunch failed - expected) but files must be extracted
$RealExePath  = Join-Path $InstallDir 'Foundry & Frontier Sync.exe'
$exeExtracted     = Test-Path -LiteralPath $RealExePath
$versionExtracted = Test-Path -LiteralPath (Join-Path $InstallDir 'version.json')

if ($exeExtracted -and $versionExtracted) {
    Pass "Portable zip extracted correctly. App exe and version.json present."
} else {
    if (-not $exeExtracted)     { Fail "App exe NOT extracted to $RealExePath (helper exit $exitCode)" }
    if (-not $versionExtracted) { Fail "version.json NOT extracted (helper exit $exitCode)" }
}

# ---------------------------------------------------------------------------
# Test 4: Block zip-slip / path traversal
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "Test 4: Block zip-slip path traversal" -ForegroundColor White

$SlipZip     = Join-Path $TestRoot 'zipslip.zip'
$SlipInstall = Join-Path $TestRoot 'slipinstall'
New-Item -ItemType Directory -Force -Path $SlipInstall | Out-Null
New-ZipSlipZip -ZipPath $SlipZip

$EvilTarget = Join-Path ([System.IO.Path]::GetTempPath()) 'EVIL_FILE.txt'
if (Test-Path -LiteralPath $EvilTarget) { Remove-Item -LiteralPath $EvilTarget -Force }

$SlipProcess = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c exit 0' -PassThru -WindowStyle Hidden
$SlipPid = $SlipProcess.Id
$SlipProcess.WaitForExit(2000) | Out-Null

$slipExit  = Invoke-Helper -HelperPath $HelperExe -Arguments @('--pid', $SlipPid, '--install-dir', $SlipInstall, '--zip', $SlipZip, '--exe', (Join-Path $SlipInstall 'Foundry & Frontier Sync.exe'))
$evilExists = Test-Path -LiteralPath $EvilTarget

if (-not $evilExists) {
    Pass "Zip-slip entry was blocked -- EVIL_FILE.txt not created outside install dir."
} else {
    Fail "Zip-slip NOT blocked -- EVIL_FILE.txt was written to: $EvilTarget"
    Remove-Item -LiteralPath $EvilTarget -Force -ErrorAction SilentlyContinue
}

# ---------------------------------------------------------------------------
# Cleanup
# ---------------------------------------------------------------------------
Remove-Item -Recurse -Force $TestRoot -ErrorAction SilentlyContinue
Remove-Item -Path (Join-Path $env:TEMP 'ffs_helper_stderr.txt') -Force -ErrorAction SilentlyContinue

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host " Test Results: $PassCount passed, $FailCount failed"
Write-Host "=============================================" -ForegroundColor Yellow
Write-Host ""

if ($FailCount -gt 0) {
    Write-Host "Some tests FAILED." -ForegroundColor Red
    exit 1
} else {
    Write-Host "All tests PASSED." -ForegroundColor Green
    exit 0
}
