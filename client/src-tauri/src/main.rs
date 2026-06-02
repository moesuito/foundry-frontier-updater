// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use serde::{Deserialize, Serialize};
use directories::BaseDirs;
use tauri::{SystemTray, SystemTrayMenu, CustomMenuItem, SystemTrayEvent, Manager};

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

// --- GitHub Releases Structs ---

#[derive(Deserialize, Debug, Clone)]
struct GhRelease {
    tag_name: String,
    body: Option<String>,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize, Debug, Clone)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

// --- Funções Auxiliares de Parsing ---

fn parse_removed_files(body: &str) -> Vec<String> {
    let mut removed = Vec::new();
    let mut in_section = false;
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') {
            let lower = trimmed.to_lowercase();
            if lower.contains("removed file")
                || lower.contains("arquivos removidos")
                || lower.contains("arquivo removido")
                || lower.contains("removed_files")
            {
                in_section = true;
            } else {
                in_section = false;
            }
            continue;
        }
        if in_section {
            if trimmed.starts_with('-') || trimmed.starts_with('*') {
                let file_path = trimmed[1..].trim().trim_matches('`').trim().to_string();
                if !file_path.is_empty() {
                    removed.push(file_path);
                }
            }
        }
    }
    removed
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
fn check_updates(current_version: String) -> Result<UpdateResponse, String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("foundry-frontier-sync-updater/1.0")
        .build()
        .map_err(|e| format!("Erro ao inicializar cliente HTTP: {}", e))?;

    let check_url = "https://api.github.com/repos/moesuito/foundry-frontier-modpack/releases";
    
    let res = client.get(check_url).send()
        .map_err(|e| format!("Falha ao conectar com o GitHub: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("GitHub retornou status HTTP: {}", res.status()));
    }

    let releases: Vec<GhRelease> = res.json()
        .map_err(|e| format!("Erro ao analisar resposta do GitHub: {}", e))?;

    let local_ver = parse_version_tag(&current_version);
    
    // Filtra releases que tenham versão maior que a atual e tenham o asset de update zip
    let mut eligible_releases: Vec<((u64, u64, u64), GhRelease, GhAsset)> = Vec::new();
    
    for r in releases {
        let r_ver = parse_version_tag(&r.tag_name);
        if r_ver > local_ver {
            // Busca o asset update-[tag].zip ou similar
            let found_asset = r.assets.iter().find(|a| {
                a.name.starts_with("update-") && a.name.ends_with(".zip")
            }).cloned();
            
            if let Some(asset) = found_asset {
                eligible_releases.push((r_ver, r, asset));
            }
        }
    }

    // Ordena do menor para o maior (ordem cronológica)
    eligible_releases.sort_by(|a, b| a.0.cmp(&b.0));

    let mut updates = Vec::new();
    let mut current_chain = current_version.trim_start_matches('v').to_string();

    for (_, r, asset) in &eligible_releases {
        let to_ver = r.tag_name.trim_start_matches('v').to_string();
        let description = r.body.clone().unwrap_or_default();
        let removed_files = parse_removed_files(&description);
        
        updates.push(UpdateItem {
            id: r.tag_name.clone(),
            from_version: current_chain.clone(),
            to_version: to_ver.clone(),
            download_url: asset.browser_download_url.clone(),
            description,
            removed_files,
        });
        
        current_chain = to_ver;
    }

    let latest_version = if let Some(last) = eligible_releases.last() {
        last.1.tag_name.trim_start_matches('v').to_string()
    } else {
        current_version.trim_start_matches('v').to_string()
    };

    Ok(UpdateResponse {
        update_available: !updates.is_empty(),
        current_version: current_version.trim_start_matches('v').to_string(),
        latest_version,
        updates,
    })
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

        let is_dir = file.is_dir() || file.name().ends_with('/') || file.name().ends_with('\\');

        if is_dir {
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

// ---------------------------------------------------------------------------
// U1.3/U1.4 — App Self-Update structs and commands
// ---------------------------------------------------------------------------

/// Result returned to JS for the app self-update check.
#[derive(Serialize, Deserialize, Debug, Clone)]
struct AppUpdateInfo {
    /// True if a newer version is available on GitHub Releases.
    #[serde(rename = "updateAvailable")]
    update_available: bool,
    /// Local version string read from version.json, or Tauri package version.
    #[serde(rename = "localVersion")]
    local_version: String,
    /// Latest GitHub release tag, e.g. "v1.0.2".
    #[serde(rename = "latestTag")]
    latest_tag: String,
    /// Download URL for `foundry_frontier_sync_portable.zip` asset, if found.
    #[serde(rename = "downloadUrl")]
    download_url: Option<String>,
    /// Human-readable status message for the UI.
    message: String,
}

// structs GhRelease/GhAsset movidas para o topo do arquivo

/// Reads the local app version from `version.json` next to the executable,
/// or falls back to the Tauri package version embedded at compile time.
fn read_local_app_version() -> String {
    // Try version.json next to the current exe
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(dir) = exe_path.parent() {
            let vj = dir.join("version.json");
            if let Ok(content) = fs::read_to_string(&vj) {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                        return ver.to_string();
                    }
                }
            }
        }
    }
    // Fallback: version baked in at compile time
    env!("CARGO_PKG_VERSION").to_string()
}

