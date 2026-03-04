use std::path::PathBuf;
use std::process::Command;

fn check_protocol() {
    let root_raw = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let root = root_raw.canonicalize().unwrap_or(root_raw);
    let script = root.join("scripts").join("generate-overlay-protocol.ts");
    if !script.exists() {
        panic!(
            "overlay protocol generator is missing: {}",
            script.display()
        );
    }

    let bun = std::env::var("BUN").unwrap_or_else(|_| "bun".into());
    let output = Command::new(&bun)
        .arg("run")
        .arg("scripts/generate-overlay-protocol.ts")
        .arg("--check")
        .current_dir(&root)
        .output();

    match output {
        Ok(value) if value.status.success() => {}
        Ok(value) => {
            let stderr = String::from_utf8_lossy(&value.stderr);
            if stderr.contains("EPERM reading") {
                println!(
                    "cargo:warning=overlay protocol check skipped due bun EPERM; run `bun run scripts/generate-overlay-protocol.ts --check` from repo root"
                );
                return;
            }
            panic!(
                "overlay protocol check failed (status: {}): {}; run `bun run scripts/generate-overlay-protocol.ts`",
                value.status,
                stderr.trim()
            );
        }
        Err(error) => {
            panic!(
                "failed to run overlay protocol check with `{}`: {}; run `bun run scripts/generate-overlay-protocol.ts --check` manually",
                bun,
                error
            );
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=../../../scripts/generate-overlay-protocol.ts");
    println!("cargo:rerun-if-changed=../protocol/schema.json");
    println!("cargo:rerun-if-changed=../src/index.html");
    println!("cargo:rerun-if-changed=../src/index.js");
    println!("cargo:rerun-if-changed=../src/confirm.html");
    println!("cargo:rerun-if-changed=../src/confirm.js");
    println!("cargo:rerun-if-changed=../src/manager.html");
    println!("cargo:rerun-if-changed=../src/manager.js");
    println!("cargo:rerun-if-changed=../src/window-highlight.html");
    println!("cargo:rerun-if-changed=../src/window-highlight.js");
    println!("cargo:rerun-if-changed=../src/protocol.js");
    println!("cargo:rerun-if-changed=../src/tauri-bridge.js");
    println!("cargo:rerun-if-changed=../src/tokens.css");
    println!("cargo:rerun-if-changed=tauri.conf.json");
    check_protocol();
    tauri_build::build()
}
