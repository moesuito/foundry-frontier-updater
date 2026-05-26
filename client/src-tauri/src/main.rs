// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use directories::BaseDirs;

// --- Estruturas de Dados serializáveis para o Tauri ---

#[derive(Serialize, Deserialize, Debug, Clone)]
struct InstanceInfo {
    launcher: String,
    #[serde(rename = "instanceName")]
    instance_name: String,
    #[serde(rename = "instancePath")]
    instance_path: String,
    #[serde(rename = "minecraftPath")]
    minecraft_path: String,
    version: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct UpdateResponse {
    #[serde(rename = "updateAvailable")]
    update_available: bool,
    #[serde(rename = "currentVersion")]
    current_version: String,
    #[serde(rename = "latestVersion")]
    latest_version: String,
    updates: Vec<UpdateItem>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct UpdateItem {
    id: String,
    #[serde(rename = "fromVersion")]
    from_version: String,
    #[serde(rename = "toVersion")]
    to_version: String,
    #[serde(rename = "downloadUrl")]
    download_url: String,
    description: String,
    #[serde(rename = "removedFiles")]
    removed_files: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct VersionJson {
    schema: i32,
    #[serde(rename = "packId")]
    pack_id: String,
    #[serde(rename = "packName")]
    pack_name: String,
    version: String,
    minecraft: String,
    loader: String,
    #[serde(rename = "loaderVersion")]
    loader_version: String,
}

// --- Funções Auxiliares (Bootstrap e Varredura) ---

fn detect_initial_mods(mods_dir: &Path) -> bool {
    if !mods_dir.exists() || !mods_dir.is_dir() {
        return false;
    }

    let key_mods = vec![
        "mek_x_star-1.20.1-1.3.5.jar",
        "tfmg-1.0.2f.jar",
        "Northstar-0.5.4+1.20.1.jar",
        "create-1.20.1-6.0.8.jar",
    ];

    let mut found_count = 0;
    if let Ok(entries) = fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            if let Some(file_name) = entry.file_name().to_str() {
                let lower_name = file_name.to_lowercase();
                for key_mod in &key_mods {
                    if lower_name.contains(&key_mod.to_lowercase()) {
                        found_count += 1;
                        break;
                    }
                }
            }
        }
    }

    found_count >= 3
}

fn create_bootstrap_version_json(version_json_path: &Path) -> std::io::Result<()> {
    let default_version = VersionJson {
        schema: 1,
        pack_id: "foundry-frontier".to_string(),
        pack_name: "Foundry & Frontier".to_string(),
        version: "1.0.0".to_string(),
        minecraft: "1.20.1".to_string(),
        loader: "forge".to_string(),
        loader_version: "47.4.20".to_string(),
    };

    let serialized = serde_json::to_string_pretty(&default_version)?;
    fs::write(version_json_path, serialized)?;
    Ok(())
}

// --- Comandos do Tauri ---

#[tauri::command]
fn detect_instances(launcher_filter: String) -> Vec<InstanceInfo> {
    let mut instances = Vec::new();
    let base_dirs = match BaseDirs::new() {
        Some(dirs) => dirs,
        None => return instances,
    };

    let appdata = base_dirs.data_dir();

    let mut launchers = Vec::new();
    if launcher_filter == "Prism Launcher" {
        launchers.push(("Prism Launcher", appdata.join("PrismLauncher").join("instances")));
    } else if launcher_filter == "PolyMC" {
        launchers.push(("PolyMC", appdata.join("PolyMC").join("instances")));
    } else {
        launchers.push(("Prism Launcher", appdata.join("PrismLauncher").join("instances")));
        launchers.push(("PolyMC", appdata.join("PolyMC").join("instances")));
    }

    for (launcher_name, instances_dir) in launchers {
        if !instances_dir.exists() || !instances_dir.is_dir() {
            continue;
        }

        if let Ok(entries) = fs::read_dir(instances_dir) {
            for entry in entries.flatten() {
                let instance_path = entry.path();
                if !instance_path.is_dir() {
                    continue;
                }

                let minecraft_path = instance_path.join(".minecraft");
                let version_json_path = minecraft_path.join("version.json");
                let mods_path = minecraft_path.join("mods");

                let folder_name = instance_path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("Desconhecida");

                // Caso 1: Já possui version.json
                if version_json_path.exists() && version_json_path.is_file() {
                    if let Ok(file_content) = fs::read_to_string(&version_json_path) {
                        if let Ok(version_data) = serde_json::from_str::<VersionJson>(&file_content) {
                            if version_data.pack_id == "foundry-frontier" {
                                instances.push(InstanceInfo {
                                    launcher: launcher_name.to_string(),
                                    instance_name: folder_name.to_string(),
                                    instance_path: instance_path.to_string_lossy().to_string(),
                                    minecraft_path: minecraft_path.to_string_lossy().to_string(),
                                    version: version_data.version,
                                });
                            }
                        }
                    }
                }
                // Caso 2: Não possui version.json mas tem os mods chaves (Bootstrap)
                else if detect_initial_mods(&mods_path) {
                    if create_bootstrap_version_json(&version_json_path).is_ok() {
                        instances.push(InstanceInfo {
                            launcher: launcher_name.to_string(),
                            instance_name: folder_name.to_string(),
                            instance_path: instance_path.to_string_lossy().to_string(),
                            minecraft_path: minecraft_path.to_string_lossy().to_string(),
                            version: "1.0.0".to_string(),
                        });
                    }
                }
            }
        }
    }

    instances
}

#[tauri::command]
fn select_folder_manually() -> Result<Option<InstanceInfo>, String> {
    // Abre o diálogo de seleção de pasta nativo
    let file_dialog = tauri::api::dialog::blocking::FileDialogBuilder::new()
        .set_title("Selecione a pasta raiz do modpack (contendo a pasta .minecraft)")
        .pick_folder();

    if let Some(selected_path) = file_dialog {
        let mut minecraft_path = selected_path.clone();
        if minecraft_path.file_name().and_then(|n: &std::ffi::OsStr| n.to_str()) != Some(".minecraft") {
            let sub_mc = minecraft_path.join(".minecraft");
            if sub_mc.exists() {
                minecraft_path = sub_mc;
            }
        }

        let version_json_path = minecraft_path.join("version.json");
        let mods_path = minecraft_path.join("mods");

        if version_json_path.exists() {
            let content = fs::read_to_string(&version_json_path)
                .map_err(|e| format!("Erro ao ler version.json: {}", e))?;
            let version_data: VersionJson = serde_json::from_str(&content)
                .map_err(|e| format!("JSON corrompido: {}", e))?;

            if version_data.pack_id == "foundry-frontier" {
                return Ok(Some(InstanceInfo {
                    launcher: "Manual".to_string(),
                    instance_name: minecraft_path.parent()
                        .and_then(|p: &Path| p.file_name())
                        .and_then(|n: &std::ffi::OsStr| n.to_str())
                        .unwrap_or("Foundry & Frontier")
                        .to_string(),
                    instance_path: selected_path.to_string_lossy().to_string(),
                    minecraft_path: minecraft_path.to_string_lossy().to_string(),
                    version: version_data.version,
                }));
            }
        } else if detect_initial_mods(&mods_path) {
            // Bootstrap inicial manual
            if create_bootstrap_version_json(&version_json_path).is_ok() {
                return Ok(Some(InstanceInfo {
                    launcher: "Manual".to_string(),
                    instance_name: minecraft_path.parent()
                        .and_then(|p: &Path| p.file_name())
                        .and_then(|n: &std::ffi::OsStr| n.to_str())
                        .unwrap_or("Foundry & Frontier")
                        .to_string(),
                    instance_path: selected_path.to_string_lossy().to_string(),
                    minecraft_path: minecraft_path.to_string_lossy().to_string(),
                    version: "1.0.0".to_string(),
                }));
            }
        }
        return Err("A pasta selecionada não contém uma instalação válida do Foundry & Frontier.".to_string());
    }
    Ok(None)
}

#[tauri::command]
fn check_updates(server_url: String, current_version: String) -> Result<UpdateResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("Erro ao inicializar cliente HTTP: {}", e))?;

    let check_url = format!("{}/api/check-updates?version={}", server_url.trim_end_matches('/'), current_version);
    
    let res = client.get(&check_url).send()
        .map_err(|e| format!("Falha ao conectar com o servidor: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("Servidor retornou status HTTP: {}", res.status()));
    }

    let response_data: UpdateResponse = res.json()
        .map_err(|e| format!("Erro ao analisar resposta do servidor: {}", e))?;

    Ok(response_data)
}

