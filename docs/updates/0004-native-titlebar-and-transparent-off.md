# Update 0004: Barra de Títulos Nativa & Janela Opaca no Atualizador Tauri

Este update implementa a restauração das decorações padrão de janela (titlebar nativa do Windows), desativa a transparência acrílica e corrige um bug estrutural de falta de importação de script que quebrava a lógica de cliques na UI.

## Objetivo
1. **Restauração de Decorações**: O usuário solicitou a desativação da titlebar customizada em HTML e a reativação da decoração padrão de janela do Windows (com os botões de fechar, restaurar e minimizar nativos do sistema).
2. **Remoção de Transparência**: Removido o efeito de transparência acrílica translúcida da janela principal, aplicando um fundo escuro sólido e fosco (#1a1d24) que combina com a paleta industrial do modpack.
3. **Resolução do Bug de Cliques**: Identificamos que a tag `<script src="main.js" defer></script>` estava ausente no `index.html`. Isso fazia com que o Javascript do atualizador nunca fosse carregado e executado pelo WebView, deixando todos os botões de seleção de launcher e cliques totalmente inativos (o app parecia travado na Tela 0). Corrigido adicionando a importação do script na `<head>`.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Executável final compilado em release)
* `_update/app/client/src-tauri/tauri.conf.json` [MODIFY] (Ajustado `decorations: true` e `transparent: false` sob a configuração de `windows`)
* `_update/app/client/src/index.html` [MODIFY] (Adicionada a tag de script main.js na head e removido o header windows-titlebar customizado)
* `_update/app/client/src/styles.css` [MODIFY] (Ajustes de opacidade e cor sólida #1a1d24 no body/backdrop, display: none na classe windows-titlebar e redimensionamento do app-viewport para 100% de altura)
* `_update/app/client/src/main.js` [MODIFY] (Protegida a função `setupTitleBar` contra elementos de botões customizados nulos)

## Estado de Validação
* A compilação foi finalizada com sucesso gerando o executável final em `_update/app/foundry_frontier_sync.exe`.
* O servidor Express foi reiniciado com sucesso na porta 3000 em background (`node server.js`) para suportar os testes locais.
