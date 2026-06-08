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
const chkAutoStart = document.getElementById('chkAutoStart');

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

// Temporizador de verificação periódica do próprio app (6 horas)
const APP_SELF_UPDATE_INTERVAL = 6 * 60 * 60 * 1000;
let appSelfUpdateTimer = null;

// Temporizador de verificação periódica (30 minutos)
const PERIODIC_CHECK_INTERVAL = 30 * 60 * 1000;
let periodicCheckTimer = null;
let isUpdatingInBackground = false;

// ---------------------------------------------------------------------------
// U1.4 — Mandatory App Self-Update Flow
// ---------------------------------------------------------------------------

/**
 * Hides paneSelfUpdate and shows the launcher selection pane.
 * Called when no update is needed or after a network failure timeout.
 */
function selfUpdateContinue() {
  paneSelfUpdate.classList.remove('active');
  paneSetup.classList.add('active');
  scanInstances(false);
  startAppSelfUpdateTimer();
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

  // Inicialização do estado do auto-start
  initAutoStartState();

  // Sincroniza checkbox da UI com alterações de auto-start vindas do tray
  listen('auto-start-changed', (event) => {
    if (chkAutoStart) {
      chkAutoStart.checked = event.payload;
    }
  });

  // Eventos de clique para seleção de launcher (legado removido)

  btnCheckUpdates.addEventListener('click', () => {
    if (selectedInstance && selectedInstance.updateChecked && !selectedInstance.isUpdating) {
      if (selectedInstance.updateAvailable) {
        runUpdateForInstance(selectedInstance, false);
      } else {
        openGameFolder();
      }
    }
  });
  btnManualSelect.addEventListener('click', selectFolderManually);
  if (btnChangeInstance) btnChangeInstance.addEventListener('click', showSetupPane);
  if (btnApplyUpdate) btnApplyUpdate.addEventListener('click', () => startUpdateProcess(false));
  if (btnOpenGameFolder) btnOpenGameFolder.addEventListener('click', openGameFolder);
  if (btnFinishUpToDate) btnFinishUpToDate.addEventListener('click', showSetupPane);
  if (btnFinishSuccess) btnFinishSuccess.addEventListener('click', showSetupPane);

  const btnReloadInstances = document.getElementById('btnReloadInstances');
  if (btnReloadInstances) {
    btnReloadInstances.addEventListener('click', () => scanInstances(true));
  }

  if (chkAutoStart) {
    chkAutoStart.addEventListener('change', async () => {
      const checked = chkAutoStart.checked;
      try {
        await invoke('set_auto_start', { enable: checked });
      } catch (err) {
        showToast('Erro ao alterar inicialização automática.');
        chkAutoStart.checked = !checked; // reverte estado
      }
    });
  }
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
  if (paneStatus) paneStatus.classList.remove('active');
  paneSuccess.classList.remove('active');
  paneProgress.classList.remove('active');
  
  // Restaura texto original do botão de busca
  btnCheckUpdates.querySelector('span').textContent = 'Avançar';
  btnCheckUpdates.disabled = !selectedInstance || !selectedInstance.updateChecked;
  
  paneSetup.classList.add('active');
  scanInstances(false); // Apenas recarrega (lê do config ou faz varredura inicial se vazio)
}

// Funções de transição de launcher (legado removido)

