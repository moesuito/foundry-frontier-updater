fn main() {
    tauri_build::build();

    // Embed an asInvoker application manifest into sync-runner.exe.
    // This prevents Windows Installer Detection from auto-elevating the binary.
    // Only runs when Cargo is building the sync-runner binary target.
    #[cfg(target_os = "windows")]
    if std::env::var("CARGO_BIN_NAME").as_deref() == Ok("sync-runner") {
        let mut res = winresource::WindowsResource::new();
        res.set_manifest_file("sync-runner.manifest");
        res.compile().expect("Failed to embed manifest into sync-runner.exe");
    }
}
