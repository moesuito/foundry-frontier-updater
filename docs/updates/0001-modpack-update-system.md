# Update 0001: Modpack Update System (Client CLI Rust + Server Node.js)

Este update implementa a solução de atualizações externas para o modpack Foundry & Frontier. O desenvolvimento foi isolado no diretório `_update/app/`.

## Objetivo
Criar um mecanismo leve, resiliente e funcional de atualizações incrementais (por diffs) para que os players não precisem baixar o modpack inteiro novamente ao receber patches. O sistema detecta automaticamente a instalação do player (Prism Launcher ou PolyMC), resolve o bootstrap inicial de versões antigas sem `version.json`, e atualiza o modpack sequencialmente aplicando exclusões e extrações de diffs ZIP.

## Estrutura do Sistema
O sistema foi desenvolvido sob `_update/app/` e contém:
1. **Cliente CLI em Rust** (`client/`):
   - Compilado nativamente como `foundry_frontier_sync.exe` (alocado na raiz do app).
   - Faz escaneamento automático do Prism e PolyMC em `%APPDATA%`.
   - Implementa a detecção por mods-chave de versões v1.0.0 iniciais (escreve o `version.json` caso não exista).
   - Downloads sequenciais de patches HTTP utilizando reqwest + indicatif (barra de progresso).
   - Descompactação nativa e deleção de arquivos obsoletos em disco.
   - Fallback de inputs para terminais não-TTY interativos (ambientes de testes/IDE).
2. **Servidor de Updates em Node.js** (`server/`):
   - APIs REST para download de pacotes ZIP e consulta de versões (`/api/check-updates`).
   - Gerenciador de updates leve salvando dados em `updates.json` (banco de dados JSON em substituição a drivers nativos de SQLite para blindar o build de quebras devido ao e comercial `&` no caminho da pasta da instância).
   - Dashboard administrativo web premium em HTML/CSS/JS (com tema metálico industrial e laranja/cobre) para upload de patches, changelogs e registro de exclusões.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [NEW] (Executável final compilado)
* `_update/app/README.md` [NEW] (Instruções detalhadas de compilação, envio e deploy)
* `_update/app/client/Cargo.toml` [NEW]
* `_update/app/client/src/main.rs` [NEW]
* `_update/app/client/build/icon.png` [NEW] (Ícone do executável gerado por inteligência artificial)
* `_update/app/server/package.json` [NEW]
* `_update/app/server/server.js` [NEW]
* `_update/app/server/database.js` [NEW]
* `_update/app/server/public/index.html` [NEW]
* `_update/app/server/public/style.css` [NEW]
* `_update/app/server/public/admin.js` [NEW]

## Estado de Validação
* Criamos uma instância de testes mockada em `%APPDATA%\PrismLauncher\instances\Foundry_Frontier_Test\.minecraft\` contendo os mods chaves sem o arquivo `version.json`.
* Rodamos o script de seed no servidor para registrar os patches de teste `1.0.0 -> 1.0.1` e `1.0.1 -> 1.0.2` (com instruções de exclusão e extração).
* Executamos o cliente em Rust interativamente. Ele detectou a instância mockada, criou o `version.json` v1.0.0 (bootstrap), buscou os patches no servidor local, realizou o download de ambos os diffs e descompactou.
* Verificamos programaticamente que no final:
  - Os arquivos mock antigos e obsoletos foram deletados.
  - Os arquivos novos trazidos pelo ZIP foram extraídos corretamente.
  - O `version.json` foi atualizado para `1.0.2`.
  - As configurações do jogo foram substituídas adequadamente.
* O binário final compilado em release possui cerca de ~2.3MB de tamanho.

## Cuidados para Agentes Futuros
* **Restrição de Nome no Windows**: Se o executável do atualizador for compilado com a palavra `updater` ou `setup` no nome do arquivo (ex: `foundry_frontier_updater.exe`), o Windows forçará o UAC e exigirá privilégios de Administrador para executá-lo (erro 740). O projeto no `Cargo.toml` foi nomeado como `foundry_frontier_sync` para contornar essa restrição e rodar como usuário comum.
* **Banco de Dados Portátil**: Evite adicionar dependências nativas (como `sqlite3` compilado em C++) na pasta `server/`. O uso do `updates.json` é intencional para manter o servidor portátil e compatível com máquinas Windows que possuem caminhos de diretório com caracteres especiais (como o `&` na pasta `Foundry & Frontier`).
