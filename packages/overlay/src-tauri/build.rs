use std::{
    collections::hash_map::DefaultHasher,
    env,
    fs::{self, File},
    hash::{Hash, Hasher},
    io,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use flate2::{write::GzEncoder, Compression};
use tar::{Builder, Header};

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
                out.push(
                    path.strip_prefix(root)
                        .expect("embedded file under root")
                        .to_path_buf(),
                );
            }
        }
    }

    if source.is_file() {
        return vec![source
            .file_name()
            .expect("embedded sidecar file name")
            .into()];
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

fn plugin_resource_os_key(target_os: &str) -> &str {
    match target_os {
        "windows" => "win32",
        "macos" => "darwin",
        "linux" => "linux",
        other => other,
    }
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

fn payload_executable(
    rel_path: &str,
    server_name: &str,
    node: &str,
    plugin_resources: &[String],
) -> bool {
    rel_path == server_name
        || rel_path == node
        || plugin_resources
            .iter()
            .any(|path| path == rel_path && path.contains("worker"))
}

fn plugin_manifest_resource_path<'a>(
    manifest: &Path,
    target_os: &str,
    resource: &'a serde_json::Value,
) -> &'a str {
    if let Some(paths) = resource.get("paths").and_then(|value| value.as_object()) {
        return paths
            .get(plugin_resource_os_key(target_os))
            .and_then(|value| value.as_str())
            .unwrap_or_else(|| {
                panic!(
                    "plugin manifest {} has a resource without path for {}",
                    manifest.display(),
                    plugin_resource_os_key(target_os)
                )
            });
    }
    resource
        .get("path")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| {
            panic!(
                "plugin manifest {} has a resource without string path",
                manifest.display()
            )
        })
}

fn collect_plugin_resource_files(root: &Path, files: &[PathBuf], target_os: &str) -> Vec<String> {
    let mut result = Vec::new();
    for rel in files {
        let rel_path = rel_slash(rel);
        if !(rel_path.starts_with("plugins/") && rel_path.ends_with("/plugin.json")) {
            continue;
        }
        result.push(rel_path);
        let raw = fs::read_to_string(root.join(rel)).unwrap_or_else(|e| {
            panic!(
                "read embedded plugin manifest {}: {e}",
                root.join(rel).display()
            )
        });
        let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap_or_else(|e| {
            panic!(
                "parse embedded plugin manifest {}: {e}",
                root.join(rel).display()
            )
        });
        let resources = parsed
            .get("resources")
            .and_then(|value| value.as_array())
            .unwrap_or_else(|| {
                panic!(
                    "plugin manifest {} must contain resources[]",
                    root.join(rel).display()
                )
            });
        for resource in resources {
            let path = plugin_manifest_resource_path(&root.join(rel), target_os, resource);
            if !root.join(path).is_file() {
                panic!(
                    "plugin manifest {} references missing embedded resource {}",
                    root.join(rel).display(),
                    path
                );
            }
            result.push(path.to_string());
        }
    }
    result.sort();
    result.dedup();
    result
}

fn write_payload_archive(source: &Path, files: &[PathBuf], target_os: &str, archive_file: &Path) {
    let server_name = if target_os == "windows" {
        "opencorvus.exe"
    } else {
        "opencorvus"
    };
    let node = format!("browser-mcp-node/{}", node_name(target_os));
    let plugin_resources = collect_plugin_resource_files(source, files, target_os);
    let archive = File::create(archive_file).expect("create embedded sidecar archive");
    let encoder = GzEncoder::new(archive, Compression::fast());
    let mut builder = Builder::new(encoder);

    for rel in files {
        let src = source.join(rel);
        let rel_path = rel_slash(rel);
        let mut input = File::open(&src)
            .unwrap_or_else(|e| panic!("open embedded sidecar file {}: {e}", src.display()));
        let meta = input
            .metadata()
            .unwrap_or_else(|e| panic!("stat embedded sidecar file {}: {e}", src.display()));
        let mut header = Header::new_gnu();
        header.set_size(meta.len());
        header.set_mode(
            if payload_executable(&rel_path, server_name, &node, &plugin_resources) {
                0o755
            } else {
                0o644
            },
        );
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(UNIX_EPOCH) {
                header.set_mtime(duration.as_secs());
            }
        }
        header.set_cksum();
        builder
            .append_data(&mut header, rel_path, &mut input)
            .expect("append embedded sidecar file to archive");
    }

    let encoder = builder.into_inner().expect("finish embedded sidecar tar");
    encoder.finish().expect("finish embedded sidecar gzip");
}

