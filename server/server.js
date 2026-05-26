const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('./database');

const app = express();
const PORT = process.env.PORT || 10000;

// Garantir que a pasta de uploads exista
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Configuração do Multer para uploads de ZIP
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    // Evitar conflitos de nome adicionando timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, file.fieldname + '-' + uniqueSuffix + ext);
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/zip' || path.extname(file.originalname).toLowerCase() === '.zip') {
      cb(null, true);
    } else {
      cb(new Error('Apenas arquivos ZIP são permitidos.'));
    }
  }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir os arquivos do painel administrativo
app.use(express.static(path.join(__dirname, 'public')));

// --- Endpoints da API ---

// 1. Obter a última versão disponível
app.get('/api/latest-version', (req, res) => {
  try {
    const latest = Database.getLatestVersion();
    res.json({ version: latest });
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar última versão.' });
  }
});

// 2. Verificar atualizações pendentes a partir da versão atual do cliente
app.get('/api/check-updates', (req, res) => {
  const currentVersion = req.query.version;
  if (!currentVersion) {
    return res.status(400).json({ error: 'Parâmetro version é obrigatório.' });
  }

  try {
    const chain = Database.getUpdateChain(currentVersion);
    const latestVersion = Database.getLatestVersion();

    if (chain.length === 0) {
      return res.json({
        updateAvailable: false,
        currentVersion,
        latestVersion,
        updates: []
      });
    }

    // Mapear updates para incluir a URL completa do download do ZIP
    const mappedUpdates = chain.map(u => {
      // O host é extraído da própria requisição para ser dinâmico
      const protocol = req.protocol;
      const host = req.get('host');
      const downloadUrl = `${protocol}://${host}/api/download/${u.zip_filename}`;

      return {
        id: u.id,
        fromVersion: u.from_version.trim().replace(/^v/i, ''),
        toVersion: u.to_version.trim().replace(/^v/i, ''),
        downloadUrl,
        description: u.description,
        removedFiles: u.removed_files
      };
    });

    res.json({
      updateAvailable: true,
      currentVersion,
      latestVersion,
      updates: mappedUpdates
    });
  } catch (error) {
    console.error('Erro na checagem de updates:', error);
    res.status(500).json({ error: 'Erro interno ao processar atualizações.' });
  }
});

// 3. Endpoint de Download do arquivo ZIP
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  // Segurança contra Path Traversal
  const safeFilename = path.basename(filename);
  const filePath = path.join(UPLOADS_DIR, safeFilename);

  if (fs.existsSync(filePath)) {
    res.download(filePath, safeFilename);
  } else {
    res.status(404).json({ error: 'Arquivo de atualização não encontrado.' });
  }
});

// --- Endpoints Administrativos ---

// A. Listar atualizações
app.get('/api/admin/updates', (req, res) => {
  try {
    const updates = Database.getAll();
    res.json(updates);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao listar atualizações.' });
  }
});

// B. Adicionar atualização (Upload de ZIP + cadastro)
app.post('/api/admin/updates', upload.single('zip_file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'O arquivo ZIP de atualização é obrigatório.' });
  }

  const { from_version, to_version, description, removed_files } = req.body;

  if (!from_version || !to_version) {
    // Se falhar a validação, removemos o arquivo recém-salvo para não deixar lixo
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Os campos from_version e to_version são obrigatórios.' });
  }

  try {
    // Processar removed_files: aceita string JSON, string separada por quebras de linha ou array
    let processedRemoved = [];
    if (removed_files) {
      if (typeof removed_files === 'string') {
        // Tenta parsear caso seja JSON
        try {
          processedRemoved = JSON.parse(removed_files);
        } catch (e) {
          // Se não for JSON, trata como texto com linhas
          processedRemoved = removed_files
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);
        }
      } else if (Array.isArray(removed_files)) {
        processedRemoved = removed_files;
      }
    }

    const newUpdate = Database.add({
      from_version,
      to_version,
      zip_filename: req.file.filename,
      description,
      removed_files: processedRemoved
    });

    res.status(201).json(newUpdate);
  } catch (error) {
    // Deleta o arquivo em caso de erro (ex: versões duplicadas)
    if (fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error('Erro ao adicionar atualização:', error);
    res.status(400).json({ error: error.message || 'Erro ao salvar atualização.' });
  }
});

// C. Deletar atualização
app.delete('/api/admin/updates/:id', (req, res) => {
  const id = req.params.id;

  try {
    const update = Database.getById(id);
    if (!update) {
      return res.status(404).json({ error: 'Atualização não encontrada.' });
    }

    // Remove do banco de dados
    Database.delete(id);

    // Remove o arquivo físico correspondente
    const filePath = path.join(UPLOADS_DIR, update.zip_filename);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    res.json({ message: 'Atualização excluída com sucesso.', id });
  } catch (error) {
    console.error('Erro ao deletar atualização:', error);
    res.status(500).json({ error: 'Erro interno ao deletar atualização.' });
  }
});

// Inicialização do servidor
app.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`  UPDATE SERVER RODANDO NA PORTA ${PORT}`);
  console.log(`  Painel Admin: http://localhost:${PORT}`);
  console.log(`=========================================`);
});
