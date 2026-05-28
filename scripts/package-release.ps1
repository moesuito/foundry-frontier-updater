#Requires -Version 5.1
<#
.SYNOPSIS
    Empacota os artefatos de release do Foundry & Frontier Sync.

.DESCRIPTION
    Este script:
      1. Le a versao atual do tauri.conf.json.
      2. Localiza o instalador NSIS gerado pelo `tauri build`.
      3. Monta o portable zip com a pasta FoundryFrontierSync.
      4. Gera version.json.
      5. Gera SHA256SUMS.txt.
      6. Copia tudo para updaterapp/release/<version>/.

.NOTES
    Execute a partir da raiz do repositorio:
      powershell -ExecutionPolicy Bypass -File updaterapp/scripts/package-release.ps1

    Pre-requisito: ja ter rodado antes:
      npm --prefix updaterapp/client install
      npm --prefix updaterapp/client run tauri build -- --bundles nsis
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$RepoRoot     = (Resolve-Path "$PSScriptRoot\..\.." ).Path
$ClientDir    = Join-Path $RepoRoot 'updaterapp\client'
$TauriConfPath = Join-Path $ClientDir 'src-tauri\tauri.conf.json'
$TargetDir    = Join-Path $ClientDir 'src-tauri\target\release'
$BundleDir    = Join-Path $TargetDir 'bundle'

# ---------------------------------------------------------------------------
# Lê versão do tauri.conf.json
# ---------------------------------------------------------------------------
Write-Host "Lendo versao de $TauriConfPath ..."
$TauriConf = Get-Content $TauriConfPath -Raw | ConvertFrom-Json
$Version   = $TauriConf.package.version
if (-not $Version) {
    Write-Error "Nao foi possivel ler package.version de tauri.conf.json"
    exit 1
}
Write-Host "  Versao: $Version"

# ---------------------------------------------------------------------------
# Diretorio de saida
# ---------------------------------------------------------------------------
$ReleaseDir = Join-Path $RepoRoot "updaterapp\release\$Version"
if (Test-Path $ReleaseDir) {
    Write-Host "Limpando diretorio de release anterior: $ReleaseDir"
    Remove-Item -Recurse -Force $ReleaseDir
}
New-Item -ItemType Directory -Force -Path $ReleaseDir | Out-Null
Write-Host "Diretorio de release: $ReleaseDir"

# ---------------------------------------------------------------------------
# Localizando o instalador NSIS
# ---------------------------------------------------------------------------
$NsisDir = Join-Path $BundleDir 'nsis'
if (-not (Test-Path $NsisDir)) {
    Write-Error "Pasta NSIS nao encontrada em: $NsisDir`nRode primeiro: npm --prefix updaterapp/client run tauri build -- --bundles nsis"
    exit 1
}

$SetupExe = Get-ChildItem -Path $NsisDir -Filter "*$Version*.exe" -ErrorAction SilentlyContinue |
            Select-Object -First 1
if (-not $SetupExe) {
    $SetupExe = Get-ChildItem -Path $NsisDir -Filter '*_setup.exe' -ErrorAction SilentlyContinue |
                Select-Object -First 1
}
if (-not $SetupExe) {
    # Tauri v1 pode nomear sem sufixo _setup em versoes antigas
    $SetupExe = Get-ChildItem -Path $NsisDir -Filter '*.exe' -ErrorAction SilentlyContinue |
                Select-Object -First 1
}
if (-not $SetupExe) {
    Write-Error "Instalador NSIS (.exe) nao encontrado em: $NsisDir"
    exit 1
}
Write-Host "Instalador NSIS encontrado: $($SetupExe.Name)"

$SetupDestName = "foundry_frontier_sync_setup.exe"
Copy-Item -LiteralPath $SetupExe.FullName -Destination (Join-Path $ReleaseDir $SetupDestName) -Force
Write-Host "  Copiado -> $SetupDestName"

# ---------------------------------------------------------------------------
# Localizando o executavel principal (release nao-bundled)
# ---------------------------------------------------------------------------
$AppExe = Join-Path $TargetDir 'Foundry & Frontier Sync.exe'
if (-not (Test-Path -LiteralPath $AppExe)) {
    Write-Error "Executavel principal nao encontrado em: $AppExe"
    exit 1
}
Write-Host "Executavel principal: $AppExe"

