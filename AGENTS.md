# AGENTS.md — Foundry & Frontier Updater App

## Contexto

Este diretório (`_update/app/`) contém o **sistema de atualizações incrementais** do modpack Minecraft **Foundry & Frontier**. O projeto é composto por dois módulos independentes que se comunicam via API REST: um **servidor Express** e um **cliente desktop Tauri**.

> **Este projeto é separado do modpack em si.** O `AGENTS.md` na raiz da instância governa o modpack; este arquivo governa apenas o updater app.

---

## Stack Tecnológica

| Camada | Tecnologia | Versão | Notas |
|---|---|---|---|
| **Servidor** | Node.js + Express | Express `4.19.2` | Porta padrão: `10000` |
| **Banco de dados** | Arquivo JSON (`updates.json`) | — | Não é SQLite; é leitura/escrita síncrona em arquivo JSON plano |
| **Upload de ZIPs** | Multer | `1.4.5-lts.1` | Apenas `.zip` aceito |
| **Dashboard Admin** | HTML/CSS/JS puro | — | Servido como estático por Express em `server/public/` |
| **Cliente Desktop** | Tauri v1 | `1.x` | Backend em Rust, frontend em HTML/JS/CSS puro |
| **Backend Nativo** | Rust (edition 2021) | — | Dependências: `reqwest` (blocking), `zip 2.1`, `serde`, `directories`, `open` |
| **Frontend do Cliente** | HTML/CSS/JS (Vanilla) | — | Design system: Windows Fluent / Acrílico escuro |
| **Fonte tipográfica** | Google Fonts: Outfit | — | Carregada via CDN no `index.html` |

---

## Estrutura de Diretórios

```
_update/app/
├── AGENTS.md                      # ← Este arquivo
├── README.md                      # Documentação geral do projeto
├── foundry_frontier_sync.exe      # Executável compilado do cliente (distribuível, ~8.3MB)
│
├── client/                        # Código-fonte do cliente Tauri
│   ├── src/                       # Frontend (UI do jogador)
│   │   ├── index.html             # HTML com 5 telas/paineis (seções <section>)
│   │   ├── styles.css             # CSS completo (~865 linhas, Fluent Design tokens)
│   │   └── main.js                # Lógica JS: fluxo de telas, invocação Tauri, progresso
│   ├── src-tauri/                 # Backend nativo Rust
│   │   ├── src/main.rs            # Comandos Tauri (detect_instances, apply_update, etc.)
│   │   ├── Cargo.toml             # Dependências Rust
│   │   ├── tauri.conf.json        # Configuração de janela (550×400, sem resize)
│   │   └── build.rs               # Build script padrão do Tauri
│   └── package.json               # Dev dependencies do frontend
│
├── server/                        # Código-fonte do servidor de updates
│   ├── server.js                  # Express: API REST + servir dashboard admin
│   ├── database.js                # CRUD do updates.json + lógica de cadeia de versões
│   ├── seed.js                    # Script de seed para testes (limpa DB e popula com dados mock)
│   ├── updates.json               # Banco de dados de patches cadastrados (NÃO commitar dados de produção)
│   ├── uploads/                   # Armazena fisicamente os arquivos ZIP de cada patch
│   ├── public/                    # Dashboard administrativo (HTML/CSS/JS estático)
│   │   ├── index.html
│   │   ├── style.css
│   │   └── admin.js
│   └── package.json
│
└── docs/                          # Documentação técnica de integração
    └── architecture_and_api.md    # Especificação completa: endpoints, comandos Rust, eventos
```

---

## Servidor de Updates

### Porta e Endereço

- **Porta de operação**: `10000` (configurável via `process.env.PORT`).
- **Endereço de produção**: `https://desktop-2hplad1.polecat-atria.ts.net:10000` (exposto via Tailscale Funnel).
- Em desenvolvimento local: `http://localhost:10000`.

### API REST — Endpoints Públicos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/latest-version` | Retorna `{ "version": "X.Y.Z" }` |
| `GET` | `/api/check-updates?version=X.Y.Z` | Retorna cadeia sequencial de patches pendentes |
| `GET` | `/api/download/:filename` | Stream binário do ZIP de patch (proteção contra path traversal) |

