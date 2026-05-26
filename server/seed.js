const fs = require('fs');
const path = require('path');

const SERVER_DIR = __dirname;
const APP_DIR = path.join(SERVER_DIR, '..');
const UPLOADS_DIR = path.join(SERVER_DIR, 'uploads');
const DB_PATH = path.join(SERVER_DIR, 'updates.json');

// Criar pasta de uploads se não existir
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// 1. Limpar atualizações anteriores do banco e pasta de uploads
console.log('Limpando dados anteriores...');
if (fs.existsSync(DB_PATH)) {
  fs.unlinkSync(DB_PATH);
}
const currentUploads = fs.readdirSync(UPLOADS_DIR);
for (const file of currentUploads) {
  fs.unlinkSync(path.join(UPLOADS_DIR, file));
}

// 2. Copiar ZIPs de teste para a pasta uploads
const zip1Source = path.join(APP_DIR, 'update-1.0.1.zip');
const zip2Source = path.join(APP_DIR, 'update-1.0.2.zip');

const zip1DestName = 'zip_file-101-' + Date.now() + '.zip';
// Garantir um pequeno delay para nomes de arquivos diferentes se necessário
const zip2DestName = 'zip_file-102-' + (Date.now() + 10) + '.zip';

if (!fs.existsSync(zip1Source) || !fs.existsSync(zip2Source)) {
  console.error('ERRO: Arquivos ZIP de teste não encontrados em:', APP_DIR);
  process.exit(1);
}

fs.copyFileSync(zip1Source, path.join(UPLOADS_DIR, zip1DestName));
fs.copyFileSync(zip2Source, path.join(UPLOADS_DIR, zip2DestName));

console.log('Arquivos ZIP copiados com sucesso para a pasta de uploads!');

// 3. Cadastrar atualizações no banco de dados JSON
const updates = [
  {
    id: 'seed-update-101',
    from_version: '1.0.0',
    to_version: '1.0.1',
    zip_filename: zip1DestName,
    description: 'Update 1.0.1: Adicionado mod de teste (new-mod-added) e atualizado test-config para v1.0.1. Deletado mod mock antigo (old-mod-to-delete.jar).',
    removed_files: ['mods/old-mod-to-delete.jar'],
    created_at: new Date(Date.now() - 60000).toISOString() // 1 min atrás
  },
  {
    id: 'seed-update-102',
    from_version: '1.0.1',
    to_version: '1.0.2',
    zip_filename: zip2DestName,
    description: 'Update 1.0.2: Adicionado o mod de teste (another-new-mod) e atualizado test-config para v1.0.2. Removido o mod de teste anterior (new-mod-added.jar).',
    removed_files: ['mods/new-mod-added.jar'],
    created_at: new Date().toISOString()
  }
];

fs.writeFileSync(DB_PATH, JSON.stringify({ updates }, null, 2), 'utf8');
console.log('Banco de dados JSON inicializado com 2 atualizações!');
console.log('Pronto para rodar os testes.');
