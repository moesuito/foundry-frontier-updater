# Update 0006: Correção de Propriedades no Invoke (apply_update)

Este update corrige a passagem de parâmetros no invoke da função `apply_update` do cliente Tauri de snake_case para camelCase.

## Objetivo
* **O Bug**: Ao tentar aplicar a atualização da v2.0.0, a interface exibia um erro alegando que a chave obrigatória `downloadUrl` estava ausente. Isso acontecia porque a desserialização de patches da resposta JSON e Rust retorna objetos com as propriedades em camelCase no JS (`downloadUrl`, `toVersion`, `removedFiles`), mas no invoke do atualizador o JS tentava acessar as chaves usando snake_case (`update.download_url`, `update.to_version`, `update.removed_files`), o que retornava `undefined` e causava a rejeição do invoke pelo Tauri.
* **A Solução**: Ajustado o arquivo `client/src/main.js` para acessar as chaves do objeto `update` usando camelCase (`update.downloadUrl`, `update.toVersion`, `update.removedFiles`), normalizando a chamada de invoke do Rust.

## Arquivos Criados / Modificados
* `_update/app/foundry_frontier_sync.exe` [MODIFY] (Executável final recompilado em release e substituído)
* `_update/app/client/src/main.js` [MODIFY] (Correção do mapeamento de propriedades no trigger do update)

## Estado de Validação
* A compilação release do Tauri funcionou com sucesso.
* O executável final foi gerado e copiado para a pasta de distribuição `_update/app/foundry_frontier_sync.exe`.
