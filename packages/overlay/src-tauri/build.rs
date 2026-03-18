use std::{
    env,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

fn dist_os(target_os: &str) -> &str {
    match target_os {
        "windows" => "windows",
        "macos" => "macos",
        "linux" => "linux",
        other => other,
    }
}

fn dist_arch(target_arch: &str) -> &str {
    match target_arch {
        "x86_64" => "x64",
        "aarch64" => "arm64",
        other => other,
    }
}

fn default_embed_path(manifest_dir: &Path, target_os: &str, target_arch: &str) -> PathBuf {
    let repo = manifest_dir
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .unwrap_or(manifest_dir);
    let server = if target_os == "windows" {
        "opencorvus.exe"
    } else {
        "opencorvus"
    };
    repo.join("packages")
        .join("opencorvus")
        .join("dist")
        .join(format!(
            "opencorvus-{}-{}",
            dist_os(target_os),
            dist_arch(target_arch)
        ))
        .join(server)
}

fn write_embed_module(source: &Path, target_os: &str, out_file: &Path) {
    let server_name = if target_os == "windows" {
        "opencorvus.exe"
    } else {
        "opencorvus"
    };

    if !source.exists() {
        println!(
            "cargo:warning=overlay: embedded opencorvus binary not found at {}",
            source.display()
        );
        fs::write(
            out_file,
            format!(
                "pub const EMBEDDED_SERVER_NAME: &str = {server_name:?};\n\
                 pub const EMBEDDED_SERVER_STAMP: &str = \"missing\";\n\
                 pub const EMBEDDED_SERVER_BYTES: &[u8] = &[];\n"
            ),
        )
        .expect("write embedded_sidecar.rs");
        return;
    }

    let metadata = fs::metadata(source).expect("stat embedded sidecar");
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_secs())
        .unwrap_or(0);
    let stamp = format!("{}-{}", metadata.len(), modified);
    let source_literal = source.to_string_lossy().to_string();

    fs::write(
        out_file,
        format!(
            "pub const EMBEDDED_SERVER_NAME: &str = {server_name:?};\n\
             pub const EMBEDDED_SERVER_STAMP: &str = {stamp:?};\n\
             pub const EMBEDDED_SERVER_BYTES: &[u8] = include_bytes!({source_literal:?});\n"
        ),
    )
    .expect("write embedded_sidecar.rs");
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let embed_path = env::var_os("OPENCORVUS_EMBED_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_embed_path(&manifest_dir, &target_os, &target_arch));
    let out_file = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("embedded_sidecar.rs");

    println!("cargo:rerun-if-env-changed=OPENCORVUS_EMBED_PATH");
    println!("cargo:rerun-if-changed={}", embed_path.display());
    write_embed_module(&embed_path, &target_os, &out_file);

    tauri_build::build()
}
