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

Repositorio do modpack (onde ficam as releases dos patches):

```text
https://github.com/moesuito/foundry-frontier-modpack
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

Essas responsabilidades agora vivem no GitHub Releases:

- Consulta de atualizações do modpack (patches):
  `GET https://api.github.com/repos/moesuito/foundry-frontier-modpack/releases`
- Download do arquivo incremental: `update-vX.Y.Z.zip` obtido como asset da release correspondente.
- Arquivos a serem removidos durante a atualização: descritos no corpo da release sob seções como `### Removed Files` ou `### Arquivos Removidos`.

O dashboard principal do Minecraft/Express não gerencia mais o download nem metadados dos patches incrementais do modpack.

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
8. **Sistema de Versionamento do Aplicativo (V.X.Y.Z)**:
   - Toda vez que for realizar uma alteração ou adicionar novos recursos, o agente **DEVE** verificar quais versões já existem localmente (na pasta `release/`) e no GitHub Releases (`https://api.github.com/repos/moesuito/foundry-frontier-updater/releases`).
   - **NUNCA** trabalhar ou gerar pacotes em cima de uma versão que já foi lançada. Sempre abra uma nova versão apropriada incrementando o número.
   - O esquema de incremento de versão segue a seguinte regra:
     - `X` (Major): Grandes atualizações do sistema (ex: repaginar o aplicativo inteiro).
     - `Y` (Minor/Medium): Médias atualizações (ex: implementação de novos recursos ou funcionalidades).
     - `Z` (Patch): Pequenas atualizações (ex: correção de bugs ou alterações simples).
   - Ao incrementar a versão, certifique-se de atualizar o campo `"version"` em `client/src-tauri/tauri.conf.json` e o campo `version` em `client/src-tauri/Cargo.toml` antes de rodar o build.

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

O executavel agora aponta diretamente para as APIs do GitHub (tanto para auto-update do app quanto para os patches do modpack), nao dependendo de servidores privados ou dashboards Minecraft para estas tarefas. O `installMode` NSIS esta configurado como `currentUser`:
nao requer elevacao de UAC e instala em `%LOCALAPPDATA%\Programs\`.