# ---------------------------------------------------------------------------
# version.json
# ---------------------------------------------------------------------------
$VersionJson = [ordered]@{
    appId      = 'foundry-frontier-sync'
    version    = $Version
    releaseTag = "v$Version"
    repo       = 'moesuito/foundry-frontier-updater'
}
$VersionJsonPath = Join-Path $ReleaseDir 'version.json'
$VersionJson | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -Path $VersionJsonPath
Write-Host "Gerado: version.json"

# ---------------------------------------------------------------------------
# Portable zip: FoundryFrontierSync\
# ---------------------------------------------------------------------------
Write-Host "Montando portable zip ..."

$PortableStagingDir = Join-Path $env:TEMP "ffs_portable_staging_$([System.Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $PortableStagingDir | Out-Null
$FolderInZip = Join-Path $PortableStagingDir 'FoundryFrontierSync'
New-Item -ItemType Directory -Force -Path $FolderInZip | Out-Null

Copy-Item -LiteralPath $AppExe -Destination (Join-Path $FolderInZip 'Foundry & Frontier Sync.exe') -Force
Copy-Item -LiteralPath $VersionJsonPath -Destination (Join-Path $FolderInZip 'version.json') -Force

# Include sync-runner.exe if it was compiled (U1.2)
$HelperExe = Join-Path $TargetDir 'sync-runner.exe'
if (Test-Path -LiteralPath $HelperExe) {
    Copy-Item -LiteralPath $HelperExe -Destination (Join-Path $FolderInZip 'sync-runner.exe') -Force
    Write-Host "  Incluido sync-runner.exe no portable zip."
} else {
    Write-Warning "sync-runner.exe nao encontrado em $HelperExe - portable zip sera criado sem ele."
    Write-Warning "Execute 'cargo build --release --bin sync-runner' para compilar o helper."
}

$PortableZipName = 'foundry_frontier_sync_portable.zip'
$PortableZipPath = Join-Path $ReleaseDir $PortableZipName

Add-Type -AssemblyName 'System.IO.Compression.FileSystem'
[System.IO.Compression.ZipFile]::CreateFromDirectory(
    $PortableStagingDir,
    $PortableZipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false  # nao inclui o nome da pasta raiz de staging
)

Remove-Item -Recurse -Force $PortableStagingDir
Write-Host "  Gerado: $PortableZipName"

# ---------------------------------------------------------------------------
# SHA256SUMS.txt
# ---------------------------------------------------------------------------
Write-Host "Calculando SHA256 ..."

$Artifacts = @(
    $SetupDestName,
    $PortableZipName,
    'version.json'
)

$SumsLines = @()
foreach ($Name in $Artifacts) {
    $FilePath = Join-Path $ReleaseDir $Name
    if (-not (Test-Path -LiteralPath $FilePath)) {
        Write-Warning "Arquivo nao encontrado para hash: $FilePath"
        continue
    }
    $Hash = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLower()
    $SumsLines += "$Hash  $Name"
    Write-Host "  $Name : $Hash"
}

$SumsPath = Join-Path $ReleaseDir 'SHA256SUMS.txt'
$SumsLines | Set-Content -Encoding UTF8 -Path $SumsPath
Write-Host "Gerado: SHA256SUMS.txt"

# ---------------------------------------------------------------------------
# Resumo
# ---------------------------------------------------------------------------
Write-Host ""
Write-Host "========================================="
Write-Host "Release v$Version pronto em:"
Write-Host "  $ReleaseDir"
Write-Host ""
Get-ChildItem -Path $ReleaseDir | ForEach-Object {
    Write-Host ("  {0,-42} {1,10} bytes" -f $_.Name, $_.Length)
}
Write-Host "========================================="
Write-Host ""
Write-Host "Validacao manual:"
Write-Host "  1. Instale $SetupDestName e confirme que nao pede UAC/admin."
Write-Host "  2. Confirme instalacao em %LOCALAPPDATA%\Programs\ (ou similar)."
Write-Host "  3. Extraia $PortableZipName e confirme pasta FoundryFrontierSync\ dentro."
Write-Host "  4. Abra o app e confirme que as atualizacoes do modpack sao carregadas do GitHub."
