const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'updates.json');

// Função auxiliar para ler o banco
function readDb() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      // Se não existir, retorna a estrutura inicial vazia
      return { updates: [] };
    }
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Erro ao ler o arquivo de atualizações:', error);
    return { updates: [] };
  }
}

// Função auxiliar para escrever no banco
function writeDb(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), 'utf8');
    return true;
  } catch (error) {
    console.error('Erro ao salvar no arquivo de atualizações:', error);
    return false;
  }
}

const Database = {
  // Retorna todas as atualizações cadastradas
  getAll() {
    const db = readDb();
    // Retorna ordenado pela data de criação decrescente (mais recentes primeiro)
    return db.updates.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  },

  // Busca uma atualização por ID
  getById(id) {
    const db = readDb();
    return db.updates.find(u => u.id === id) || null;
  },

  // Adiciona uma nova atualização
  add({ from_version, to_version, zip_filename, description, removed_files }) {
    const db = readDb();
    
    // Evita duplicados para a mesma transição de versão
    const exists = db.updates.some(
      u => u.from_version.trim() === from_version.trim() && u.to_version.trim() === to_version.trim()
    );
    if (exists) {
      throw new Error(`Já existe uma atualização cadastrada de ${from_version} para ${to_version}.`);
    }

    const newUpdate = {
      id: Date.now().toString(), // ID simples e único usando timestamp
      from_version: from_version.trim(),
      to_version: to_version.trim(),
      zip_filename,
      description: description || '',
      removed_files: Array.isArray(removed_files) ? removed_files : [],
      created_at: new Date().toISOString()
    };

    db.updates.push(newUpdate);
    writeDb(db);
    return newUpdate;
  },

  // Deleta uma atualização pelo ID
  delete(id) {
    const db = readDb();
    const index = db.updates.findIndex(u => u.id === id);
    if (index === -1) {
      return null;
    }
    const removed = db.updates.splice(index, 1)[0];
    writeDb(db);
    return removed;
  },

  // Retorna a versão mais recente alcançável do modpack
  getLatestVersion() {
    const db = readDb();
    if (db.updates.length === 0) return '1.0.0';

    // A versão "mais recente" é a versão destino (to_version)
    // que não serve como origem (from_version) de nenhum outro update cadastrado.
    const fromVersions = new Set(db.updates.map(u => u.from_version.trim().replace(/^v/i, '')));
    const destinations = db.updates.map(u => u.to_version.trim().replace(/^v/i, ''));
    
    // Filtra destinos que não são origens de ninguém
    const terminalDestinations = destinations.filter(dest => !fromVersions.has(dest));

    if (terminalDestinations.length > 0) {
      // Caso existam caminhos múltiplos, pegamos o último adicionado
      return terminalDestinations[terminalDestinations.length - 1];
    }

    // Se tudo for um ciclo ou não achar um terminal claro, pega a maior versão cadastrada
    return destinations.sort().pop() || '1.0.0';
  },

  // Retorna a cadeia de updates necessária a partir da versão atual do cliente
  getUpdateChain(currentVersion) {
    const db = readDb();
    const chain = [];
    let current = currentVersion.trim().replace(/^v/i, '');
    let foundNext = true;

    // Fazemos um loop para encontrar o caminho de atualizações sequenciais
    // Evitamos loops infinitos limitando a 100 iterações (o que é mais que suficiente)
    let iterations = 0;
    while (foundNext && iterations < 100) {
      iterations++;
      // Encontra a atualização cujo from_version seja igual à versão atual da busca
      const nextUpdate = db.updates.find(u => u.from_version.trim().replace(/^v/i, '') === current);
      if (nextUpdate) {
        chain.push(nextUpdate);
        current = nextUpdate.to_version.trim().replace(/^v/i, '');
      } else {
        foundNext = false;
      }
    }

    return chain;
  }
};

module.exports = Database;