/// Parse a semver-like tag string (e.g., "v1.0.2") into comparable tuple.
fn parse_version_tag(tag: &str) -> (u64, u64, u64) {
    let s = tag.trim_start_matches('v');
    let parts: Vec<u64> = s.split('.')
        .filter_map(|p| p.parse::<u64>().ok())
        .collect();
    (
        parts.get(0).copied().unwrap_or(0),
        parts.get(1).copied().unwrap_or(0),
        parts.get(2).copied().unwrap_or(0),
    )
}

/// Checks GitHub Releases API for a newer version of the updater app.
/// Called from JS at startup before showing the launcher selection pane.
#[tauri::command]
fn check_app_update() -> Result<AppUpdateInfo, String> {
    const GITHUB_API: &str =
        "https://api.github.com/repos/moesuito/foundry-frontier-updater/releases/latest";
    const PORTABLE_ASSET: &str = "foundry_frontier_sync_portable.zip";

    let local_version = read_local_app_version();

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("foundry-frontier-sync-updater/1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let response = client
        .get(GITHUB_API)
        .send()
        .map_err(|e| format!("GitHub API unreachable: {}", e))?;

    let status = response.status();

    // 404 = repositório sem nenhuma release publicada ainda → sem atualização
    if status == reqwest::StatusCode::NOT_FOUND {
        return Ok(AppUpdateInfo {
            update_available: false,
            local_version: local_version.clone(),
            latest_tag: local_version.clone(),
            download_url: None,
            message: format!("Aplicativo atualizado (v{}).", local_version),
        });
    }

    if !status.is_success() {
        return Err(format!("GitHub API returned HTTP {}", status));
    }


    let release: GhRelease = response
        .json()
        .map_err(|e| format!("GitHub API JSON parse error: {}", e))?;

    let latest_tag = release.tag_name.clone();
    let local_tuple = parse_version_tag(&local_version);
    let latest_tuple = parse_version_tag(&latest_tag);

    let update_available = latest_tuple > local_tuple;

    let download_url = if update_available {
        release.assets.iter()
            .find(|a| a.name == PORTABLE_ASSET)
            .map(|a| a.browser_download_url.clone())
    } else {
        None
    };

    let message = if update_available {
        format!(
            "Nova versão disponível: {} (atual: {})",
            latest_tag, local_version
        )
    } else {
        format!("Aplicativo atualizado (v{}).", local_version)
    };

    Ok(AppUpdateInfo {
        update_available,
        local_version,
        latest_tag,
        download_url,
        message,
    })
}

/// Downloads the portable zip to a temp directory, emitting `app-update-progress` events.
/// Returns the path to the downloaded zip file.
#[tauri::command]
fn download_app_update(window: tauri::Window, download_url: String) -> Result<String, String> {
    let temp_dir = std::env::temp_dir();
    let zip_path = temp_dir.join(format!("ffs_self_update_{}.zip", uuid_dummy()));

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("foundry-frontier-sync-updater/1.0")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let mut response = client
        .get(&download_url)
        .send()
        .map_err(|e| format!("Download failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download HTTP error: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut dest = fs::File::create(&zip_path)
        .map_err(|e| format!("Cannot create temp file: {}", e))?;

    let mut buffer = [0u8; 8192];
    let mut downloaded: u64 = 0;

    loop {
        let n = response
            .read(&mut buffer)
            .map_err(|e| format!("Read error: {}", e))?;
        if n == 0 {
            break;
        }
        dest.write_all(&buffer[..n])
            .map_err(|e| format!("Write error: {}", e))?;
        downloaded += n as u64;
        if total_size > 0 {
            let pct = (downloaded * 100) / total_size;
            let _ = window.emit("app-update-progress", pct);
        }
    }

    Ok(zip_path.to_string_lossy().to_string())
}

/// Launches sync-runner.exe with the required arguments, then exits the main app.
/// The runner helper is expected to be in the same directory as the main executable.
#[tauri::command]
fn launch_sync_runner(
    app_handle: tauri::AppHandle,
    zip_path: String,
    install_dir: String,
    app_exe: String,
) -> Result<(), String> {
    let current_exe = std::env::current_exe()
        .map_err(|e| format!("Cannot get current exe: {}", e))?;
    let exe_dir = current_exe.parent()
        .ok_or("Cannot get exe directory")?;

    let runner_exe = exe_dir.join("sync-runner.exe");
    if !runner_exe.exists() {
        return Err(format!(
            "sync-runner.exe not found at: {}",
            runner_exe.display()
        ));
    }

    // Allow JS to pass empty strings; derive from current_exe() in that case.
    let resolved_install_dir = if install_dir.is_empty() {
        exe_dir.to_string_lossy().to_string()
    } else {
        install_dir
    };
    let resolved_app_exe = if app_exe.is_empty() {
        current_exe.to_string_lossy().to_string()
    } else {
        app_exe
    };

    let current_pid = std::process::id();
    let log_path = dirs_log_path();

    // Se a janela principal não estiver visível (rodando em background),
    // diz ao helper para relançar o aplicativo com as flags de background.
    let mut cmd = Command::new(&runner_exe);
    cmd.arg("--pid").arg(current_pid.to_string())
        .arg("--install-dir").arg(&resolved_install_dir)
        .arg("--zip").arg(&zip_path)
        .arg("--exe").arg(&resolved_app_exe)
        .arg("--log").arg(&log_path);

    let is_visible = if let Some(window) = app_handle.get_window("main") {
        window.is_visible().unwrap_or(true)
    } else {
        true
    };

    if !is_visible {
        cmd.arg("--relaunch-args").arg("--background --tray");
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch sync-runner: {}", e))?;

    // Exit the current app so the runner can replace our files.
    std::process::exit(0);
}

#[derive(Serialize, Deserialize, Debug, Clone)]
struct AppSettings {
    #[serde(rename = "autoStart")]
    auto_start: bool,
}

fn get_settings_path() -> PathBuf {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("FoundryFrontierSync").join("settings.json")
}

fn load_settings() -> AppSettings {
    let path = get_settings_path();
    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(settings) = serde_json::from_str::<AppSettings>(&content) {
                return settings;
            }
        }
    }
    AppSettings { auto_start: true }
}

fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(&path, content).map_err(|e| e.to_string())?;
    Ok(())
}

fn enable_startup(enable: bool) -> Result<(), String> {
    let appdata = std::env::var("APPDATA").map_err(|e| e.to_string())?;
    let startup_lnk_path = Path::new(&appdata)
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("Startup")
        .join("FoundryFrontierSync.lnk");

    if enable {
        let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_path = current_exe.to_string_lossy().to_string();
        let exe_dir = current_exe.parent().ok_or("No parent directory")?.to_string_lossy().to_string();

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let ps_script = format!(
                "$WshShell = New-Object -ComObject WScript.Shell; \
                 $Shortcut = $WshShell.CreateShortcut('{}'); \
                 $Shortcut.TargetPath = '{}'; \
                 $Shortcut.Arguments = '--background --tray'; \
                 $Shortcut.WorkingDirectory = '{}'; \
                 $Shortcut.Save();",
                startup_lnk_path.to_string_lossy().replace("'", "''"),
                exe_path.replace("'", "''"),
                exe_dir.replace("'", "''")
            );

            let output = Command::new("powershell")
                .arg("-NoProfile")
                .arg("-Command")
                .arg(&ps_script)
                .creation_flags(CREATE_NO_WINDOW)
                .output()
                .map_err(|e| format!("Falha ao executar PowerShell: {}", e))?;

            if !output.status.success() {
                let err_msg = String::from_utf8_lossy(&output.stderr);
                return Err(format!("Erro no PowerShell ao criar atalho: {}", err_msg));
            }
        }
    } else {
        if startup_lnk_path.exists() {
            std::fs::remove_file(&startup_lnk_path).map_err(|e| format!("Erro ao remover atalho: {}", e))?;
        }
    }
    Ok(())
}

