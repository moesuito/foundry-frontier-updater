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
│   ├── src/           # HTML/CSS/JS da interface do jogador
│   └── src-tauri/     # comandos nativos Rust
└── foundry_frontier_sync.exe
```

## API Consumida

O executavel usa a URL base do dashboard principal configurada em
`client/src/main.js`:

```javascript
const SERVER_URL = 'https://desktop-2hplad1.polecat-atria.ts.net';
```

Rotas publicas usadas pelo app:

```text
GET /api/check-updates?version=1.0.0
GET /api/latest-version
GET /api/download/:filename
```

No dashboard principal, essas rotas sao reescritas para `/api/updater/*`.

## Build

Pre-requisitos:

- Node.js LTS
- Rust via rustup
- Visual Studio Build Tools com workload C++

Comandos:

```powershell
npm --prefix client install
npm --prefix client run tauri build
Copy-Item -LiteralPath "client\src-tauri\target\release\Foundry & Frontier Sync.exe" -Destination .\foundry_frontier_sync.exe -Force
```

O arquivo `foundry_frontier_sync.exe` na raiz e o build distribuivel atual para
os jogadores.

## Limpeza Local

Estas pastas sao geradas e podem ser removidas sem perder codigo:

```text
client/node_modules/
client/src-tauri/target/
```
