// Importação das APIs do Tauri
const { invoke } = window.__TAURI__.tauri;
const { appWindow } = window.__TAURI__.window;
const { listen } = window.__TAURI__.event;

// --- Elementos do DOM: Self-Update ---
const paneSelfUpdate    = document.getElementById('paneSelfUpdate');
const selfUpdateTitle   = document.getElementById('selfUpdateTitle');
const selfUpdateSubtitle = document.getElementById('selfUpdateSubtitle');
const selfUpdateSpinner = document.getElementById('selfUpdateSpinner');
const selfUpdateProgressWrap = document.getElementById('selfUpdateProgressWrap');
const selfUpdateProgressFill = document.getElementById('selfUpdateProgressFill');
const selfUpdateProgressLabel = document.getElementById('selfUpdateProgressLabel');
const selfUpdateProgressPct = document.getElementById('selfUpdateProgressPct');
const selfUpdateWarnBox = document.getElementById('selfUpdateWarnBox');
const selfUpdateWarnText = document.getElementById('selfUpdateWarnText');

// Elementos do DOM — restante dos paineis
const btnWinMinimize = document.getElementById('btnWinMinimize');
const btnWinClose = document.getElementById('btnWinClose');

// Painel Setup
const paneSetup = document.getElementById('paneSetup');
const instancesStatus = document.getElementById('instancesStatus');
const instancesEmpty = document.getElementById('instancesEmpty');
const instancesList = document.getElementById('instancesList');
const btnManualSelect = document.getElementById('btnManualSelect');
const btnCheckUpdates = document.getElementById('btnCheckUpdates');

// Painel Launcher Select
const paneLauncherSelect = document.getElementById('paneLauncherSelect');
const btnSelectPolyMC = document.getElementById('btnSelectPolyMC');
const btnSelectPrism = document.getElementById('btnSelectPrism');
const selectedLauncherNameText = document.getElementById('selectedLauncherNameText');
const btnBackToLauncherSelect = document.getElementById('btnBackToLauncherSelect');

// Painel Status
const paneStatus = document.getElementById('paneStatus');
const statusLauncherTag = document.getElementById('statusLauncherTag');
const statusInstanceName = document.getElementById('statusInstanceName');
const btnChangeInstance = document.getElementById('btnChangeInstance');
const statusUpdateAvailable = document.getElementById('statusUpdateAvailable');
const currentVerText = document.getElementById('currentVerText');
const serverVerText = document.getElementById('serverVerText');
const changelogList = document.getElementById('changelogList');
const btnApplyUpdate = document.getElementById('btnApplyUpdate');

// Painel Up to Date (Caso 2B)
const statusUpToDate = document.getElementById('statusUpToDate');
const activeVerBadgeText = document.getElementById('activeVerBadgeText');
const btnOpenGameFolder = document.getElementById('btnOpenGameFolder');
const btnFinishUpToDate = document.getElementById('btnFinishUpToDate');

// Painel Progresso
const paneProgress = document.getElementById('paneProgress');
const progressTitle = document.getElementById('progressTitle');
const progressSubTitle = document.getElementById('progressSubTitle');
const progressBarFill = document.getElementById('progressBarFill');
const progressStepText = document.getElementById('progressStepText');
const progressPercentText = document.getElementById('progressPercentText');
const progressLogs = document.getElementById('progressLogs');

// Painel Sucesso
const paneSuccess = document.getElementById('paneSuccess');
const validatedVersionText = document.getElementById('validatedVersionText');
const btnFinishSuccess = document.getElementById('btnFinishSuccess');

// Toast Notificação
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Estado local
let detectedInstances = [];
let selectedInstance = null;
let pendingUpdates = [];
let latestVersion = '1.0.0';
let selectedLauncher = null;
// Timeout para fallback de conectividade na verificação do app
const SELF_UPDATE_FAIL_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// U1.4 — Mandatory App Self-Update Flow
// ---------------------------------------------------------------------------

