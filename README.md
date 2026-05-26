# Foundry & Frontier - Modpack Update System

Este repositório contém a solução completa para o gerenciamento e distribuição de atualizações incrementais do modpack **Foundry & Frontier**.

A solução é composta por:
1. **Server (Express + SQLite em arquivo JSON)**: O servidor que hospeda a API de checagem, serve os pacotes ZIP e disponibiliza um Dashboard Administrativo para cadastro de novos patches.
2. **Client (Tauri GUI - Windows Fluent Style)**: Um aplicativo leve de interface gráfica sem bordas nativas, com visual translúcido acrílico e cantos arredondados, que localiza o modpack nos launchers do player, alerta sobre atualizações obrigatórias disponíveis e aplica os patches com uma barra de progresso em tempo real e validação de disco.

---

## Estrutura do Projeto

```
_update/app/
├── foundry_frontier_sync.exe # Executável final do cliente para Windows (Pronto, ~8.3MB)
├── client/                   # Código fonte do cliente Tauri (Frontend HTML/CSS/JS + Backend Rust)
│   ├── src/                  # Interface do Usuário (HTML, CSS Fluent Design e JavaScript)
│   ├── src-tauri/            # Lógica nativa em Rust do Tauri
│   │   ├── src/main.rs       # Comandos Tauri (escaneamento, download HTTP e extração de zip)
│   │   └── tauri.conf.json   # Configurações de tamanho (550x400), transparência e bordas
│   └── package.json
└── server/                   # Código fonte do servidor de atualizações (Node.js)
    ├── uploads/              # Armazena os pacotes ZIP das atualizações (.zip)
    ├── public/               # Dashboard administrativo (HTML/CSS/JS)
    ├── database.js           # Banco de dados updates.json
    ├── server.js             # API REST e endpoints
    └── package.json
```

---

## Como Funciona o Sistema de Updates

### 1. Detecção & Bootstrap Inicial (Instâncias Antigas)
Para compatibilidade com os jogadores que já possuem o modpack instalado mas não possuem o arquivo `.minecraft/version.json` na instância:
* O atualizador Tauri varre as pastas de instâncias do **Prism Launcher** e do **PolyMC** em `%APPDATA%`.
* Ele analisa se a pasta do modpack contém os mods-chave originais da v1.0.0:
  * `mek_x_star-1.20.1-1.3.5.jar`
  * `tfmg-1.0.2f.jar`
  * `Northstar-0.5.4+1.20.1.jar`
  * `create-1.20.1-6.0.8.jar`
* Se esses mods forem encontrados na pasta `mods`, o atualizador cria o arquivo `.minecraft/version.json` inicial e define a versão em `1.0.0`.
* A partir desse ponto, o jogador entra no ciclo normal de atualizações incrementais.

### 2. Atualizações Incrementais por Diffs
* Quando o administrador lança um update (ex: de `1.0.1` para `1.0.2`), ele gera um ZIP contendo **somente** os arquivos novos ou modificados daquela transição.
* Se um player estiver na versão `1.0.0` e a mais recente for a `1.0.3`, o atualizador consulta o servidor, descobre a cadeia (`1.0.0 -> 1.0.1`, `1.0.1 -> 1.0.2` e `1.0.2 -> 1.0.3`) e aplica um update de cada vez de forma sequencial.
* O atualizador também apaga arquivos obsoletos descritos pelo administrador (ex: versões antigas de arquivos `.jar` de mods) antes de extrair cada ZIP de atualização.

---

## Guia do Servidor (Node.js)

### Instalação das Dependências
Na pasta `server/`, execute:
```bash
npm install
```

### Executando em Desenvolvimento
Para iniciar o servidor localmente:
```bash
npm run dev
```
O servidor rodará na porta `3000` por padrão.

* **API de checagem**: `http://localhost:3000/api/check-updates?version=1.0.0`
* **Painel Administrativo (Dashboard)**: `http://localhost:3000`

### Como Criar e Enviar um Novo Update
1. Crie uma pasta temporária e monte a estrutura de arquivos a serem adicionados/modificados (caminhos relativos à pasta `.minecraft/` do jogo, ex: `mods/NewMod.jar` e `config/config.toml`).
2. Adicione ou substitua o arquivo `version.json` contendo a nova versão correspondente.
3. Compacte o conteúdo dessa pasta temporária como um arquivo `.zip` (os arquivos como `version.json` e a pasta `mods/` devem ficar na raiz do ZIP).
4. Acesse o Dashboard em `http://localhost:3000`.
5. Preencha os campos:
   * **Versão de Origem**: A versão que o player precisa ter para aplicar esse diff (ex: `1.0.0`).
   * **Versão de Destino**: A versão resultante após aplicar o ZIP (ex: `1.0.1`).
   * **Arquivo ZIP (Diff)**: Selecione o arquivo ZIP gerado.
   * **Descrição / Changelog**: Descreva as alterações da versão.
   * **Arquivos para Remover**: Se o update remove mods ou configs obsoletas, escreva o caminho relativo à `.minecraft/` de cada um (um caminho por linha, ex: `mods/OldMod-1.0.jar`).
6. Clique em **Publicar Atualização**. O servidor armazenará o ZIP e registrará a atualização no arquivo `updates.json`.

---

## Guia do Cliente (Tauri GUI)

O cliente compilado final é o executável `foundry_frontier_sync.exe`. Ele pode ser copiado e distribuído diretamente para os players. Ele pode salvar a URL do servidor configurada pelo usuário no armazenamento local persistente do WebView.

### Compilação Manual (Opcional)
Se precisar alterar o código frontend ou o backend em Rust e recompilar o instalador, acesse a pasta `client/` e execute:
1. Instale as dependências Node.js:
   ```bash
   npm install
   ```
2. Compile o app em modo de distribuição (Release):
   ```bash
   npm run tauri build
   ```
O novo binário compilado e otimizado será gerado sob a pasta `client/src-tauri/target/release/foundry_frontier_sync.exe`. copia-se este binário para a pasta raiz `_update/app/` para distribuição final.