### API REST — Endpoints Administrativos

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/api/admin/updates` | Lista todas as atualizações cadastradas |
| `POST` | `/api/admin/updates` | Cadastra novo patch (multipart: `zip_file` + campos `from_version`, `to_version`, `description`, `removed_files`) |
| `DELETE` | `/api/admin/updates/:id` | Exclui um patch e seu arquivo ZIP físico |

### Banco de Dados (`updates.json`)

Schema de cada entrada no array `updates`:
```json
{
  "id": "timestamp_string",
  "from_version": "1.0.0",
  "to_version": "2.0.0",
  "zip_filename": "zip_file-TIMESTAMP-RANDOM.zip",
  "description": "Changelog em texto livre",
  "removed_files": ["mods/ArquivoObsoleto.jar", "config/velha.toml"],
  "created_at": "ISO8601"
}
```

- Versões são **normalizadas** no servidor: o prefixo `v` ou `V` é ignorado nas comparações.
- A **cadeia de updates** é sequencial: `from_version` → `to_version` → próximo `from_version` e assim por diante.
- Duplicatas de transição (`from_version` + `to_version` iguais) são bloqueadas pelo `database.js`.
- A versão "mais recente" é a `to_version` terminal que não aparece como `from_version` de nenhum outro update.

### Dashboard Administrativo

Servido como arquivos estáticos em `server/public/`. Acessível na raiz do servidor (`http://localhost:10000`). Permite:
- Visualizar patches cadastrados.
- Cadastrar novo patch com upload de ZIP.
- Deletar patches existentes.

### Execução

```bash
cd server/
npm install
npm start          # Produção (porta 10000)
npm run dev        # Desenvolvimento com nodemon
```

---

## Cliente Desktop (Tauri)

### Arquitetura

O executável é um app Tauri v1: um WebView embutido renderiza o frontend HTML/CSS/JS, e o backend em Rust executa operações de sistema (acesso a arquivos, HTTP, extração de ZIP).

A comunicação entre JS ↔ Rust é feita via:
- **Comandos**: `window.__TAURI__.tauri.invoke('nome_do_comando', { args })` — chamadas síncronas (do ponto de vista do JS, são Promises).
- **Eventos**: `window.__TAURI__.event.listen('download-progress', callback)` — Rust emite progresso de download em tempo real.

### Comandos Rust Registrados

| Comando | Parâmetros | Retorno | Descrição |
|---|---|---|---|
| `detect_instances` | `launcherFilter: String` | `Vec<InstanceInfo>` | Varre `%APPDATA%\PolyMC\instances` ou `%APPDATA%\PrismLauncher\instances`. Faz bootstrap de `version.json` se mods-chave forem detectados. |
| `select_folder_manually` | — | `Option<InstanceInfo>` | Abre diálogo nativo para seleção manual de pasta |
| `check_updates` | `serverUrl: String, currentVersion: String` | `UpdateResponse` | Consulta o servidor via GET |
| `apply_update` | `downloadUrl, toVersion, removedFiles, minecraftPath` | `Result<(), String>` | Baixa ZIP, remove arquivos obsoletos, extrai no `.minecraft`, emite evento `download-progress` |
| `validate_installation` | `minecraftPath, targetVersion` | `Result<bool, String>` | Confere se `version.json` em disco bate com a versão esperada |
| `open_folder` | `path: String` | `Result<(), String>` | Abre pasta no Explorer do Windows |

### Fluxo de Telas do Frontend

O frontend possui **5 painéis** (`<section class="pane-view">`) controlados por classes CSS `active`/`hidden`:

1. **`paneLauncherSelect`** — Primeira tela: escolha entre PolyMC e Prism Launcher (cards visuais com ícones SVG). Aparece toda vez que o app abre; não persiste a escolha.
2. **`paneSetup`** — Após escolher launcher: exibe instâncias detectadas, auto-seleciona a primeira, permite busca manual e botão "Verificar Atualizações".
3. **`paneStatus`** — Dois sub-estados:
   - **`statusUpdateAvailable`**: Banner de alerta laranja, comparador de versão, changelog, botão "Baixar e Atualizar Agora".
   - **`statusUpToDate`**: Ícone de sucesso verde, badge de versão ativa.
4. **`paneProgress`** — Barra de progresso, logs em tempo real estilo terminal, steps sequenciais.
5. **`paneSuccess`** — Validação de integridade concluída com sucesso.

### URL do Servidor

Hardcoded no `main.js` como constante:
```javascript
const SERVER_URL = 'https://desktop-2hplad1.polecat-atria.ts.net:10000';
```
Se o endereço do servidor mudar, atualizar esta constante e recompilar o executável.

### Bootstrap de Instâncias Antigas

O Rust detecta instâncias do modpack que **não possuem** `version.json` verificando a presença de mods-chave v1.0.0:
- `mek_x_star-1.20.1-1.3.5.jar`
- `tfmg-1.0.2f.jar`
- `Northstar-0.5.4+1.20.1.jar`
- `create-1.20.1-6.0.8.jar`

Se ≥3 desses mods existirem na pasta `mods/`, um `version.json` é criado automaticamente com versão `1.0.0`.

### Compilação