/**
 * Hides paneSelfUpdate and shows the launcher selection pane.
 * Called when no update is needed or after a network failure timeout.
 */
function selfUpdateContinue() {
  paneSelfUpdate.classList.remove('active');
  paneLauncherSelect.classList.add('active');
}

/**
 * Main self-update check. Called immediately on startup.
 * Blocks the UI until the check resolves; on failure it fails open after
 * SELF_UPDATE_FAIL_TIMEOUT_MS and shows a warning.
 */
async function runSelfUpdateCheck() {
  // Start listening for download progress events from Rust
  const unlistenProgress = await listen('app-update-progress', (event) => {
    const pct = event.payload;
    selfUpdateProgressFill.style.width = `${pct}%`;
    selfUpdateProgressPct.textContent = `${pct}%`;
  });

  let checkResult = null;

  try {
    // Race the API call against the fail-open timeout
    checkResult = await Promise.race([
      invoke('check_app_update'),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), SELF_UPDATE_FAIL_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    // Network unreachable or timeout — fail open with a warning
    unlistenProgress();
    selfUpdateSpinner.style.display = 'none';
    selfUpdateTitle.textContent = 'Verificação Ignorada';
    selfUpdateSubtitle.textContent = 'Não foi possível verificar atualizações do aplicativo.';
    selfUpdateWarnText.textContent =
      err && err.message === 'timeout'
        ? 'GitHub inacessível. Continuando sem verificar atualização…'
        : `Falha na conexão: ${err}. Continuando…`;
    selfUpdateWarnBox.classList.remove('hidden');
    console.warn('[self-update] check failed:', err);
    // Continue after a brief pause to let the user read the message
    await sleep(2500);
    selfUpdateContinue();
    return;
  }

  if (!checkResult.updateAvailable) {
    // No update — show success briefly then continue
    unlistenProgress();
    selfUpdateSpinner.style.display = 'none';
    selfUpdateTitle.textContent = 'Aplicativo Atualizado';
    selfUpdateSubtitle.textContent = checkResult.message;
    await sleep(800);
    selfUpdateContinue();
    return;
  }

  // Update available — must update before continuing
  if (!checkResult.downloadUrl) {
    unlistenProgress();
    selfUpdateSpinner.style.display = 'none';
    selfUpdateTitle.textContent = 'Atualização Disponível';
    selfUpdateSubtitle.textContent = checkResult.message;
    selfUpdateWarnText.textContent =
      'Asset de download não encontrado na release. Continuando sem atualizar…';
    selfUpdateWarnBox.classList.remove('hidden');
    await sleep(3000);
    selfUpdateContinue();
    return;
  }

  // Show download progress UI
  selfUpdateTitle.textContent = `Atualizando para ${checkResult.latestTag}…`;
  selfUpdateSubtitle.textContent = 'Baixando nova versão do aplicativo…';
  selfUpdateProgressWrap.classList.remove('hidden');

  let zipPath;
  try {
    zipPath = await invoke('download_app_update', {
      downloadUrl: checkResult.downloadUrl,
    });
  } catch (err) {
    unlistenProgress();
    selfUpdateSpinner.style.display = 'none';
    selfUpdateTitle.textContent = 'Falha no Download';
    selfUpdateSubtitle.textContent = 'Não foi possível baixar a atualização.';
    selfUpdateWarnText.textContent = `${err}. Continuando sem atualizar…`;
    selfUpdateWarnBox.classList.remove('hidden');
    await sleep(3000);
    selfUpdateContinue();
    return;
  }

  unlistenProgress();

  // Determine install dir and current exe path for the helper
  selfUpdateTitle.textContent = 'Aplicando Atualização…';
  selfUpdateSubtitle.textContent = 'O aplicativo será reiniciado automaticamente.';

  try {
    // Rust knows current exe; we pass the same path for relaunch.
    // install_dir = directory of the current exe.
    // These are passed through Rust, so we fetch them via a dedicated invoke
    // or we pass empty strings and let Rust figure it out from current_exe().
    await invoke('launch_sync_runner', {
      zipPath,
      installDir: '',   // Rust fills in from current_exe().parent()
      appExe: '',       // Rust fills in from current_exe()
    });
    // App exits inside Rust — we won't reach this line.
  } catch (err) {
    selfUpdateSpinner.style.display = 'none';
    selfUpdateTitle.textContent = 'Falha ao Iniciar Helper';
    selfUpdateSubtitle.textContent = 'Não foi possível iniciar o processo de atualização.';
    selfUpdateWarnText.textContent = `${err}. Continuando…`;
    selfUpdateWarnBox.classList.remove('hidden');
    await sleep(3000);
    selfUpdateContinue();
  }
}

// ---------------------------------------------------------------------------
// Inicialização
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  setupTitleBar();
  // Verificação obrigatória de atualização do app — bloqueia até resolver
  runSelfUpdateCheck();

  // Eventos de clique para seleção de launcher
  btnSelectPolyMC.addEventListener('click', () => selectLauncher('PolyMC'));
  btnSelectPrism.addEventListener('click', () => selectLauncher('Prism Launcher'));
  btnBackToLauncherSelect.addEventListener('click', showLauncherSelectPane);

  btnCheckUpdates.addEventListener('click', checkUpdates);
  btnManualSelect.addEventListener('click', selectFolderManually);
  btnChangeInstance.addEventListener('click', showSetupPane);
  btnApplyUpdate.addEventListener('click', startUpdateProcess);
  btnOpenGameFolder.addEventListener('click', openGameFolder);
  btnFinishUpToDate.addEventListener('click', showSetupPane);
  btnFinishSuccess.addEventListener('click', showSetupPane);
});


