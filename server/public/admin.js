// Elementos do DOM
const updateForm = document.getElementById('updateForm');
const fileDropZone = document.getElementById('fileDropZone');
const fileInput = document.getElementById('zip_file');
const selectedFileName = document.getElementById('selectedFileName');
const updatesList = document.getElementById('updatesList');
const loadingState = document.getElementById('loadingState');
const emptyState = document.getElementById('emptyState');
const latestVersionBadge = document.getElementById('latestVersionBadge');
const btnSubmit = document.getElementById('btnSubmit');
const btnSpinner = document.getElementById('btnSpinner');
const toast = document.getElementById('toast');
const toastMessage = document.getElementById('toastMessage');

// Estado local
let updates = [];

// Inicialização
document.addEventListener('DOMContentLoaded', () => {
  fetchUpdates();
  setupDragAndDrop();
});

// Toast Notifications
function showToast(message, type = 'success') {
  toastMessage.textContent = message;
  toast.className = `toast show ${type}`;
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// Configuração de Drag & Drop para o arquivo ZIP
function setupDragAndDrop() {
  fileInput.addEventListener('change', (e) => {
    updateFileName(e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    fileDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    fileDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      fileDropZone.classList.remove('dragover');
    }, false);
  });

  fileDropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;

    if (files.length > 0) {
      const file = files[0];
      if (file.name.toLowerCase().endsWith('.zip')) {
        fileInput.files = files;
        updateFileName(file);
      } else {
        showToast('Apenas arquivos no formato ZIP são aceitos.', 'error');
      }
    }
  });
}

function updateFileName(file) {
  if (file) {
    selectedFileName.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
    selectedFileName.style.color = 'var(--primary)';
  } else {
    selectedFileName.textContent = 'Nenhum arquivo selecionado';
    selectedFileName.style.color = 'var(--text-muted)';
  }
}

// Obter as atualizações do servidor
async function fetchUpdates() {
  loadingState.classList.remove('hidden');
  updatesList.classList.add('hidden');
  emptyState.classList.add('hidden');

  try {
    const response = await fetch('/api/admin/updates');
    if (!response.ok) throw new Error('Erro ao buscar atualizações.');
    
    updates = await response.json();
    
    // Obter última versão disponível
    const latestRes = await fetch('/api/latest-version');
    const latestData = await latestRes.json();
    latestVersionBadge.textContent = latestData.version || '1.0.0';

    renderUpdates();
  } catch (error) {
    console.error(error);
    showToast('Falha ao conectar com o servidor.', 'error');
    emptyState.classList.remove('hidden');
  } finally {
    loadingState.classList.add('hidden');
  }
}

// Renderizar atualizações na tela
function renderUpdates() {
  updatesList.innerHTML = '';
  
  if (updates.length === 0) {
    emptyState.classList.remove('hidden');
    updatesList.classList.add('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  updatesList.classList.remove('hidden');

  updates.forEach(u => {
    const card = document.createElement('div');
    card.className = 'update-item-card';

    // Criação de lista de arquivos deletados
    let deletionsHtml = '';
    if (u.removed_files && u.removed_files.length > 0) {
      deletionsHtml = `
        <div class="update-item-deletions">
          <div class="deletion-title">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            <span>Arquivos a serem deletados (${u.removed_files.length})</span>
          </div>
          <ul class="deletion-list">
            ${u.removed_files.map(file => `<li>${escapeHtml(file)}</li>`).join('')}
          </ul>
        </div>
      `;
    }

    const formattedDate = new Date(u.created_at).toLocaleString('pt-BR');

    card.innerHTML = `
      <div class="update-item-header">
        <div class="version-flow">
          <span class="v-from">${escapeHtml(u.from_version)}</span>
          <span class="arrow-icon">➔</span>
          <span class="v-to">${escapeHtml(u.to_version)}</span>
        </div>
        <button class="btn btn-danger btn-delete" data-id="${u.id}">Excluir</button>
      </div>
      <div class="update-item-meta">
        Publicado em: ${formattedDate}
      </div>
      <div class="update-item-desc">
        ${escapeHtml(u.description).replace(/\n/g, '<br>')}
      </div>
      ${deletionsHtml}
      <div class="update-item-actions">
        <a href="/api/download/${u.zip_filename}" class="zip-link">
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span>Baixar ZIP (${escapeHtml(u.zip_filename)})</span>
        </a>
      </div>
    `;

    // Evento de deleção
    card.querySelector('.btn-delete').addEventListener('click', () => {
      deleteUpdate(u.id);
    });

    updatesList.appendChild(card);
  });
}

// Deletar um pacote de atualização
async function deleteUpdate(id) {
  if (!confirm('Deseja realmente excluir este pacote de atualização? O arquivo ZIP será excluído permanentemente do servidor.')) {
    return;
  }

  try {
    const response = await fetch(`/api/admin/updates/${id}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      showToast('Pacote de atualização excluído com sucesso.');
      fetchUpdates();
    } else {
      const data = await response.json();
      showToast(data.error || 'Erro ao excluir pacote.', 'error');
    }
  } catch (error) {
    showToast('Falha na conexão ao tentar excluir.', 'error');
  }
}

// Enviar nova atualização (Upload de ZIP + cadastro)
updateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  // Alterar estados do botão
  btnSubmit.disabled = true;
  btnSpinner.style.display = 'inline-block';
  document.querySelector('#btnSubmit .btn-text').textContent = 'Enviando...';

  const formData = new FormData(updateForm);

  try {
    const response = await fetch('/api/admin/updates', {
      method: 'POST',
      body: formData
    });

    if (response.ok) {
      showToast('Atualização publicada com sucesso!');
      updateForm.reset();
      updateFileName(null);
      fetchUpdates();
    } else {
      const data = await response.json();
      showToast(data.error || 'Erro ao publicar atualização.', 'error');
    }
  } catch (error) {
    showToast('Falha de conexão com o servidor ao enviar.', 'error');
  } finally {
    btnSubmit.disabled = false;
    btnSpinner.style.display = 'none';
    document.querySelector('#btnSubmit .btn-text').textContent = 'Publicar Atualização';
  }
});

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