```bash
cd client/
npm install
npm run tauri build
```

O binário Release é gerado em `client/src-tauri/target/release/foundry_frontier_sync.exe`. Copiar para a raiz de `_update/app/` para distribuição.

Pré-requisitos de build:
- Node.js (recomendado LTS)
- Rust toolchain (rustup com target `stable-x86_64-pc-windows-msvc`)
- Visual Studio Build Tools (C++ workload)
- Tauri CLI (`cargo install tauri-cli`)

### Janela do App

- **Tamanho fixo**: 550×400px, sem resize.
- **Decorações**: Nativas do Windows (`decorations: true`).
- **CSP**: Desabilitado (`null`) para permitir carregamento de fontes externas.
- **Identifier**: `com.foundryfrontier.sync`.

---

## Formato dos ZIPs de Atualização

Os ZIPs devem conter os arquivos com caminhos **relativos à pasta `.minecraft/`** do jogador. Exemplos de estrutura interna:

```
version.json               # Obrigatório: contém a nova versão
mods/NovoMod-1.2.jar
config/novo-config.toml
kubejs/server_scripts/novo-script.js
```

O `apply_update` do Rust extrai o ZIP diretamente na pasta `.minecraft`, sobrescrevendo arquivos existentes. Arquivos obsoletos devem ser listados no campo `removed_files` do patch no servidor.

---

## Regras Obrigatórias para Agentes

1. **Nunca alterar o endereço de produção Tailscale Funnel** sem instrução explícita do usuário. O endereço atual é `desktop-2hplad1.polecat-atria.ts.net`.
2. **Nunca alterar a porta `10000`** sem instrução explícita do usuário. A porta `3000` pertence ao dashboard do servidor Minecraft (projeto separado em `Z:\`).
3. **Nunca tocar em `Z:\`** — é o servidor de produção do dashboard do Minecraft. Este projeto opera exclusivamente em `_update/app/`.
4. **O frontend do cliente Tauri atual é provisório.** O plano é integrar a funcionalidade de updates no dashboard principal do usuário (outro projeto). A documentação em `docs/architecture_and_api.md` descreve como acoplar.
5. **Não persistir configuração do launcher** no app do jogador. Toda vez que o app abre, ele deve perguntar qual launcher usar (PolyMC ou Prism Launcher). Isso é por design.
6. **Atualizações nunca são automáticas.** O jogador sempre precisa clicar em "Baixar e Atualizar Agora" manualmente. Não implementar auto-update silencioso.
7. **Testes locais do servidor**: usar sempre a cópia local em `_update/app/server/`, nunca deployar para produção sem comando direto do usuário.
8. **O `seed.js` é apenas para testes.** Ele limpa o `updates.json` e a pasta `uploads/`. Nunca executá-lo em produção.
9. **O executável `foundry_frontier_sync.exe`** na raiz é o build de distribuição. Se modificar código do cliente, recompilar e atualizar esse binário.
10. **Notas de update do agente**: registrar em `_codex/updates/updater app/` (fora deste diretório), seguindo o padrão `NNNN-descricao.md` com numeração sequencial.

---

## Documentação Adicional

- **[README.md](README.md)** — Visão geral do projeto, guia de uso e compilação.
- **[docs/architecture_and_api.md](docs/architecture_and_api.md)** — Especificação técnica detalhada: endpoints, payloads JSON, comandos Rust, eventos assíncronos e guia de integração no dashboard.

---

## Fluxo Completo de um Update (ponta a ponta)

```
Administrador                         Servidor (porta 10000)                    Cliente Tauri (Jogador)
─────────────────────────────────────────────────────────────────────────────────────────────────────
1. Gera ZIP com diff de arquivos
2. Acessa dashboard admin ──────────► 3. Dashboard HTML servido em /
4. POST /api/admin/updates ────────► 5. Salva ZIP em uploads/,
   (zip + from/to/desc/removed)         registra em updates.json
                                                                               6. Jogador abre o app
                                                                               7. Seleciona PolyMC ou Prism
                                                                               8. App detecta instâncias (Rust)
                                                                               9. Clica "Verificar Atualizações"
                                     10. GET /api/check-updates?version=X  ◄── 11. invoke('check_updates')
                                     12. Retorna cadeia de patches ────────►  13. Exibe changelog + botão
                                                                               14. Clica "Baixar e Atualizar"
                                     15. GET /api/download/:filename  ◄─────  16. invoke('apply_update')
                                     17. Stream do ZIP ───────────────────►  18. Download + emit 'download-progress'
                                                                               19. Remove arquivos obsoletos
                                                                               20. Extrai ZIP em .minecraft/
                                                                               21. invoke('validate_installation')
                                                                               22. Tela de sucesso ✓
```