// Exibir Toast de Erro
function showToast(message) {
  toastMessage.textContent = message;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// Configura Barra de Título do Windows
function setupTitleBar() {
  if (btnWinMinimize) btnWinMinimize.addEventListener('click', () => appWindow.minimize());
  if (btnWinClose) btnWinClose.addEventListener('click', () => appWindow.close());
}

// Mostrar Painel Setup (Voltar)
function showSetupPane() {
  paneStatus.classList.remove('active');
  paneSuccess.classList.remove('active');
  paneProgress.classList.remove('active');
  
  // Restaura texto original do botão de busca
  btnCheckUpdates.querySelector('span').textContent = 'Verificar Atualizações';
  
  if (selectedLauncher) {
    paneSetup.classList.add('active');
    scanInstances(selectedLauncher); // Escaneia de novo para atualizar
  } else {
    paneLauncherSelect.classList.add('active');
  }
}

// Funções de transição de launcher
function selectLauncher(launcher) {
  selectedLauncher = launcher;
  selectedLauncherNameText.textContent = launcher;
  paneLauncherSelect.classList.remove('active');
  paneSetup.classList.add('active');
  scanInstances(launcher);
}

function showLauncherSelectPane() {
  paneSetup.classList.remove('active');
  paneStatus.classList.remove('active');
  paneSuccess.classList.remove('active');
  paneProgress.classList.remove('active');
  paneLauncherSelect.classList.add('active');
  selectedLauncher = null;
}

// Escanear instâncias locais
async function scanInstances(launcher) {
  instancesStatus.classList.remove('hidden');
  instancesList.classList.add('hidden');
  instancesEmpty.classList.add('hidden');
  btnCheckUpdates.disabled = true;

  try {
    detectedInstances = await invoke('detect_instances', { launcherFilter: launcher || "" });
    
    if (detectedInstances && detectedInstances.length > 0) {
      renderInstances();
      instancesStatus.classList.add('hidden');
      instancesList.classList.remove('hidden');
      
      // Auto-seleciona a primeira encontrada
      selectInstance(detectedInstances[0]);
    } else {
      instancesStatus.classList.add('hidden');
      instancesEmpty.classList.remove('hidden');
    }
  } catch (err) {
    console.error(err);
    instancesStatus.classList.add('hidden');
    instancesEmpty.classList.remove('hidden');
  }
}

// Renderizar lista de instâncias
function renderInstances() {
  instancesList.innerHTML = '';
  detectedInstances.forEach((inst, index) => {
    const card = document.createElement('div');
    card.className = `instance-card ${selectedInstance && selectedInstance.instancePath === inst.instancePath ? 'selected' : ''}`;
    
    card.innerHTML = `
      <div>
        <span class="inst-title">${escapeHtml(inst.instanceName)}</span>
        <span class="inst-sub">${escapeHtml(inst.launcher)}</span>
      </div>
      <span class="inst-ver">v${escapeHtml(inst.version)}</span>
    `;

    card.addEventListener('click', () => {
      selectInstance(inst);
      document.querySelectorAll('.instance-card').forEach((c, idx) => {
        c.classList.toggle('selected', idx === index);
      });
    });

    instancesList.appendChild(card);
  });
}

// Selecionar instância
function selectInstance(instance) {
  selectedInstance = instance;
  btnCheckUpdates.disabled = false;
}

// Seleção manual de pasta
async function selectFolderManually() {
  try {
    const inst = await invoke('select_folder_manually');
    if (inst) {
      detectedInstances.push(inst);
      renderInstances();
      instancesEmpty.classList.add('hidden');
      instancesList.classList.remove('hidden');
      selectInstance(inst);
      
      // Atualiza visualmente o card recém adicionado
      setTimeout(() => {
        const cards = document.querySelectorAll('.instance-card');
        cards.forEach(c => c.classList.remove('selected'));
        if (cards.length > 0) {
          cards[cards.length - 1].classList.add('selected');
        }
      }, 50);

      showToast('Modpack selecionado com sucesso!');
    }
  } catch (err) {
    showToast(err.toString());
  }
}

// Verificar se há atualizações no Servidor
async function checkUpdates() {
  if (!selectedInstance) {
    showToast('Por favor, selecione uma instância.');
    return;
  }

  btnCheckUpdates.disabled = true;
  btnCheckUpdates.querySelector('span').textContent = 'Conectando...';

  try {
    const data = await invoke('check_updates', {
      currentVersion: selectedInstance.version
    });

    // Mudar para o painel de status
    paneSetup.classList.remove('active');
    paneStatus.classList.add('active');

    // Preencher cabeçalho da instância
    statusLauncherTag.textContent = selectedInstance.launcher;
    statusInstanceName.textContent = selectedInstance.instanceName;

    if (data.updateAvailable) {
      pendingUpdates = data.updates;
      latestVersion = data.latestVersion;
      currentVerText.textContent = selectedInstance.version;
      serverVerText.textContent = data.latestVersion;

      // Renderizar changelogs
      changelogList.innerHTML = '';
      data.updates.forEach(u => {
        const item = document.createElement('div');
        item.style.marginBottom = '0.4rem';
        item.innerHTML = `
          <div class="changelog-ver">Versão ${escapeHtml(u.toVersion)}</div>
          <div class="changelog-text">${escapeHtml(u.description).replace(/\n/g, '<br>')}</div>
        `;
        changelogList.appendChild(item);
      });

      statusUpdateAvailable.classList.remove('hidden');
      statusUpToDate.classList.add('hidden');
    } else {
      pendingUpdates = [];
      activeVerBadgeText.textContent = selectedInstance.version;
      statusUpdateAvailable.classList.add('hidden');
      statusUpToDate.classList.remove('hidden');
    }
  } catch (err) {
    showToast('Não foi possível conectar ao servidor de atualizações.');
    btnCheckUpdates.disabled = false;
    btnCheckUpdates.querySelector('span').textContent = 'Verificar Atualizações';
  }
}

// Iniciar Processo de Atualização (Trigger do Usuário)
async function startUpdateProcess() {
  if (pendingUpdates.length === 0 || !selectedInstance) return;

  // Ir para a tela de progresso
  paneStatus.classList.remove('active');
  paneProgress.classList.add('active');

  progressBarFill.style.width = '0%';
  progressPercentText.textContent = '0%';
  progressLogs.innerHTML = '';

  logToUI('Iniciando atualizações sequenciais...', 'blue');
  logToUI(`Total de patches na fila: ${pendingUpdates.length}`, 'blue');

  let success = true;

  // Registrar ouvinte do progresso de download emitido pelo Rust
  const unlistenProgress = await listen('download-progress', (event) => {
    const percent = event.payload;
    progressBarFill.style.width = `${percent}%`;
    progressPercentText.textContent = `${percent}%`;
  });

  for (let i = 0; i < pendingUpdates.length; i++) {
    const update = pendingUpdates[i];
    progressStepText.textContent = `Patch ${i + 1} de ${pendingUpdates.length}`;
    progressSubTitle.textContent = `Aplicando Patch para v${update.toVersion}...`;
    
    logToUI(`[Patch ${i + 1}/${pendingUpdates.length}] Baixando v${update.toVersion}...`);
    
    try {
      // Chama o comando Rust
      await invoke('apply_update', {
        downloadUrl: update.downloadUrl,
        toVersion: update.toVersion,
        removedFiles: update.removedFiles,
        minecraftPath: selectedInstance.minecraftPath
      });

      logToUI(`[Patch ${i + 1}/${pendingUpdates.length}] v${update.toVersion} instalado com sucesso!`, 'green');
      selectedInstance.version = update.toVersion; // Atualiza a versão local
    } catch (err) {
      logToUI(`[Erro] Falha ao instalar v${update.toVersion}: ${err}`, 'red');
      success = false;
      break;
    }
  }

  // Remove listener do progresso do Tauri
  unlistenProgress();

  if (success) {
    // Inicia etapa de validação rápida solicitada pelo usuário
    progressSubTitle.textContent = 'Realizando validação de integridade...';
    logToUI('Iniciando validação rápida de arquivos em disco...', 'blue');
    
    progressBarFill.style.width = '100%';
    progressPercentText.textContent = '100%';

    await sleep(1000); // Pequena pausa para efeito de UI de validação

    try {
      const isValid = await invoke('validate_installation', {
        minecraftPath: selectedInstance.minecraftPath,
        targetVersion: latestVersion
      });

      if (isValid) {
        logToUI('Validação concluída: version.json correto e integridade do modpack OK!', 'green');
        validatedVersionText.textContent = latestVersion;
        
        await sleep(1500);
        
        // Vai para a tela de Sucesso
        paneProgress.classList.remove('active');
        paneSuccess.classList.add('active');
      } else {
        logToUI('[Erro] A validação falhou. A versão em disco não corresponde ao esperado.', 'red');
        showToast('Falha na validação rápida da versão.');
      }
    } catch (err) {
      logToUI(`[Erro] Erro de validação: ${err}`, 'red');
      showToast('Erro ao validar arquivos instalados.');
    }
  } else {
    progressTitle.textContent = 'Falha ao Atualizar';
    progressSubTitle.textContent = 'Ocorreu um problema ao aplicar as atualizações.';
    
    // Adiciona botão para voltar ao setup
    const btnRetry = document.createElement('button');
    btnRetry.className = 'btn btn-primary';
    btnRetry.style.marginTop = '0.8rem';
    btnRetry.textContent = 'Voltar';
    btnRetry.addEventListener('click', showSetupPane);
    progressLogs.appendChild(btnRetry);
  }
}

// Abrir pasta da instância
async function openGameFolder() {
  if (!selectedInstance) return;
  try {
    await invoke('open_folder', { path: selectedInstance.instancePath });
  } catch (err) {
    showToast('Erro ao abrir pasta.');
  }
}

// Logs de progresso
function logToUI(message, styleClass = '') {
  const line = document.createElement('div');
  line.className = `log-line ${styleClass}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  progressLogs.appendChild(line);
  progressLogs.scrollTop = progressLogs.scrollHeight;
}

// Helper para delay simples
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Helper para escapar HTML contra XSS
function escapeHtml(text) {
  if (!text) return '';
  return text
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
