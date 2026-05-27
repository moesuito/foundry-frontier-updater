fn main() {
    tauri_build::build();

    // Embed an asInvoker application manifest into updater-helper.exe.
    // This prevents Windows Installer Detection from auto-elevating the binary
    // due to "updater" appearing in its name (UAC heuristic).
    // Only runs when Cargo is building the updater-helper binary target.
    #[cfg(target_os = "windows")]
    if std::env::var("CARGO_BIN_NAME").as_deref() == Ok("updater-helper") {
        let mut res = winresource::WindowsResource::new();
        res.set_manifest_file("updater-helper.manifest");
        res.compile().expect("Failed to embed manifest into updater-helper.exe");
    }
}
