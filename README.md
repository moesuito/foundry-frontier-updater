# Foundry & Frontier Sync

Cliente desktop Tauri para sincronizar instalações locais do modpack
**Foundry & Frontier**. O app detecta instâncias PolyMC/Prism Launcher,
consulta o dashboard principal, baixa patches incrementais e aplica os arquivos
na pasta `.minecraft` do jogador.

O backend e o painel admin do atualizador não ficam mais neste repositório.
Eles foram integrados ao dashboard principal em:

```text
https://github.com/moesuito/modpack-dashboard
```

## Estrutura

```text
.
├── client/
│   ├── src/               # HTML/CSS/JS da interface do jogador
│   └── src-tauri/         # comandos nativos Rust
│       └── src/
│           ├── main.rs            # app principal Tauri
│           └── bin/
│               └── updater-helper.rs  # helper de auto-update (U1.2)
├── scripts/
│   ├── package-release.ps1          # empacotamento local de release
│   └── test-updater-helper.ps1      # testes do helper (U1.2/U1.4)
├── .github/
│   └── workflows/
│       └── build-release.yml        # GitHub Actions CI (U1.5)
└── foundry_frontier_sync.exe  # cópia conveniente do último build
```

## API Consumida

O executável consome a API de Releases do GitHub diretamente:

- Para atualizações do próprio aplicativo:
  ```text
  GET https://api.github.com/repos/moesuito/foundry-frontier-updater/releases/latest
  ```

- Para atualizações incrementais do modpack (patches):
  ```text
  GET https://api.github.com/repos/moesuito/foundry-frontier-modpack/releases
  ```

Os patches são identificados por arquivos de asset do tipo `update-vX.Y.Z.zip` ou `update-tag.zip`. Arquivos obsoletos a serem removidos são listados na descrição (body) da release em seções como `### Removed Files` ou `### Arquivos Removidos`.

## Fluxo de Auto-Atualização (U1.3/U1.4)

Ao iniciar, o app **bloqueia** a seleção de launcher e verifica:

```text
https://api.github.com/repos/moesuito/foundry-frontier-updater/releases/latest
```

- Se não há atualização → continua normalmente (< 1s de atraso).
- Se há atualização → baixa `foundry_frontier_sync_portable.zip`, lança
  `updater-helper.exe` e fecha o app principal.
- Se GitHub estiver inacessível → aviso de 2,5s e continua (fail open).
- Não há botão de pular atualizações do app.

O `updater-helper.exe` espera o processo principal fechar, extrai o zip na
pasta de instalação, verifica o novo executável e `version.json`, e relança
o app. Logs ficam em `%LOCALAPPDATA%\FoundryFrontierSync\logs\updater-helper.log`.

## Pré-requisitos de Build

- Node.js LTS
- Rust via rustup
- Visual Studio Build Tools com workload **C++**
- NSIS 3.x instalado no PATH (o Tauri v1 usa o binário `makensis`)

## Build do Instalador NSIS

```powershell
# 1. Instala dependências JS
npm --prefix updaterapp/client install

# 2. Compila app + gera instalador NSIS (modo currentUser, sem admin/UAC)
npm --prefix updaterapp/client run tauri build -- --bundles nsis
```

O instalador gerado fica em:

```text
updaterapp/client/src-tauri/target/release/bundle/nsis/
```

O `installMode` está configurado como `currentUser`, portanto:

- **Não requer elevação de UAC/admin.**
- Instala em `%LOCALAPPDATA%\Programs\Foundry Frontier Sync` (ou caminho
  equivalente escolhido pelo NSIS no modo currentUser).

## Build do Updater Helper (U1.2)

```powershell
# Dentro de updaterapp/client/src-tauri (ou via npm script)
cargo build --release --bin updater-helper
```

O binário ficará em:

```text
updaterapp/client/src-tauri/target/release/updater-helper.exe
```

### Uso Manual do Helper

```text
updater-helper.exe
  --pid       <PID do processo principal>
  --install-dir <caminho absoluto da pasta de instalação>
  --zip       <caminho absoluto do zip portable baixado>
  --exe       <caminho do executável a relançar>
  [--log      <caminho para o arquivo de log>]
```