// Escanear instâncias locais
async function scanInstances(forceRescan) {
  instancesStatus.classList.remove('hidden');
  instancesList.classList.add('hidden');
  instancesEmpty.classList.add('hidden');
  btnCheckUpdates.disabled = true;

  try {
    detectedInstances = await invoke('detect_instances', { forceRescan: forceRescan || false });
    
    if (detectedInstances && detectedInstances.length > 0) {
      renderInstances();
      instancesStatus.classList.add('hidden');
      instancesList.classList.remove('hidden');
      
      const stillExists = selectedInstance && detectedInstances.some(inst => inst.instancePath === selectedInstance.instancePath);
      if (!stillExists) {
        selectInstance(detectedInstances[0]);
      } else {
        const current = detectedInstances.find(inst => inst.instancePath === selectedInstance.instancePath);
        selectInstance(current);
      }

      // Inicia verificação assíncrona de atualizações para cada uma
      checkUpdatesForLoadedInstances();
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

// Consulta assíncrona de updates de todas as instâncias em background
async function checkUpdatesForLoadedInstances() {
  for (let inst of detectedInstances) {
    if (inst.updateChecked) continue;
    try {
      const data = await invoke('check_updates', {
        currentVersion: inst.version
      });
      inst.updateChecked = true;
      inst.updateAvailable = data.updateAvailable;
      inst.latestVersion = data.latestVersion;
      inst.updates = data.updates;
    } catch (err) {
      console.error('Erro ao verificar updates em background para ' + inst.instanceName, err);
      inst.updateChecked = true;
      inst.updateAvailable = false;
      inst.updates = [];
    }
    renderInstances();
    if (selectedInstance && selectedInstance.instancePath === inst.instancePath) {
      updateSetupButtonState();
    }
  }
}

// Renderizar lista de instâncias
function renderInstances() {
  instancesList.innerHTML = '';
  detectedInstances.forEach((inst, index) => {
    const card = document.createElement('div');
    const isSelected = selectedInstance && selectedInstance.instancePath === inst.instancePath;
    
    if (inst.isUpdating) {
      card.className = `instance-card selected updating`;
      card.innerHTML = `
        <div class="inst-details" style="width: 100%;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 4px;">
            <span class="inst-title">${escapeHtml(inst.instanceName)}</span>
            <span class="inst-sub" style="color: var(--diamond); font-size: 1rem; font-weight: bold;">Atualizando... ${inst.updatePercent || 0}%</span>
          </div>
          <div class="card-progress-track">
            <div class="card-progress-fill" style="width: ${inst.updatePercent || 0}%"></div>
          </div>
        </div>
      `;
      card.style.cursor = 'wait';
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
      });
    } else {
      card.className = `instance-card ${isSelected ? 'selected' : ''}`;
      
      let updateIndicator = '';
      if (inst.updateChecked) {
        if (inst.updateAvailable) {
          updateIndicator = `
            <button class="inst-card-update-btn" title="Atualizar Modpack" type="button">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              <span>Atualizar</span>
            </button>
          `;
        }
      } else {
        updateIndicator = `<span class="inst-checking-badge" title="Verificando atualizações...">...</span>`;
      }

      let verClass = '';
      if (inst.updateChecked) {
        if (inst.updateAvailable) {
          verClass = 'needs-update';
        } else {
          verClass = 'up-to-date';
        }
      }

      card.innerHTML = `
        <div>
          <span class="inst-title">${escapeHtml(inst.instanceName)}</span>
          <span class="inst-sub">${escapeHtml(inst.launcher)}</span>
        </div>
        <div class="inst-meta">
          <span class="inst-ver ${verClass}">v${escapeHtml(inst.version)}</span>
          ${updateIndicator}
        </div>
      `;

      card.addEventListener('click', () => {
        selectInstance(inst);
        document.querySelectorAll('.instance-card').forEach((c, idx) => {
          c.classList.toggle('selected', idx === index);
        });
      });

      const updateBtn = card.querySelector('.inst-card-update-btn');
      if (updateBtn) {
        updateBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          selectInstance(inst);
          document.querySelectorAll('.instance-card').forEach((c, idx) => {
            c.classList.toggle('selected', idx === index);
          });
          runUpdateForInstance(inst, false);
        });
      }
    }

    instancesList.appendChild(card);
  });
}

// Selecionar instância
function selectInstance(instance) {
  selectedInstance = instance;
  updateSetupButtonState();
  startPeriodicUpdateCheck();
}

// Seleção manual de pasta
async function selectFolderManually() {
  try {
    const inst = await invoke('select_folder_manually');
    if (inst) {
      const existingIdx = detectedInstances.findIndex(x => x.instancePath === inst.instancePath);
      if (existingIdx !== -1) {
        detectedInstances[existingIdx] = inst;
      } else {
        detectedInstances.push(inst);
      }

      renderInstances();
      instancesEmpty.classList.add('hidden');
      instancesList.classList.remove('hidden');
      selectInstance(inst);
      
      setTimeout(() => {
        const idx = detectedInstances.findIndex(x => x.instancePath === inst.instancePath);
        const cards = document.querySelectorAll('.instance-card');
        cards.forEach((c, i) => c.classList.toggle('selected', i === idx));
      }, 50);

      showToast('Modpack selecionado com sucesso!');
      checkUpdatesForInstance(inst);
    }
  } catch (err) {
    showToast(err.toString());
  }
}

