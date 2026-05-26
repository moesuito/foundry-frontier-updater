# Documentação Técnica: Arquitetura & APIs de Integração do Atualizador

Esta documentação descreve o funcionamento do sistema de atualizações do modpack **Foundry & Frontier** (portas, rotas, payloads, comandos em Rust e eventos assíncronos), servindo de guia para integrar a interface e as lógicas de sincronização diretamente no frontend do seu **dashboard de Minecraft atual**.

---

## 1. Visão Geral da Arquitetura

O atualizador funciona baseado em uma arquitetura híbrida de três camadas:
1. **Servidor de Updates (Node.js/Express)**: Hospedado na porta `10000` (exposto publicamente via Tailscale Funnel sob o endereço `https://desktop-2hplad1.polecat-atria.ts.net:10000`). Ele gerencia a cadeia de patches diffs em um banco de dados leve (`updates.json`) e serve os arquivos ZIP.
2. **Backend Nativo (Rust / Tauri)**: Executa no computador do jogador. É responsável por acessar arquivos de sistema, detectar as pastas das instâncias (PolyMC/Prism), apagar arquivos `.jar` obsoletos e descompactar os ZIPs de atualizações na pasta `.minecraft`.
3. **Frontend (HTML/JS/CSS no seu Dashboard)**: A interface do usuário que exibe os status, changelogs e a barra de progresso. Ela se comunica com o backend em Rust através da ponte de comandos nativos do Tauri (`window.__TAURI__.tauri.invoke`) e escuta eventos de download disparados assincronamente pelo Rust (`window.__TAURI__.event.listen`).

---

## 2. Especificação da API REST (Servidor de Updates - Porta 10000)

O servidor Express disponibiliza os seguintes endpoints para checagem e controle de patches. Todas as comparações de versão são **normalizadas** no servidor (ignoram o caractere `"v"` ou `"V"` inicial).

### A. Checar Atualizações Pendentes
Retorna a cadeia sequencial de patches necessários para levar a versão atual do cliente até a versão terminal (mais nova) do servidor.

* **Rota**: `GET /api/check-updates`
* **Parâmetro de Consulta**: `version` (Versão atual do modpack instalada no PC do player, ex: `1.0.0`)
* **URL de Exemplo**: `https://desktop-2hplad1.polecat-atria.ts.net:10000/api/check-updates?version=1.0.0`
* **Payload de Resposta (JSON)**:
  - **Caso haja atualizações pendentes**:
    ```json
    {
      "updateAvailable": true,
      "currentVersion": "1.0.0",
      "latestVersion": "2.0.0",
      "updates": [
        {
          "id": "1779757694919",
          "fromVersion": "1.0.0",
          "toVersion": "2.0.0",
          "downloadUrl": "https://desktop-2hplad1.polecat-atria.ts.net:10000/api/download/zip_file-1779757694872-42659006.zip",
          "description": "Essa atualização adiciona ferramentas e mods industriais, organizando a progressão.",
          "removedFiles": ["mods/OldMod-1.0.jar", "config/obsolete-config.toml"]
        }
      ]
    }
    ```
  - **Caso o modpack já esteja na versão mais recente**:
    ```json
    {
      "updateAvailable": false,
      "currentVersion": "2.0.0",
      "latestVersion": "2.0.0",
      "updates": []
    }
    ```

### B. Download de Patch ZIP
Rota de download para o arquivo zip incremental.
* **Rota**: `GET /api/download/:filename`
* **URL de Exemplo**: `https://desktop-2hplad1.polecat-atria.ts.net:10000/api/download/zip_file-1779757694872-42659006.zip`
* **Retorno**: Stream binário do arquivo ZIP compactado contendo as diffs.

### C. Obter Última Versão Cadastrada
* **Rota**: `GET /api/latest-version`
* **Payload de Resposta**:
  ```json
  { "version": "2.0.0" }
  ```

---

## 3. Comandos Rust do Tauri (Backend Nativo)

Para integrar a lógica no seu próprio dashboard rodando sob o ecossistema Tauri, você utilizará a biblioteca Javascript do Tauri para chamar estas rotas do sistema operacional.

Importação recomendada:
```javascript
const { invoke } = window.__TAURI__.tauri;
const { listen } = window.__TAURI__.event;
```

### A. `detect_instances`
Varre os diretórios do launcher especificado no `%APPDATA%` do Windows, localiza instâncias do modpack e retorna metadados das pastas. Se uma instância compatível não possuir o arquivo `version.json` mas tiver os mods chave, aplica o bootstrap inicial criando o `version.json` na versão `1.0.0`.
* **Chamada JS**:
  ```javascript
  const instances = await invoke('detect_instances', { launcherFilter: "PolyMC" });
  ```
  *(Opções válidas de filtro: `"PolyMC"`, `"Prism Launcher"`)*