**Restrições de segurança embutidas no helper:**
- Rejeita qualquer `install-dir` em `Z:\`.
- Rejeita qualquer caminho com componente chamado `server`.
- Bloqueia zip-slip/path traversal em qualquer entrada do zip.
- Não requer privilégios de administrador.

## Testes do Helper (U1.2)

```powershell
powershell -ExecutionPolicy Bypass -File updaterapp/scripts/test-updater-helper.ps1
```

O script testa (usando apenas pastas temporárias):

1. Rejeição de `Z:\` como diretório de instalação.
2. Rejeição de caminho com componente `server`.
3. Extração correta de zip portable válido.
4. Bloqueio de zip-slip/path traversal.

## Empacotamento de Release Local

Após o build (NSIS + helper), rode:

```powershell
powershell -ExecutionPolicy Bypass -File updaterapp/scripts/package-release.ps1
```

O script cria `updaterapp/release/<versao>/` contendo:

| Arquivo                              | Descrição                                   |
|--------------------------------------|---------------------------------------------|
| `foundry_frontier_sync_setup.exe`    | Instalador NSIS (currentUser, sem UAC)      |
| `foundry_frontier_sync_portable.zip` | Zip com pasta `FoundryFrontierSync\` dentro |
| `version.json`                       | Metadados da versão                         |
| `SHA256SUMS.txt`                     | Hashes SHA-256 dos artefatos                |

### Estrutura do Portable Zip

```text
foundry_frontier_sync_portable.zip
└── FoundryFrontierSync\
    ├── Foundry & Frontier Sync.exe
    ├── updater-helper.exe
    └── version.json
```

### version.json

```json
{
  "appId": "foundry-frontier-sync",
  "version": "1.0.0",
  "releaseTag": "v1.0.0",
  "repo": "moesuito/foundry-frontier-updater"
}
```

## GitHub Actions CI (U1.5)

O workflow `.github/workflows/build-release.yml` é disparado manualmente
(`workflow_dispatch`) ou ao criar uma tag `v*.*.*`. Ele:

1. Compila o app + NSIS + helper.
2. Empacota os artefatos de release.
3. Roda os testes do helper.
4. Faz upload dos artefatos como Actions Artifacts (sem publicar release).

**Publicação de release é responsabilidade do Orchestrator.** Após revisar
os artefatos, use:

```powershell
gh release create v<VERSION> `
  updaterapp/release/<VERSION>/foundry_frontier_sync_setup.exe `
  updaterapp/release/<VERSION>/foundry_frontier_sync_portable.zip `
  updaterapp/release/<VERSION>/version.json `
  updaterapp/release/<VERSION>/SHA256SUMS.txt `
  --title "Foundry & Frontier Sync v<VERSION>" `
  --notes "Changelog aqui."
```

## Validação Manual Após Empacotar

1. Execute `foundry_frontier_sync_setup.exe` e confirme que **não aparece UAC**.
2. Confirme que o app foi instalado em `%LOCALAPPDATA%\Programs\` (ou similar).
3. Extraia `foundry_frontier_sync_portable.zip` e confirme:
   - `FoundryFrontierSync\Foundry & Frontier Sync.exe`
   - `FoundryFrontierSync\updater-helper.exe`
   - `FoundryFrontierSync\version.json`
4. Abra o app e confirme que ele busca atualizações do modpack do GitHub Releases.
5. Confirme tela de verificação de update ao iniciar (U1.4).
6. Confirme que nenhum arquivo foi escrito em `Z:\` ou em pasta `server\`.

## Cópia de Conveniência

Para atualizar o executável na raiz do repo após um build:

```powershell
Copy-Item -LiteralPath "updaterapp\client\src-tauri\target\release\Foundry & Frontier Sync.exe" `
          -Destination .\updaterapp\foundry_frontier_sync.exe -Force
```

## Limpeza Local

Estas pastas são geradas e podem ser removidas sem perder código:

```text
updaterapp/client/node_modules/
updaterapp/client/src-tauri/target/
updaterapp/release/
```
