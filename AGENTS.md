# AGENTS.md - Foundry & Frontier Updater Client

## Contexto

Este repositorio contem somente o cliente desktop Tauri do atualizador
incremental do modpack **Foundry & Frontier**. O backend de patches, uploads,
metadados e painel administrativo foi integrado no dashboard principal do
servidor Minecraft.

Repositorio do dashboard principal:

```text
https://github.com/moesuito/modpack-dashboard
```

## Escopo Atual

Arquivos que pertencem a este repo:

```text
.
├── client/                    # Codigo-fonte do app Tauri
│   ├── src/                   # UI HTML/CSS/JS do jogador
│   └── src-tauri/             # Backend Rust nativo
├── scripts/
│   └── package-release.ps1    # Empacotamento local de release
├── foundry_frontier_sync.exe  # Copia conveniente do ultimo build
├── README.md
└── AGENTS.md
```

Nao pertence mais a este repo:

- servidor Express legado;
- dashboard admin HTML/CSS/JS legado;
- `updates.json` e uploads de patches;
- porta `10000`.

Essas responsabilidades vivem no dashboard principal:

- `GET /api/updater/latest-version`
- `GET /api/updater/check-updates?version=...`
- `GET /api/updater/download/:filename`
- `GET|POST /api/admin/updater/updates`
- `DELETE /api/admin/updater/updates/:id`

O dashboard tambem expoe rewrites compativeis para o executavel:

- `/api/latest-version`
- `/api/check-updates`
- `/api/download/:filename`

## Regras

1. Nao recriar servidor Express neste repo.
2. Nao commitar `client/node_modules/` nem `client/src-tauri/target/`.
3. Se alterar `client/src/` ou `client/src-tauri/`, recompilar e atualizar
   `foundry_frontier_sync.exe` quando possivel.
4. Nao escrever em `Z:\` nem tocar na producao do servidor Minecraft a partir
   deste repo.
5. O jogador sempre escolhe o launcher manualmente ao abrir o app.
6. **Atualizacoes de modpack nunca sao aplicadas silenciosamente.** O jogador
   precisa clicar explicitamente para baixar e aplicar patches dentro da
   instancia Minecraft. Nenhuma logica de auto-apply deve ser adicionada sem
   aprovacao explicita do Orchestrator.
7. **Atualizacoes do proprio aplicativo (self-update) podem ser obrigatorias**
   em uma fase futura (U1.3/U1.4), usando GitHub Releases e um helper externo
   (`updater-helper.exe`). Quando implementado, o app bloqueara a tela de
   modpack enquanto a atualizacao obrigatoria do proprio app for aplicada.
   Nao confundir self-update do app com patches do modpack: sao fluxos
   completamente separados.

## Build

```powershell
# Instala dependencias
npm --prefix client install

# Compila app + gera instalador NSIS (currentUser, sem admin/UAC)
npm --prefix client run tauri build -- --bundles nsis

# Empacota artefatos de release (setup, portable zip, version.json, SHA256SUMS)
powershell -ExecutionPolicy Bypass -File scripts/package-release.ps1

# Copia de conveniencia do executavel para a raiz do repo
Copy-Item -LiteralPath "client\src-tauri\target\release\Foundry & Frontier Sync.exe" -Destination .\foundry_frontier_sync.exe -Force
```

O executavel deve apontar para a URL base do dashboard principal, sem porta
legada `10000`. O `installMode` NSIS esta configurado como `currentUser`:
nao requer elevacao de UAC e instala em `%LOCALAPPDATA%\Programs\`.