#[tauri::command]
fn is_auto_start_enabled() -> Result<bool, String> {
    let settings = load_settings();
    Ok(settings.auto_start)
}

#[tauri::command]
fn set_auto_start(app_handle: tauri::AppHandle, enable: bool) -> Result<(), String> {
    let mut settings = load_settings();
    settings.auto_start = enable;
    save_settings(&settings)?;
    enable_startup(enable)?;
    
    // Atualiza o checkmark no menu do tray
    let tray_handle = app_handle.tray_handle();
    let item = tray_handle.get_item("autostart");
    let _ = item.set_selected(enable);
    
    Ok(())
}

#[tauri::command]
fn is_minecraft_running() -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        if let Ok(output) = Command::new("cmd")
            .arg("/c")
            .arg("tasklist /FI \"IMAGENAME eq javaw.exe\" /NH")
            .creation_flags(CREATE_NO_WINDOW)
            .output()
        {
            let stdout = String::from_utf8_lossy(&output.stdout);
            return stdout.contains("javaw.exe");
        }
    }
    false
}

#[tauri::command]
fn show_notification(app_handle: tauri::AppHandle, title: String, body: String) {
    let identifier = app_handle.config().tauri.bundle.identifier.clone();
    let _ = tauri::api::notification::Notification::new(identifier)
        .title(title)
        .body(body)
        .show();
}

