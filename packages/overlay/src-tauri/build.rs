use std::{
    collections::hash_map::DefaultHasher,
    env,
    fs,
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

fn dist_os(target_os: &str) -> &str {
    match target_os {
        "windows" => "windows",
        "macos" => "darwin",
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
    repo.join("packages")
        .join("opencorvus")
        .join("dist")
        .join(format!(
            "opencorvus-overlay-server-{}-{}",
            dist_os(target_os),
            dist_arch(target_arch)
        ))
}

fn node_name(target_os: &str) -> &str {
    if target_os == "windows" {
        "node.exe"
    } else {
        "node"
    }
}

fn collect_payload_files(source: &Path) -> Vec<PathBuf> {
    fn visit(root: &Path, dir: &Path, out: &mut Vec<PathBuf>) {
        let mut entries = fs::read_dir(dir)
            .unwrap_or_else(|e| panic!("read embedded sidecar dir {}: {e}", dir.display()))
            .map(|entry| entry.expect("read embedded sidecar entry").path())
            .collect::<Vec<_>>();
        entries.sort();
        for path in entries {
            if path.is_dir() {
                visit(root, &path, out);
            } else if path.is_file() {
                out.push(path.strip_prefix(root).expect("embedded file under root").to_path_buf());
            }
        }
    }

    if source.is_file() {
        return vec![source.file_name().expect("embedded sidecar file name").into()];
    }

    let mut result = Vec::new();
    visit(source, source, &mut result);
    result
}

fn rel_slash(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn payload_stamp(source: &Path, files: &[PathBuf]) -> String {
    let mut hasher = DefaultHasher::new();
    for rel in files {
        rel_slash(rel).hash(&mut hasher);
        let meta = fs::metadata(source.join(rel)).expect("stat embedded sidecar file");
        meta.len().hash(&mut hasher);
        meta.modified()
            .ok()
            .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
            .map(|value| value.as_secs())
            .unwrap_or(0)
            .hash(&mut hasher);
    }
    format!("{}-{:x}", files.len(), hasher.finish())
}

fn write_embed_module(source: &Path, target_os: &str, out_file: &Path) {
    let server_name = if target_os == "windows" {
        "opencorvus.exe"
    } else {
        "opencorvus"
    };

    if !source.exists() {
        println!(
            "cargo:warning=overlay: embedded opencorvus payload not found at {}",
            source.display()
        );
        fs::write(
            out_file,
            format!(
                "pub const EMBEDDED_SERVER_NAME: &str = {server_name:?};\n\
                 pub const EMBEDDED_SERVER_STAMP: &str = \"missing\";\n\
                 pub struct EmbeddedSidecarFile {{ pub path: &'static str, pub executable: bool, pub bytes: &'static [u8] }}\n\
                 pub const EMBEDDED_SERVER_FILES: &[EmbeddedSidecarFile] = &[];\n"
            ),
        )
        .expect("write embedded_sidecar.rs");
        return;
    }

    let root = if source.is_file() {
        source.parent().expect("embedded sidecar file parent")
    } else {
        source
    };
    let files = collect_payload_files(source);
    let stamp = payload_stamp(root, &files);
    let node = format!("browser-mcp-node/{}", node_name(target_os));
    let entries = files
        .iter()
        .map(|rel| {
            let rel_path = rel_slash(rel);
            let source_literal = root.join(rel).to_string_lossy().to_string();
            let executable = rel_path == server_name || rel_path == node;
            format!(
                "    EmbeddedSidecarFile {{ path: {rel_path:?}, executable: {executable}, bytes: include_bytes!({source_literal:?}) }},\n"
            )
        })
        .collect::<String>();

    fs::write(
        out_file,
        format!(
            "pub const EMBEDDED_SERVER_NAME: &str = {server_name:?};\n\
             pub const EMBEDDED_SERVER_STAMP: &str = {stamp:?};\n\
             pub struct EmbeddedSidecarFile {{ pub path: &'static str, pub executable: bool, pub bytes: &'static [u8] }}\n\
             pub const EMBEDDED_SERVER_FILES: &[EmbeddedSidecarFile] = &[\n\
             {entries}\
             ];\n"
        ),
    )
    .expect("write embedded_sidecar.rs");
}

fn write_server_defaults(manifest_dir: &Path, out_file: &Path) {
    let defaults_path = manifest_dir
        .parent()
        .and_then(Path::parent)
        .map(|p| p.join("opencorvus").join("server-defaults.json"))
        .expect("resolve server-defaults.json");

    let raw = fs::read_to_string(&defaults_path)
        .unwrap_or_else(|e| panic!("read {}: {e}", defaults_path.display()));
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("parse {}: {e}", defaults_path.display()));
    let host = parsed
        .get("host")
        .and_then(|v| v.as_str())
        .unwrap_or_else(|| panic!("missing 'host' in {}", defaults_path.display()))
        .to_string();
    let port = parsed
        .get("port")
        .and_then(|v| v.as_u64())
        .unwrap_or_else(|| panic!("missing 'port' in {}", defaults_path.display()));
    if port > u16::MAX as u64 {
        panic!("port {port} in {} exceeds u16::MAX", defaults_path.display());
    }

    fs::write(
        out_file,
        format!(
            "pub const DEFAULT_SERVER_HOST: &str = {host:?};\n\
             pub const DEFAULT_SERVER_PORT: u16 = {port};\n"
        ),
    )
    .expect("write server_defaults.rs");

    println!("cargo:rerun-if-changed={}", defaults_path.display());
}

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR"));
    let target_os = env::var("CARGO_CFG_TARGET_OS").expect("CARGO_CFG_TARGET_OS");
    let target_arch = env::var("CARGO_CFG_TARGET_ARCH").expect("CARGO_CFG_TARGET_ARCH");
    let embed_path = env::var_os("OPENCORVUS_EMBED_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|| default_embed_path(&manifest_dir, &target_os, &target_arch));
    let out_dir = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR"));
    let embed_out = out_dir.join("embedded_sidecar.rs");
    let defaults_out = out_dir.join("server_defaults.rs");

    println!("cargo:rerun-if-env-changed=OPENCORVUS_EMBED_PATH");
    println!("cargo:rerun-if-changed={}", embed_path.display());
    write_embed_module(&embed_path, &target_os, &embed_out);
    write_server_defaults(&manifest_dir, &defaults_out);

    tauri_build::build()
}
