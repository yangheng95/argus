fn main() {
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
    tauri_build::build()
}
