# Update 0002: Migração do Atualizador de Modpack para Tauri UI (Fluent Design)

Este update migra a interface do atualizador de modpacks Foundry & Frontier de uma CLI em Rust simples para uma interface gráfica de desktop (UI) desenvolvida em Tauri.

## Objetivo
Atender à requisição do usuário de possuir um aplicativo gráfico em estilo Windows (Fluent Design) que seja minimalista e ofereça total transparência e controle sobre o processo de atualização. O cliente não deve atualizar de forma automática e silenciosa; ele sempre busca as instâncias instaladas (Prism Launcher ou PolyMC) e, caso detecte um update disponível no servidor, exibe um alerta explicativo de que a atualização é obrigatória para acessar o servidor. O usuário dispara o update clicando em um botão, o progresso é exibido em tempo real através de eventos de download e, ao final, uma validação em disco revalida a consistência da versão.

## Estrutura do Sistema de UI
O cliente gráfico foi estruturado no diretório `_update/app/client/`:
1. **Frontend (HTML/CSS/JS)**:
   - Layout acrílico translúcido com glassmorphism, cantos arredondados, fontes modernas (Outfit), e barra de títulos arrastável do Windows 11.
   - Detecção visual e carregamento dinâmico das instâncias localizadas.
   - Banner de alerta em estilo Windows Alert (Warning Orange) informando a necessidade do update e comparador de versão (`vInstalada -> vServidor`).
   - Barra de progresso nativa conectada a um canal de eventos assíncronos que escuta o download do arquivo ZIP de diff pelo Rust.
   - Tela de sucesso de validação que exibe a integridade do disco e a versão instalada.
2. **Backend Rust (Tauri Commands)**:
   - `detect_instances`: Varre as pastas e faz bootstrap da versão `1.0.0` caso encontre os mods chave de F&F sem o arquivo `version.json`.
   - `select_folder_manually`: Permite buscar e carregar uma pasta de modpack de fora do diretório padrão através de um seletor de arquivos nativo do Windows.
   - `check_updates`: Conecta-se às APIs do servidor e verifica patches pendentes.
   - `apply_update`: Efetua o download do ZIP emitindo progresso à UI em tempo real, executa a remoção de arquivos obsoletos indicados pelo servidor e descompacta os novos arquivos na pasta `.minecraft`.
   - `validate_installation`: Revalida em disco se o `version.json` final foi atualizado para a versão alvo e retorna o estado de integridade.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Substituído pelo binário final com suporte a interface gráfica, ~8.3MB)
* `_update/app/README.md` [MODIFY] (Instruções atualizadas para descrever o Tauri GUI e como compilá-lo)
* `_update/app/client/package.json` [NEW] (Configurações de CLI do Tauri e scripts)
* `_update/app/client/src/index.html` [NEW] (Estrutura da UI acrílica)
* `_update/app/client/src/styles.css` [NEW] (Estilos Fluent Design do Windows 11)
* `_update/app/client/src/main.js` [NEW] (Integração com commands Tauri e progresso)
* `_update/app/client/src-tauri/Cargo.toml` [NEW] (Dependências Rust do Tauri)
* `_update/app/client/src-tauri/src/main.rs` [NEW] (Backend Rust de comandos Tauri)
* `_update/app/client/src-tauri/tauri.conf.json` [NEW] (Configurações de janela, transparência e sem bordas nativas)

## Estado de Validação
* O executável final foi gerado via `npm run tauri build` em modo release, incorporando toda a interface web e binário Rust compilado em um único executável independente (`foundry_frontier_sync.exe`).
* O fluxo completo foi testado de ponta a ponta:
  1. O app detecta e exibe a versão instalada e o launcher ativo.
  2. Ao consultar o servidor de testes Express, exibe o banner de "Atualização Obrigatória" e a lista de changelogs.
  3. Clicando em "Baixar e Atualizar Agora", os updates são aplicados sequencialmente com feedback visual.
  4. Ao término, a validação de integridade lê o disco e aprova com sucesso a nova versão.

## Cuidados para Agentes Futuros
* **Nomes Reservados do Windows**: Mantenha o nome do arquivo compilado como `foundry_frontier_sync.exe` (evitando termos como `updater` ou `setup`), pois o Windows impõe restrição de privilégio administrativo a nomes que sugerem instaladores/atualizadores.
* **Transparência de Janela**: Como a janela Tauri está configurada com `"transparent": true` e `"decorations": false`, todos os efeitos visuais de borda e arrasto da Title Bar são gerenciados no frontend (`data-tauri-drag-region`). Cuidado ao mexer nos arquivos CSS/HTML para não quebrar a área de arrasto.
