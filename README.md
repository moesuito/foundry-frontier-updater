# Foundry & Frontier Sync

Cliente desktop Tauri para sincronizar instalacoes locais do modpack
**Foundry & Frontier**. O app detecta instancias PolyMC/Prism Launcher,
consulta o dashboard principal, baixa patches incrementais e aplica os arquivos
na pasta `.minecraft` do jogador.

O backend e o painel admin do atualizador nao ficam mais neste repositorio.
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
├── scripts/
│   └── package-release.ps1  # empacotamento local de release
└── foundry_frontier_sync.exe  # copia conveniente do ultimo build
```

## API Consumida

O executavel usa a URL base do dashboard principal configurada em
`client/src/main.js`:

```javascript
const SERVER_URL = 'https://server-alano.polecat-atria.ts.net';
```

Rotas publicas usadas pelo app:

```text
GET /api/check-updates?version=1.0.0
GET /api/latest-version
GET /api/download/:filename
```

No dashboard principal, essas rotas sao reescritas para `/api/updater/*`.

## Pre-requisitos de Build

- Node.js LTS
- Rust via rustup
- Visual Studio Build Tools com workload **C++**
- NSIS 3.x instalado no PATH (o Tauri v1 usa o binario `makensis`)

## Build do Instalador NSIS

```powershell
# 1. Instala dependencias JS
npm --prefix updaterapp/client install

# 2. Compila app + gera instalador NSIS (modo currentUser, sem admin/UAC)
npm --prefix updaterapp/client run tauri build -- --bundles nsis
```

O instalador gerado fica em:

```text
updaterapp/client/src-tauri/target/release/bundle/nsis/
```

O `installMode` esta configurado como `currentUser`, portanto:

- **Nao requer elevacao de UAC/admin.**
- Instala em `%LOCALAPPDATA%\Programs\Foundry Frontier Sync` (ou caminho
  equivalente escolhido pelo NSIS no modo currentUser).

## Empacotamento de Release Local

Apos o build, rode:

```powershell
powershell -ExecutionPolicy Bypass -File updaterapp/scripts/package-release.ps1
```

O script cria `updaterapp/release/<versao>/` contendo:

| Arquivo                              | Descricao                                   |
|--------------------------------------|---------------------------------------------|
| `foundry_frontier_sync_setup.exe`    | Instalador NSIS (currentUser, sem UAC)      |
| `foundry_frontier_sync_portable.zip` | Zip com pasta `FoundryFrontierSync\` dentro |
| `version.json`                       | Metadados da versao                         |
| `SHA256SUMS.txt`                     | Hashes SHA-256 dos tres artefatos           |

### Estrutura do Portable Zip

```text
foundry_frontier_sync_portable.zip
└── FoundryFrontierSync\
    ├── Foundry & Frontier Sync.exe
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

## Validacao Manual Apos Empacotar

1. Execute `foundry_frontier_sync_setup.exe` e confirme que **nao aparece UAC**.
2. Confirme que o app foi instalado em `%LOCALAPPDATA%\Programs\` (ou similar).
3. Extraia `foundry_frontier_sync_portable.zip` e confirme a pasta
   `FoundryFrontierSync\` dentro.
4. Abra o app e confirme que ele conecta em:
   `https://server-alano.polecat-atria.ts.net`
5. Confirme que nenhum arquivo foi escrito em `Z:\` ou em pasta `server\`.

## Copia de Conveniencia

Para atualizar o executavel na raiz do repo apos um build:

```powershell
Copy-Item -LiteralPath "updaterapp\client\src-tauri\target\release\Foundry & Frontier Sync.exe" `
          -Destination .\updaterapp\foundry_frontier_sync.exe -Force
```

## Limpeza Local

Estas pastas sao geradas e podem ser removidas sem perder codigo:

```text
updaterapp/client/node_modules/
updaterapp/client/src-tauri/target/
updaterapp/release/
```
