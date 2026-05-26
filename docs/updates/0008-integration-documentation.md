# Update 0008: Criação da Documentação Técnica de Integração

Este update cria a documentação de arquitetura de APIs e comandos Rust na pasta `docs/` do atualizador para guiar a integração do frontend de atualizações no dashboard principal do usuário.

## Objetivo
* **Documentar a Integração**: Como o atualizador Tauri não será executado como uma janela standalone mas sim acoplado como uma nova funcionalidade diretamente no dashboard atual do jogador, foi desenvolvida uma documentação detalhada para orientar a exportação do código JS (controles, logs, listeners) e do backend Rust (comandos Tauri de arquivos e rede) para a base de código do dashboard do usuário.

## Arquivos Criados / Modificados
* `_update/app/docs/architecture_and_api.md` [NEW] (Especificação das rotas REST, payloads JSON do servidor, assinaturas de comandos Rust e escuta do canal de eventos `download-progress`)

## Estado de Validação
* O arquivo de documentação markdown foi criado no diretório correspondente e estruturado de forma legível.