// Executa verificação específica de atualizações (usado na escolha manual)
async function checkUpdatesForInstance(inst) {
  try {
    const data = await invoke('check_updates', {
      currentVersion: inst.version
    });
    inst.updateChecked = true;
    inst.updateAvailable = data.updateAvailable;
    inst.latestVersion = data.latestVersion;
    inst.updates = data.updates;
  } catch (err) {
    console.error(err);
    inst.updateChecked = true;
    inst.updateAvailable = false;
    inst.updates = [];
  }
  renderInstances();
  if (selectedInstance && selectedInstance.instancePath === inst.instancePath) {
    updateSetupButtonState();
  }
}

// Atualiza o estado do botão principal na tela de setup
function updateSetupButtonState() {
  if (!selectedInstance) {
    btnCheckUpdates.disabled = true;
    btnCheckUpdates.innerHTML = `
      <span>Avançar</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    `;
    return;
  }

  if (selectedInstance.isUpdating) {
    btnCheckUpdates.disabled = true;
    btnCheckUpdates.innerHTML = `
      <span>Atualizando...</span>
      <div class="loading-ring" style="width: 12px; height: 12px; border-width: 2px;"></div>
    `;
    return;
  }

  if (!selectedInstance.updateChecked) {
    btnCheckUpdates.disabled = true;
    btnCheckUpdates.innerHTML = `
      <span>Conectando...</span>
      <div class="loading-ring" style="width: 12px; height: 12px; border-width: 2px;"></div>
    `;
    return;
  }

  btnCheckUpdates.disabled = false;
  if (selectedInstance.updateAvailable) {
    btnCheckUpdates.innerHTML = `
      <span>Atualizar Modpack</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
    `;
  } else {
    btnCheckUpdates.innerHTML = `
      <span>Abrir Pasta do Jogo</span>
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
    `;
  }
}

// Inicia o processo de atualização de forma assíncrona para uma instância
async function runUpdateForInstance(inst, isBackground = false) {
  if (inst.isUpdating) return;
  
  inst.isUpdating = true;
  inst.updatePercent = 0;
  renderInstances();
  updateSetupButtonState();

  const unlistenProgress = await listen('download-progress', (event) => {
    const percent = event.payload;
    inst.updatePercent = percent;
    renderInstances();
  });

  const updatesToApply = inst.updates || [];
  let success = true;

  for (let i = 0; i < updatesToApply.length; i++) {
    const update = updatesToApply[i];
    try {
      await invoke('apply_update', {
        downloadUrl: update.downloadUrl,
        toVersion: update.toVersion,
        removedFiles: update.removedFiles,
        minecraftPath: inst.minecraftPath
      });
      inst.version = update.toVersion;
    } catch (err) {
      console.error('Falha ao instalar v' + update.toVersion, err);
      success = false;
      break;
    }
  }

  unlistenProgress();
  inst.isUpdating = false;

  if (success) {
    try {
      const isValid = await invoke('validate_installation', {
        minecraftPath: inst.minecraftPath,
        targetVersion: inst.latestVersion
      });

      if (isValid) {
        inst.version = inst.latestVersion;
        inst.updateAvailable = false;
        inst.updates = [];
        showToast('Atualização concluída com sucesso!');
        
        if (isBackground) {
          try {
            await invoke('show_notification', {
              title: 'Modpack Atualizado!',
              body: `O Foundry & Frontier foi atualizado para a versão ${inst.latestVersion} e está pronto para jogar.`
            });
          } catch (err) {
            console.error('Erro ao disparar notificação:', err);
          }
        }
      } else {
        showToast('Falha na validação rápida da versão.');
      }
    } catch (err) {
      showToast('Erro ao validar arquivos instalados.');
    }
  } else {
    showToast('Ocorreu um problema ao aplicar as atualizações.');
  }

  inst.updatePercent = 0;
  renderInstances();
  updateSetupButtonState();
}

// Abre o painel de status pré-carregado (legado/mantido por segurança)
function goToStatusPaneForInstance(inst) {
  selectedInstance = inst;
  
  paneSetup.classList.remove('active');
  if (paneStatus) paneStatus.classList.add('active');

  if (statusLauncherTag) statusLauncherTag.textContent = inst.launcher;
  if (statusInstanceName) statusInstanceName.textContent = inst.instanceName;

  if (inst.updateAvailable) {
    pendingUpdates = inst.updates;
    latestVersion = inst.latestVersion;
    if (currentVerText) currentVerText.textContent = inst.version;
    if (serverVerText) serverVerText.textContent = inst.latestVersion;

    if (changelogList) {
      changelogList.innerHTML = '';
      inst.updates.forEach(u => {
        const item = document.createElement('div');
        item.style.marginBottom = '0.4rem';
        item.innerHTML = `
          <div class="changelog-ver">Versão ${escapeHtml(u.toVersion)}</div>
          <div class="changelog-text">${escapeHtml(u.description).replace(/\n/g, '<br>')}</div>
        `;
        changelogList.appendChild(item);
      });
    }

    if (statusUpdateAvailable) statusUpdateAvailable.classList.remove('hidden');
    if (statusUpToDate) statusUpToDate.classList.add('hidden');
  } else {
    pendingUpdates = [];
    if (activeVerBadgeText) activeVerBadgeText.textContent = inst.version;
    if (statusUpdateAvailable) statusUpdateAvailable.classList.add('hidden');
    if (statusUpToDate) statusUpToDate.classList.remove('hidden');
  }
}

