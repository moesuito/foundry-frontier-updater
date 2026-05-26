# Update 0007: Migração para Domínio de Produção (Tailscale Funnel) & Porta 10000

Este update migra a infraestrutura do atualizador e do servidor de atualizações para rodar em ambiente de produção via Tailscale Funnel.

## Objetivo
1. **Embutir Endereço de Produção**: Para que os players não tenham que configurar manualmente o endereço de IP do servidor de atualizações, removemos o campo de entrada do servidor da interface (`index.html`) e embutimos a URL de produção diretamente na constante do cliente no JS: `https://desktop-2hplad1.polecat-atria.ts.net:10000`.
2. **Nova Porta Padrão do Servidor**: Mudamos a porta do servidor Express de `3000` para `10000` (única disponível no Tailscale Funnel do host) no arquivo `server.js`. O atualizador agora faz requisições HTTP REST normais direcionadas à porta `10000` do domínio público da Tailscale.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Executável final recompilado em release e substituído)
* `_update/app/server/server.js` [MODIFY] (Alterada porta padrão de escuta `PORT` para `10000`)
* `_update/app/client/src/index.html` [MODIFY] (Removido o input `serverUrl` e sua div de configuração de servidor)
* `_update/app/client/src/main.js` [MODIFY] (Removida a leitura e persistência local de `serverUrlInput` e adicionada a constante estática `SERVER_URL`)

## Estado de Validação
* A compilação foi finalizada com sucesso gerando o executável final em `_update/app/foundry_frontier_sync.exe`.
* O servidor Express foi reiniciado com sucesso na porta 10000 em background (`node server.js` sob a ID de tarefa `task-625`).