* **Retorno (Array de Objetos)**:
  ```json
  [
    {
      "launcher": "PolyMC",
      "instanceName": "Foundry & Frontier",
      "instancePath": "C:\\Users\\...\\PolyMC\\instances\\Foundry & Frontier",
      "minecraftPath": "C:\\Users\\...\\PolyMC\\instances\\Foundry & Frontier\\.minecraft",
      "version": "1.0.0"
    }
  ]
  ```

### B. `select_folder_manually`
Abre um diálogo nativo do Windows para o usuário selecionar manualmente uma pasta raiz de modpack (caso a detecção automática falhe).
* **Chamada JS**:
  ```javascript
  const instance = await invoke('select_folder_manually');
  ```
* **Retorno**: Um objeto `InstanceInfo` idêntico ao acima, ou `null` se cancelado.

### C. `apply_update`
Efetua o download do arquivo ZIP temporário, remove os arquivos obsoletos cadastrados, extrai os novos arquivos no diretório `.minecraft` do jogador e limpa os arquivos temporários.
* **Chamada JS (CRÍTICO: Passar as chaves em camelCase)**:
  ```javascript
  await invoke('apply_update', {
    downloadUrl: update.downloadUrl,      // URL completa do patch ZIP
    toVersion: update.toVersion,          // Versão destino (ex: "2.0.0")
    removedFiles: update.removedFiles,    // Array de caminhos a remover relativos a .minecraft/
    minecraftPath: selectedInstance.minecraftPath  // Caminho absoluto .minecraft
  });
  ```
* **Retorno**: Promessa resolvida com sucesso (`Result::Ok`) ou rejeitada com string de erro (`Result::Err`).

### D. `validate_installation`
Faz uma checagem rápida em disco lendo o `.minecraft/version.json` para certificar que o arquivo foi atualizado para a versão alvo após a extração dos patches.
* **Chamada JS**:
  ```javascript
  const isValid = await invoke('validate_installation', {
    minecraftPath: selectedInstance.minecraftPath,
    targetVersion: "2.0.0"
  });
  ```
* **Retorno**: `true` se a versão condiz com a versão esperada, ou gera um erro caso contrário.

### E. `open_folder`
Abre a pasta raiz do modpack no Explorador de Arquivos do Windows.
* **Chamada JS**:
  ```javascript
  await invoke('open_folder', { path: selectedInstance.instancePath });
  ```

---

## 4. Fluxo de Eventos e Progresso de Download

Durante a execução do comando `apply_update`, o backend Rust faz o download em blocos e calcula a porcentagem progredida. Ele emite um evento global do Tauri com o progresso para que o frontend exiba a barra preenchida em tempo real.

Para escutar esse evento no seu Javascript do Dashboard:
```javascript
// Registra o ouvinte antes de disparar o loop de updates
const unlistenProgress = await listen('download-progress', (event) => {
  const percent = event.payload; // Inteiro de 0 a 100
  
  // Atualiza a barra de progresso do seu dashboard
  progressBarFill.style.width = `${percent}%`;
  progressPercentText.textContent = `${percent}%`;
});

// ... Dispara o loop de apply_update aqui ...

// Remova o listener após concluir todos os patches para evitar vazamentos de memória
unlistenProgress();
```

---

## 5. Como Acoplar no seu Dashboard Atual

1. **Copiar Arquivos Rust**: Adicione os comandos Rust declarados em `_update/app/client/src-tauri/src/main.rs` para o arquivo principal de comandos do Rust do seu Dashboard atual.
2. **Registrar Comandos**: Certifique-se de registrar as funções na lista de manipuladores no `main()` do seu dashboard:
   ```rust
   tauri::Builder::default()
       .invoke_handler(tauri::generate_handler![
           detect_instances,
           select_folder_manually,
           check_updates,
           apply_update,
           validate_installation,
           open_folder
       ])
   ```
3. **Frontend**: Copie a estrutura HTML de telas (`paneLauncherSelect`, `paneSetup`, `paneStatus`, `paneProgress` e `paneSuccess`) e os estilos Fluent correspondentes do `styles.css` para a página onde a funcionalidade de sincronização residirá no seu Dashboard.
4. **Acoplar o Javascript**: Use o arquivo `_update/app/client/src/main.js` como referência de controle de fluxo de estados da UI para gerenciar a cadeia de updates em seu Dashboard.
