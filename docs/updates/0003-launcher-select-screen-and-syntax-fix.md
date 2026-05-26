# Update 0003: Tela de Seleção de Launcher & Correção de Inicialização no Atualizador Tauri

Este update implementa a tela inicial de seleção de launcher para o atualizador do modpack Foundry & Frontier e corrige um erro de sintaxe Javascript que impedia o boot da aplicação.

## Objetivo
1. **Correção de Inicialização**: O arquivo `client/src/main.js` continha uma declaração inválida de função assíncrona (`async fn` em vez de `async function`). Isso fazia com que o script Javascript falhasse silenciosamente ao carregar, deixando a UI travada em "Buscando instâncias...". Corrigido para `async function`.
2. **Separação de Launcher**: O usuário necessitava que o aplicativo não buscasse instâncias de desenvolvimento do Prism Launcher ao verificar atualizações de players comuns (que usam PolyMC). Criamos uma Tela 0 (`paneLauncherSelect`) no boot do app que pergunta qual launcher o usuário deseja focar (PolyMC ou Prism Launcher).
3. **Escaneamento Segmentado**: A escolha do usuário é enviada para o backend Rust via comando `detect_instances(launcher_filter)`, que restringe a busca e o bootstrap apenas à pasta de instâncias correspondente.
4. **Navegação**: Adicionado botão "Trocar Launcher" no setup para permitir que o usuário retorne à tela inicial de escolha a qualquer momento.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Executável final recompilado em modo release)
* `_update/app/client/src/index.html` [MODIFY] (Inclusão da Tela 0 `paneLauncherSelect` e botões SVG customizados)
* `_update/app/client/src/styles.css` [MODIFY] (Estilos e efeitos hover acrílicos para PolyMC/Prism e botão voltar)
* `_update/app/client/src/main.js` [MODIFY] (Correção do erro de sintaxe e controle de transições e argumentos de launcher)
* `_update/app/client/src-tauri/src/main.rs` [MODIFY] (Adição do argumento de filtro e ajuste no comando `detect_instances`)
* `_update/app/client/src-tauri/tauri.conf.json` [MODIFY] (Desativação de bundle WiX `active: false` para evitar falha do compilador com caractere `&` no caminho)

## Estado de Validação
* A compilação release foi realizada sem erros (pulando o empacotamento WiX que falhava devido ao caractere `&` no diretório).
* O executável final foi copiado para a pasta de distribuição `_update/app/foundry_frontier_sync.exe`.
* O fluxo visual foi totalmente ajustado conforme o estilo de vidro Fluent do Windows 11.
