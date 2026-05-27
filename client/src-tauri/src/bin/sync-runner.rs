// sync-runner.rs
// Foundry & Frontier Sync -- app self-update helper
//
// This binary is launched by the main app before it exits. It:
//   1. Waits for the main app process to exit.
//   2. Validates all paths (no Z:\, no `server` folder, no path traversal).
//   3. Creates a backup of the current install directory.
//   4. Extracts the downloaded portable zip into the install directory.
//   5. Verifies the new executable and version.json exist.
//   6. Relaunches the app.
//   7. Logs all steps to %LOCALAPPDATA%\FoundryFrontierSync\logs\sync-runner.log
//
// Usage:
//   sync-runner.exe --pid <PID> --install-dir <DIR> --zip <PATH> --exe <EXE> [--log <PATH>]
//
// NOTE: This is a console subsystem binary (no windows_subsystem = "windows").
// It must attach to a console so callers can capture the exit code.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, SystemTime, UNIX_EPOCH};


fn main() {
    let args: Vec<String> = env::args().collect();
    let parsed = match parse_args(&args) {
        Ok(a) => a,
        Err(e) => {
            eprintln!("sync-runner: argument error: {}", e);
            std::process::exit(2);
        }
    };

    // Determine log path
    let log_path = parsed.log_path.clone().unwrap_or_else(|| {
        default_log_path()
    });

    // Ensure log directory exists
    if let Some(parent) = log_path.parent() {
        let _ = fs::create_dir_all(parent);
    }

    let mut logger = Logger::new(&log_path);
    logger.log("=== Foundry & Frontier Sync — sync-runner started ===");
    logger.log(&format!("  PID to wait for : {}", parsed.target_pid));
    logger.log(&format!("  Install dir     : {}", parsed.install_dir.display()));
    logger.log(&format!("  Zip path        : {}", parsed.zip_path.display()));
    logger.log(&format!("  Relaunch exe    : {}", parsed.app_exe.display()));
    logger.log(&format!("  Log path        : {}", log_path.display()));

    // --- Step 1: Validate paths ---
    if let Err(e) = validate_paths(&parsed) {
        logger.log(&format!("[ERROR] Path validation failed: {}", e));
        std::process::exit(1);
    }
    logger.log("[OK] Path validation passed.");

    // --- Step 2: Wait for main app to exit ---
    logger.log(&format!("[WAIT] Waiting for PID {} to exit...", parsed.target_pid));
    wait_for_pid(parsed.target_pid, Duration::from_secs(60), &mut logger);

    // --- Step 3: Backup current install ---
    let backup_dir = backup_install_dir(&parsed.install_dir, &mut logger);
    if let Some(ref bd) = backup_dir {
        logger.log(&format!("[BACKUP] Backed up to: {}", bd.display()));
    }

    // --- Step 4: Extract zip ---
    logger.log("[EXTRACT] Extracting portable zip...");
    if let Err(e) = extract_portable_zip(&parsed.zip_path, &parsed.install_dir, &mut logger) {
        logger.log(&format!("[ERROR] Extraction failed: {}", e));
        // Attempt to restore backup
        if let Some(ref bd) = backup_dir {
            logger.log("[RESTORE] Attempting to restore backup...");
            let _ = restore_backup(bd, &parsed.install_dir, &mut logger);
        }
        std::process::exit(1);
    }
    logger.log("[OK] Extraction complete.");

    // --- Step 5: Verify new exe and version.json ---
    if let Err(e) = verify_update(&parsed.app_exe, &parsed.install_dir, &mut logger) {
        logger.log(&format!("[ERROR] Verification failed: {}", e));
        std::process::exit(1);
    }
    logger.log("[OK] Verification passed.");

    // --- Step 6: Relaunch ---
    logger.log(&format!("[LAUNCH] Relaunching: {}", parsed.app_exe.display()));
    if let Err(e) = relaunch_app(&parsed.app_exe, &mut logger) {
        logger.log(&format!("[ERROR] Relaunch failed: {}", e));
        std::process::exit(1);
    }

    logger.log("[DONE] sync-runner finished successfully.");
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

struct ParsedArgs {
    target_pid: u32,
    install_dir: PathBuf,
    zip_path: PathBuf,
    app_exe: PathBuf,
    log_path: Option<PathBuf>,
}

fn parse_args(args: &[String]) -> Result<ParsedArgs, String> {
    let mut pid: Option<u32> = None;
    let mut install_dir: Option<PathBuf> = None;
    let mut zip_path: Option<PathBuf> = None;
    let mut app_exe: Option<PathBuf> = None;
    let mut log_path: Option<PathBuf> = None;

    let mut i = 1;
    while i < args.len() {
        match args[i].as_str() {
            "--pid" => {
                i += 1;
                pid = Some(args.get(i).ok_or("--pid requires a value")?.parse::<u32>()
                    .map_err(|_| "--pid must be a positive integer")?);
            }
            "--install-dir" => {
                i += 1;
                install_dir = Some(PathBuf::from(args.get(i).ok_or("--install-dir requires a value")?));
            }
            "--zip" => {
                i += 1;
                zip_path = Some(PathBuf::from(args.get(i).ok_or("--zip requires a value")?));
            }
            "--exe" => {
                i += 1;
                app_exe = Some(PathBuf::from(args.get(i).ok_or("--exe requires a value")?));
            }
            "--log" => {
                i += 1;
                log_path = Some(PathBuf::from(args.get(i).ok_or("--log requires a value")?));
            }
            other => {
                return Err(format!("Unknown argument: {}", other));
            }
        }
        i += 1;
    }

    Ok(ParsedArgs {
        target_pid: pid.ok_or("--pid is required")?,
        install_dir: install_dir.ok_or("--install-dir is required")?,
        zip_path: zip_path.ok_or("--zip is required")?,
        app_exe: app_exe.ok_or("--exe is required")?,
        log_path,
    })
}

// ---------------------------------------------------------------------------
// Path validation
// ---------------------------------------------------------------------------

/// Returns true if the given path is on the Z: drive (production server share).
fn is_z_drive(path: &Path) -> bool {
    if let Some(s) = path.to_str() {
        let lower = s.to_lowercase();
        // Match Z:\ or Z:/ at the start
        if lower.starts_with("z:\\") || lower.starts_with("z:/") {
            return true;
        }
    }
    false
}

/// Returns true if any component of the path is named exactly "server"
/// (case-insensitive), as a safety guard against the protected server container.
fn contains_server_component(path: &Path) -> bool {
    for component in path.components() {
        if let Some(s) = component.as_os_str().to_str() {
            if s.to_lowercase() == "server" {
                return true;
            }
        }
    }
    false
}

fn validate_paths(args: &ParsedArgs) -> Result<(), String> {
    // Check raw (pre-canonicalize) paths for Z:\ and server component first,
    // so we reject even if the path doesn't exist yet.
    if is_z_drive(&args.install_dir) {
        return Err(format!("Install dir is on Z:\\ (production share) - refusing: {}", args.install_dir.display()));
    }
    if contains_server_component(&args.install_dir) {
        return Err(format!("Install dir contains a 'server' folder component - refusing: {}", args.install_dir.display()));
    }
    if is_z_drive(&args.app_exe) {
        return Err(format!("App exe is on Z:\\ - refusing: {}", args.app_exe.display()));
    }
    if contains_server_component(&args.app_exe) {
        return Err(format!("App exe path contains 'server' component - refusing: {}", args.app_exe.display()));
    }

    // zip_path must exist
    if !args.zip_path.exists() {
        return Err(format!("Zip path does not exist: {}", args.zip_path.display()));
    }
    if is_z_drive(&args.zip_path) {
        return Err(format!("Zip path is on Z:\\ - refusing: {}", args.zip_path.display()));
    }

    // Also canonicalize install_dir for additional safety if it already exists
    if args.install_dir.exists() {
        let install_dir = args.install_dir.canonicalize()
            .map_err(|e| format!("Cannot resolve install_dir '{}': {}", args.install_dir.display(), e))?;
        if is_z_drive(&install_dir) {
            return Err(format!("Install dir is on Z:\\ (production share) - refusing: {}", install_dir.display()));
        }
        if contains_server_component(&install_dir) {
            return Err(format!("Install dir contains a 'server' folder component - refusing: {}", install_dir.display()));
        }
    }

    Ok(())
}



// ---------------------------------------------------------------------------
// Wait for PID
// ---------------------------------------------------------------------------

fn wait_for_pid(pid: u32, timeout: Duration, logger: &mut Logger) {
    use std::time::Instant;
    let start = Instant::now();

    loop {
        if !is_pid_running(pid) {
            logger.log(&format!("[WAIT] PID {} has exited.", pid));
            return;
        }
        if start.elapsed() > timeout {
            logger.log(&format!("[WARN] Timeout waiting for PID {} — proceeding anyway.", pid));
            return;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(windows)]
fn is_pid_running(pid: u32) -> bool {
    // Use OpenProcess with SYNCHRONIZE (0x00100000) and check if handle is valid
    // If OpenProcess succeeds but GetExitCodeProcess returns STILL_ACTIVE (259), it's running.
    unsafe {
        let handle = winapi_open_process(0x00100000 | 0x00000400, 0, pid);
        if handle.is_null() {
            return false;
        }
        let mut exit_code: u32 = 0;
        let ok = winapi_get_exit_code_process(handle, &mut exit_code);
        winapi_close_handle(handle);
        if ok == 0 {
            return false;
        }
        // STILL_ACTIVE = 259
        exit_code == 259
    }
}

#[cfg(not(windows))]
fn is_pid_running(pid: u32) -> bool {
    // On non-Windows: try sending signal 0
    unsafe { libc::kill(pid as i32, 0) == 0 }
}

// Thin wrappers to avoid a full winapi dependency — use raw FFI
#[cfg(windows)]
extern "system" {
    fn OpenProcess(dwDesiredAccess: u32, bInheritHandle: i32, dwProcessId: u32) -> *mut std::ffi::c_void;
    fn GetExitCodeProcess(hProcess: *mut std::ffi::c_void, lpExitCode: *mut u32) -> i32;
    fn CloseHandle(hObject: *mut std::ffi::c_void) -> i32;
}

#[cfg(windows)]
unsafe fn winapi_open_process(access: u32, inherit: i32, pid: u32) -> *mut std::ffi::c_void {
    OpenProcess(access, inherit, pid)
}

#[cfg(windows)]
unsafe fn winapi_get_exit_code_process(handle: *mut std::ffi::c_void, exit_code: *mut u32) -> i32 {
    GetExitCodeProcess(handle, exit_code)
}

#[cfg(windows)]
unsafe fn winapi_close_handle(handle: *mut std::ffi::c_void) -> i32 {
    CloseHandle(handle)
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

fn backup_install_dir(install_dir: &Path, logger: &mut Logger) -> Option<PathBuf> {
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let backup_dir = install_dir.parent()
        .unwrap_or(install_dir)
        .join(format!("FoundryFrontierSync_backup_{}", ts));

    if let Err(e) = copy_dir_recursive(install_dir, &backup_dir) {
        logger.log(&format!("[WARN] Backup failed (non-fatal): {}", e));
        return None;
    }
    Some(backup_dir)
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    if !src.exists() {
        return Ok(());
    }
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else {
            if let Err(e) = fs::copy(&src_path, &dst_path) {
                // If it fails on Windows because the file is locked/running, skip it (non-fatal for helper exe)
                let is_helper = src_path.file_name()
                    .map(|name| {
                        let lower = name.to_string_lossy().to_lowercase();
                        lower == "sync-runner.exe" || lower == "updater-helper.exe"
                    })
                    .unwrap_or(false);
                if !is_helper {
                    return Err(e);
                }
            }
        }
    }
    Ok(())
}

fn safe_clean_install_dir(dir: &Path, logger: &mut Logger) -> io::Result<()> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let _ = safe_clean_install_dir(&path, logger);
            let _ = fs::remove_dir(&path); // Might fail if it contains the running exe
        } else {
            let is_helper = path.file_name()
                .map(|name| {
                    let lower = name.to_string_lossy().to_lowercase();
                    lower == "sync-runner.exe" || lower == "updater-helper.exe" || lower.ends_with(".old")
                })
                .unwrap_or(false);
            if is_helper {
                continue;
            }
            if let Err(e) = fs::remove_file(&path) {
                logger.log(&format!("[WARN] Restore failed to remove file {}: {}", path.display(), e));
            }
        }
    }
    Ok(())
}