fn dirs_log_path() -> String {
    let base = std::env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    base.join("FoundryFrontierSync")
        .join("logs")
        .join("sync-runner.log")
        .to_string_lossy()
        .to_string()
}

fn main() {
    // Clean up any left-over .exe.old files from self-updates
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(dir) = current_exe.parent() {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.extension().map(|ext| ext == "old").unwrap_or(false) {
                        let _ = std::fs::remove_file(path);
                    }
                }
            }
        }
    }

    let settings = load_settings();
    let app_title_item = CustomMenuItem::new("title_header".to_string(), "Foundry & Frontier Sync").disabled();
    let mut autostart_item = CustomMenuItem::new("autostart".to_string(), "Iniciar com o Windows");
    if settings.auto_start {
        autostart_item = autostart_item.selected();
    }

    let tray_menu = SystemTrayMenu::new()
        .add_item(app_title_item)
        .add_native_item(tauri::SystemTrayMenuItem::Separator)
        .add_item(CustomMenuItem::new("show".to_string(), "Abrir"))
        .add_item(autostart_item)
        .add_item(CustomMenuItem::new("quit".to_string(), "Sair"));
    
    let tray_icon = tauri::Icon::Raw(include_bytes!("../icons/icon.ico").to_vec());
    let system_tray = SystemTray::new()
        .with_icon(tray_icon)
        .with_menu(tray_menu)
        .with_tooltip("Foundry & Frontier Sync");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, cwd| {
            // Se outra instância for iniciada, exibe e foca a janela principal existente
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .system_tray(system_tray)
        .on_system_tray_event(|app, event| match event {
            SystemTrayEvent::MenuItemClick { id, .. } => {
                match id.as_str() {
                    "quit" => {
                        std::process::exit(0);
                    }
                    "show" => {
                        if let Some(window) = app.get_window("main") {
                            window.show().unwrap();
                            window.set_focus().unwrap();
                        }
                    }
                    "autostart" => {
                        let mut settings = load_settings();
                        let new_val = !settings.auto_start;
                        settings.auto_start = new_val;
                        let _ = save_settings(&settings);
                        let _ = enable_startup(new_val);

                        // Atualiza checkmark no menu do tray
                        let item = app.tray_handle().get_item("autostart");
                        let _ = item.set_selected(new_val);

                        // Dispara evento para o frontend atualizar o checkbox se aberto
                        let _ = app.emit_all("auto-start-changed", new_val);
                    }
                    _ => {}
                }
            }
            SystemTrayEvent::DoubleClick { .. } => {
                if let Some(window) = app.get_window("main") {
                    window.show().unwrap();
                    window.set_focus().unwrap();
                }
            }
            _ => {}
        })
        .on_window_event(|event| match event.event() {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                event.window().hide().unwrap();
                api.prevent_close();
            }
            _ => {}
        })
        .setup(|app| {
            let args: Vec<String> = std::env::args().collect();
            
            // 1. Verifica se foi iniciado após um update do próprio app
            let after_update = args.iter().any(|arg| arg.to_lowercase() == "--after-update");
            
            let settings_path = get_settings_path();
            let is_first_run = !settings_path.exists();
            let mut settings = load_settings();
            
            if after_update {
                // Força ativação de auto-start após update
                settings.auto_start = true;
                let _ = save_settings(&settings);
                let _ = enable_startup(true);
            } else if is_first_run {
                // Salva a configuração padrão de auto_start = true na primeira execução
                let _ = save_settings(&settings);
                let _ = enable_startup(true);
            } else {
                // Garante que o estado do atalho condiz com as configurações
                let _ = enable_startup(settings.auto_start);
            }

            // 2. Controla visibilidade inicial com base nas flags --background / --tray
            let start_hidden = args.iter().any(|arg| {
                let lower = arg.to_lowercase();
                lower == "--background" || lower == "--tray"
            });
            
            if !start_hidden {
                if let Some(window) = app.get_window("main") {
                    window.show().unwrap();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_instances,
            select_folder_manually,
            check_updates,
            apply_update,
            validate_installation,
            open_folder,
            // U1.3/U1.4 — App self-update
            check_app_update,
            download_app_update,
            launch_sync_runner,
            // Auto-start, process and notification commands
            is_auto_start_enabled,
            set_auto_start,
            is_minecraft_running,
            show_notification
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