fn read_stamp(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn copy_if_exists(source: &Path, destination: &Path) -> io::Result<bool> {
    if !source.is_file() {
        return Ok(false);
    }
    fs::copy(source, destination)?;
    Ok(true)
}

fn matching_cached_archive(current_out_dir: &Path, stamp: &str) -> Option<PathBuf> {
    let build_root = current_out_dir.parent()?.parent()?;
    let entries = fs::read_dir(build_root).ok()?;
    for entry in entries.flatten() {
        let candidate_out = entry.path().join("out");
        if candidate_out == current_out_dir {
            continue;
        }
        let stamp_file = candidate_out.join("embedded_sidecar.stamp");
        if read_stamp(&stamp_file).as_deref() != Some(stamp) {
            continue;
        }
        let archive = candidate_out.join("embedded_sidecar.tar.gz");
        if archive.is_file() {
            return Some(archive);
        }
    }
    None
}

fn ensure_payload_archive(
    source: &Path,
    files: &[PathBuf],
    target_os: &str,
    archive_file: &Path,
    stamp_file: &Path,
    stamp: &str,
) {
    if archive_file.is_file() && read_stamp(stamp_file).as_deref() == Some(stamp) {
        return;
    }

    if let Some(cached) = matching_cached_archive(
        archive_file
            .parent()
            .expect("embedded sidecar archive parent"),
        stamp,
    ) {
        copy_if_exists(&cached, archive_file).expect("copy cached embedded sidecar archive");
    } else {
        write_payload_archive(source, files, target_os, archive_file);
    }
    fs::write(stamp_file, format!("{stamp}\n")).expect("write embedded sidecar archive stamp");
}

fn write_embed_module(source: &Path, target_os: &str, out_file: &Path, archive_file: &Path) {
    let server_name = if target_os == "windows" {
        "opencorvus.exe"
    } else {
        "opencorvus"
    };

    if !source.exists() {
        panic!(
            "embedded opencorvus payload not found at {}; build the overlay-server artifact first",
            source.display()
        );
    }

    let root = if source.is_file() {
        source.parent().expect("embedded sidecar file parent")
    } else {
        source
    };
    let files = collect_payload_files(source);
    let stamp = payload_stamp(root, &files);
    let stamp_file = archive_file.with_file_name("embedded_sidecar.stamp");
    let node = format!("browser-mcp-node/{}", node_name(target_os));
    let plugin_resources = collect_plugin_resource_files(root, &files, target_os);
    let plugin_resource_entries = plugin_resources
        .iter()
        .map(|path| format!("    {path:?},\n"))
        .collect::<String>();
    ensure_payload_archive(root, &files, target_os, archive_file, &stamp_file, &stamp);
    let entries = files
        .iter()
        .map(|rel| {
            let rel_path = rel_slash(rel);
            let executable = payload_executable(&rel_path, server_name, &node, &plugin_resources);
            let size = fs::metadata(root.join(rel))
                .expect("stat embedded sidecar file")
                .len();
            format!(
                "    EmbeddedSidecarFile {{ path: {rel_path:?}, executable: {executable}, size: {size} }},\n"
            )
        })
        .collect::<String>();
    let archive_literal = archive_file.to_string_lossy().to_string();

    fs::write(
        out_file,
        format!(
            "pub const EMBEDDED_SERVER_NAME: &str = {server_name:?};\n\
             pub const EMBEDDED_SERVER_STAMP: &str = {stamp:?};\n\
             pub const EMBEDDED_SERVER_ARCHIVE_GZ: &[u8] = include_bytes!({archive_literal:?});\n\
             pub struct EmbeddedSidecarFile {{ pub path: &'static str, pub executable: bool, pub size: u64 }}\n\
             pub const EMBEDDED_SERVER_FILES: &[EmbeddedSidecarFile] = &[\n\
             {entries}\
             ];\n\
             pub const EMBEDDED_PLUGIN_RESOURCE_FILES: &[&str] = &[\n\
             {plugin_resource_entries}\
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
        panic!(
            "port {port} in {} exceeds u16::MAX",
            defaults_path.display()
        );
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
    let archive_out = out_dir.join("embedded_sidecar.tar.gz");
    let defaults_out = out_dir.join("server_defaults.rs");

    println!("cargo:rerun-if-env-changed=OPENCORVUS_EMBED_PATH");
    println!("cargo:rerun-if-changed={}", embed_path.display());
    if embed_path.exists() {
        let root = if embed_path.is_file() {
            embed_path
                .parent()
                .expect("embedded sidecar file parent")
                .to_path_buf()
        } else {
            embed_path.clone()
        };
        for rel in collect_payload_files(&embed_path) {
            println!("cargo:rerun-if-changed={}", root.join(rel).display());
        }
    }
    write_embed_module(&embed_path, &target_os, &embed_out, &archive_out);
    write_server_defaults(&manifest_dir, &defaults_out);

    tauri_build::build()
}
