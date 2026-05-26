# Update 0005: Normalização de Versões no Servidor & Correção do Botão "Conectando..."

Este update corrige um bug crítico de compatibilidade de comparação de strings de versão e um bug visual de travamento de texto de botão na interface.

## Objetivo
1. **Normalização de Versões com Prefixo "v"**:
   - **Problema**: O cliente lê as versões em disco e as envia sem o caractere "v" (ex: `"1.0.0"`). Caso o administrador cadastre as versões no Dashboard administrativo como `"v1.0.0"` e `"v2.0.0"`, o backend de atualizações comparava `"1.0.0"` com `"v1.0.0"`, determinando erroneamente que as versões eram diferentes e falhando em achar uma transição de patches (retornava modpack atualizado).
   - **Solução**: Modificadas as rotas do Express no servidor (`server.js` e `database.js`) para normalizar strings de versão removendo o caractere `"v"` ou `"V"` inicial (`.replace(/^v/i, '')`) nas funções `getLatestVersion`, `getUpdateChain` e na resposta JSON mapeada. O cliente Tauri agora lê a versão mais recente e os changelogs corretamente, mesmo que cadastrados com "v".
2. **Correção do Bug Visual "Conectando..."**:
   - **Problema**: Quando o usuário clicava em "Verificar Atualizações" e o app localizava que o modpack já estava atualizado (Caso 2B), ou após concluir a busca, se ele clicasse no botão "Concluir" para voltar, o app retornava para a tela de setup, mas o botão de busca ficava travado exibindo o texto `"Conectando..."` (da busca anterior).
   - **Solução**: Ajustada a função `showSetupPane()` no arquivo `client/src/main.js` para restaurar o texto padrão de `btnCheckUpdates` para `"Verificar Atualizações"`.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Executável final recompilado e copiado)
* `_update/app/server/database.js` [MODIFY] (Ajustada normalização nas buscas de cadeia e última versão)
* `_update/app/server/server.js` [MODIFY] (Adicionada limpeza de "v" no JSON mapeado retornado ao cliente)
* `_update/app/client/src/main.js` [MODIFY] (Ajustada restauração do texto do botão na navegação de volta)

## Estado de Validação
* A compilação release Tauri funcionou sem erros.
* O executável final foi gerado e copiado para a pasta de distribuição `_update/app/foundry_frontier_sync.exe`.
* O servidor Express local recarrega automaticamente com as novas lógicas de comparação.