fn restore_backup(backup_dir: &Path, install_dir: &Path, logger: &mut Logger) -> io::Result<()> {
    logger.log(&format!("[RESTORE] Restoring from backup: {}", backup_dir.display()));
    if install_dir.exists() {
        if let Err(e) = safe_clean_install_dir(install_dir, logger) {
            logger.log(&format!("[WARN] Clean install dir error: {}", e));
        }
    }
    copy_dir_recursive(backup_dir, install_dir)?;
    logger.log("[RESTORE] Restore complete.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Zip extraction (zip-slip safe)
// ---------------------------------------------------------------------------

fn extract_portable_zip(zip_path: &Path, install_dir: &Path, logger: &mut Logger) -> Result<(), String> {
    let file = fs::File::open(zip_path)
        .map_err(|e| format!("Cannot open zip: {}", e))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Corrupt zip: {}", e))?;

    // Canonicalize install_dir (must exist or be created)
    fs::create_dir_all(install_dir)
        .map_err(|e| format!("Cannot create install dir: {}", e))?;
    let install_canonical = install_dir.canonicalize()
        .map_err(|e| format!("Cannot canonicalize install dir: {}", e))?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i)
            .map_err(|e| format!("Zip read error at index {}: {}", i, e))?;

        // enclosed_name() strips leading / and .. components
        let entry_name = match entry.enclosed_name() {
            Some(n) => n.to_path_buf(),
            None => {
                logger.log(&format!("[SKIP] Skipping potentially unsafe zip entry: {}", entry.name()));
                continue;
            }
        };

        // Strip the top-level FoundryFrontierSync\ folder from the zip path
        // so files land directly in install_dir
        let stripped = strip_top_level_folder(&entry_name);
        if stripped.as_os_str().is_empty() {
            // This was the top-level folder itself — skip
            continue;
        }

        let outpath = install_canonical.join(&stripped);

        // Zip-slip check: resolved path must start with install_canonical
        let outpath_canonical = match outpath.parent() {
            Some(parent) => {
                // Create parent dirs first, then we can canonicalize
                fs::create_dir_all(parent)
                    .map_err(|e| format!("Cannot create dir {}: {}", parent.display(), e))?;
                parent.canonicalize()
                    .map_err(|e| format!("Cannot canonicalize {}: {}", parent.display(), e))?
                    .join(outpath.file_name().unwrap_or_default())
            }
            None => outpath.clone(),
        };

        if !outpath_canonical.starts_with(&install_canonical) {
            return Err(format!(
                "Zip-slip detected! Entry '{}' would write outside install dir.",
                entry.name()
            ));
        }

        if entry.is_dir() {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Cannot create dir {}: {}", outpath.display(), e))?;
        } else {
            #[cfg(target_os = "windows")]
            {
                if outpath.exists() {
                    let is_helper = outpath.file_name()
                        .map(|name| {
                            let lower = name.to_string_lossy().to_lowercase();
                            lower == "sync-runner.exe" || lower == "updater-helper.exe"
                        })
                        .unwrap_or(false);
                    if is_helper {
                        let old_path = outpath.with_extension("exe.old");
                        let _ = fs::remove_file(&old_path);
                        if let Err(e) = fs::rename(&outpath, &old_path) {
                            logger.log(&format!("[WARN] Failed to rename helper '{}' to '{}': {}", outpath.display(), old_path.display(), e));
                        } else {
                            logger.log(&format!("[OK] Renamed running helper to '{}' to allow overwrite", old_path.display()));
                        }
                    }
                }
            }

            let mut outfile = fs::File::create(&outpath)
                .map_err(|e| format!("Cannot create file {}: {}", outpath.display(), e))?;
            io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Write error for {}: {}", outpath.display(), e))?;
            logger.log(&format!("  Extracted: {}", stripped.display()));
        }
    }
    Ok(())
}