#[tauri::command]
fn apply_update(
    window: tauri::Window,
    download_url: String,
    to_version: String,
    removed_files: Vec<String>,
    minecraft_path: String,
) -> Result<(), String> {
    let mc_path = Path::new(&minecraft_path);
    if !mc_path.exists() {
        return Err("Caminho .minecraft não existe".to_string());
    }

    // 1. Download do ZIP de atualização para arquivo temporário
    let temp_zip_path = std::env::temp_dir().join(format!("ff-update-{}-{}.zip", to_version, uuid_dummy()));
    
    let mut response = reqwest::blocking::get(&download_url)
        .map_err(|e| format!("Falha ao baixar patch ZIP: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Servidor HTTP retornou erro no download: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut dest_file = fs::File::create(&temp_zip_path)
        .map_err(|e| format!("Erro ao criar arquivo ZIP temporário: {}", e))?;

    let mut buffer = [0; 8192];
    let mut downloaded: u64 = 0;

    // Loop de download emitindo progresso para o JS
    loop {
        let bytes_read = response.read(&mut buffer)
            .map_err(|e| format!("Erro de leitura no download: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        dest_file.write_all(&buffer[..bytes_read])
            .map_err(|e| format!("Erro ao gravar arquivo ZIP: {}", e))?;

        downloaded += bytes_read as u64;
        
        if total_size > 0 {
            let percent = (downloaded * 100) / total_size;
            let _ = window.emit("download-progress", percent);
        }
    }

    // Fecha o arquivo para permitir leitura e descompressão
    drop(dest_file);

    // 2. Remoção de arquivos obsoletos descritos no patch
    if !removed_files.is_empty() {
        for rel_path in &removed_files {
            let clean_rel = rel_path.replace("..", "");
            let target_path = mc_path.join(clean_rel);
            if target_path.exists() {
                if target_path.is_file() {
                    let _ = fs::remove_file(&target_path);
                } else if target_path.is_dir() {
                    let _ = fs::remove_dir_all(&target_path);
                }
            }
        }
    }

    // 3. Extração do ZIP
    let file = fs::File::open(&temp_zip_path)
        .map_err(|e| format!("Falha ao ler arquivo ZIP baixado: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Arquivo ZIP corrompido: {}", e))?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Erro ao acessar arquivo no ZIP: {}", e))?;
        let outpath = match file.enclosed_name() {
            Some(path) => mc_path.join(path),
            None => continue,
        };

        if (*file.name()).ends_with('/') {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Erro ao criar subdiretório: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Erro ao criar subdiretório: {}", e))?;
                }
            }
            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Erro ao criar arquivo de destino: {}", e))?;
            std::io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Erro ao descompactar arquivo: {}", e))?;
        }
    }

    // Limpeza
    let _ = fs::remove_file(&temp_zip_path);

    Ok(())
}

#[tauri::command]
fn validate_installation(minecraft_path: String, target_version: String) -> Result<bool, String> {
    let version_json_path = Path::new(&minecraft_path).join("version.json");
    if !version_json_path.exists() {
        return Err("Arquivo version.json não encontrado após a atualização.".to_string());
    }
    let content = fs::read_to_string(&version_json_path)
        .map_err(|e| format!("Falha ao ler o version.json: {}", e))?;
    let version_data: VersionJson = serde_json::from_str(&content)
        .map_err(|e| format!("version.json corrompido ou inválido: {}", e))?;
    
    if version_data.version.trim() == target_version.trim() {
        Ok(true)
    } else {
        Err(format!("A versão instalada (v{}) não condiz com a versão esperada (v{}).", version_data.version, target_version))
    }
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    open::that(path)
        .map_err(|e| format!("Erro ao abrir pasta: {}", e))
}

// Cria um sufixo simples aleatório para nomes temporários
fn uuid_dummy() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let start = SystemTime::now();
    let since_the_epoch = start.duration_since(UNIX_EPOCH).unwrap_or_default();
    since_the_epoch.as_millis().to_string()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            detect_instances,
            select_folder_manually,
            check_updates,
            apply_update,
            validate_installation,
            open_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
