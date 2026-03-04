use std::path::PathBuf;
use std::process::Command;

fn check_protocol() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("..");
    let script = root.join("scripts").join("generate-overlay-protocol.ts");
    if !script.exists() {
        panic!("overlay protocol generator is missing: {}", script.display());
    }

    let bun = std::env::var("BUN").unwrap_or_else(|_| "bun".into());
    let status = Command::new(&bun)
        .arg("run")
        .arg(&script)
        .arg("--check")
        .current_dir(&root)
        .status();

    match status {
        Ok(code) if code.success() => {}
        Ok(code) => {
            panic!(
                "overlay protocol check failed (status: {code}); run `bun run scripts/generate-overlay-protocol.ts`"
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