// Iniciar Processo de Atualização (Trigger do Usuário ou Background)
async function startUpdateProcess(isBackground = false) {
  if (pendingUpdates.length === 0 || !selectedInstance) return;

  // Ir para a tela de progresso (caso a janela esteja visível, ou para quando for aberta)
  if (paneStatus) paneStatus.classList.remove('active');
  paneSetup.classList.remove('active');
  paneSuccess.classList.remove('active');
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

        // Se for atualização em background, dispara a notificação do Windows
        if (isBackground) {
          try {
            await invoke('show_notification', {
              title: 'Modpack Atualizado!',
              body: `O Foundry & Frontier foi atualizado para a versão ${latestVersion} e está pronto para jogar.`
            });
          } catch (err) {
            console.error('Erro ao disparar notificação:', err);
          }
        }
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

// Inicializa o estado do checkbox de auto-start
async function initAutoStartState() {
  if (!chkAutoStart) return;
  try {
    const isEnabled = await invoke('is_auto_start_enabled');
    chkAutoStart.checked = isEnabled;
  } catch (err) {
    console.error('Erro ao ler estado do auto-start:', err);
  }
}

// Inicia verificação periódica de atualizações em background
function startPeriodicUpdateCheck() {
  if (periodicCheckTimer) clearInterval(periodicCheckTimer);
  periodicCheckTimer = setInterval(periodicCheck, PERIODIC_CHECK_INTERVAL);
}

// Executa verificação de atualizações periódicas
async function periodicCheck() {
  if (!selectedInstance || isUpdatingInBackground) return;

  try {
    const data = await invoke('check_updates', {
      currentVersion: selectedInstance.version
    });

    if (data.updateAvailable) {
      pendingUpdates = data.updates;
      latestVersion = data.latestVersion;

      // Verifica se Minecraft (javaw.exe) está aberto
      const mcRunning = await invoke('is_minecraft_running');

      if (mcRunning) {
        // Se estiver jogando, notifica sobre a atualização disponível
        try {
          await invoke('show_notification', {
            title: 'Atualização de Modpack Disponível',
            body: `Uma nova versão (${latestVersion}) do Foundry & Frontier está disponível. O jogo será atualizado automaticamente assim que for fechado.`
          });
        } catch (err) {
          console.error('Erro ao enviar notificação:', err);
        }
      } else {
        // Se não estiver jogando, aplica a atualização silenciosamente em background
        isUpdatingInBackground = true;
        await startUpdateProcess(true);
      }
    }
  } catch (err) {
    console.error('Erro na verificação automática de updates:', err);
  }
}

// Inicia o temporizador de atualizações automáticas do aplicativo (12 horas)
function startAppSelfUpdateTimer() {
  if (appSelfUpdateTimer) clearInterval(appSelfUpdateTimer);
  appSelfUpdateTimer = setInterval(periodicAppSelfUpdateCheck, APP_SELF_UPDATE_INTERVAL);
}

// Verifica atualizações do próprio aplicativo de 12 em 12 horas em background
async function periodicAppSelfUpdateCheck() {
  try {
    const checkResult = await invoke('check_app_update');
    if (checkResult.updateAvailable && checkResult.downloadUrl) {
      // Baixa silenciosamente a atualização do app
      const zipPath = await invoke('download_app_update', {
        downloadUrl: checkResult.downloadUrl,
      });
      // Executa o sync-runner para aplicar e reiniciar em background se estiver minimizado
      await invoke('launch_sync_runner', {
        zipPath,
        installDir: '',
        appExe: '',
      });
    }
  } catch (err) {
    console.error('[periodic-app-update] Erro na verificação/aplicação de update do app:', err);
  }
}