/// Strips the first path component (e.g., `FoundryFrontierSync\`) from a path,
/// so zip contents land directly in the install directory.
fn strip_top_level_folder(path: &Path) -> PathBuf {
    let mut components = path.components();
    components.next(); // skip first component
    components.as_path().to_path_buf()
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

fn verify_update(app_exe: &Path, install_dir: &Path, logger: &mut Logger) -> Result<(), String> {
    // The new exe should be in the install_dir
    if !app_exe.exists() {
        // Try to find it in install_dir
        let exe_name = app_exe.file_name()
            .ok_or("Cannot determine exe filename")?;
        let candidate = install_dir.join(exe_name);
        if !candidate.exists() {
            return Err(format!(
                "New executable not found at '{}' or '{}'",
                app_exe.display(),
                candidate.display()
            ));
        }
        logger.log(&format!("[OK] Exe found at: {}", candidate.display()));
    } else {
        logger.log(&format!("[OK] Exe found at: {}", app_exe.display()));
    }

    // version.json must exist in install_dir
    let version_json = install_dir.join("version.json");
    if !version_json.exists() {
        return Err(format!(
            "version.json not found in install dir: {}",
            install_dir.display()
        ));
    }
    logger.log("[OK] version.json found.");
    Ok(())
}

// ---------------------------------------------------------------------------
// Relaunch
// ---------------------------------------------------------------------------

fn relaunch_app(app_exe: &Path, logger: &mut Logger) -> Result<(), String> {
    // Try the exe as given; if not found, look in parent directory
    let resolved_exe = if app_exe.exists() {
        app_exe.to_path_buf()
    } else if let Some(parent) = app_exe.parent() {
        let name = app_exe.file_name().unwrap_or_default();
        let candidate = parent.join(name);
        if candidate.exists() {
            candidate
        } else {
            return Err(format!("Cannot find exe to relaunch: {}", app_exe.display()));
        }
    } else {
        return Err(format!("Cannot find exe to relaunch: {}", app_exe.display()));
    };

    logger.log(&format!("[LAUNCH] Starting: {}", resolved_exe.display()));

    Command::new(&resolved_exe)
        .spawn()
        .map_err(|e| format!("Failed to launch '{}': {}", resolved_exe.display(), e))?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

struct Logger {
    path: PathBuf,
}

impl Logger {
    fn new(path: &Path) -> Self {
        Self { path: path.to_path_buf() }
    }

    fn log(&mut self, message: &str) {
        let ts = chrono_simple();
        let line = format!("[{}] {}\n", ts, message);
        // Append to file
        if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(&self.path) {
            let _ = file.write_all(line.as_bytes());
        }
        // Also print to stderr for debugging
        eprint!("{}", line);
    }
}

fn chrono_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    // Basic ISO-like format from epoch seconds (UTC)
    let s = secs % 86400;
    let h = s / 3600;
    let m = (s % 3600) / 60;
    let sec = s % 60;
    format!("{:02}:{:02}:{:02}Z", h, m, sec)
}

fn default_log_path() -> PathBuf {
    let base = env::var("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| env::temp_dir());
    base.join("FoundryFrontierSync").join("logs").join("sync-runner.log")
}
