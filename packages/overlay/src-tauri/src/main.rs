#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Deserialize, Serialize, Clone)]
struct ShowPayload {
    x: i32,
    y: i32,
    action: String,
    label: String,
}

#[tauri::command]
fn position_window(window: WebviewWindow, x: i32, y: i32) {
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = window.show();
}

#[tauri::command]
fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![position_window, hide_window])
        .setup(|app| {
            // Windows: set WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_NOACTIVATE
            // so the overlay never captures mouse or keyboard input
            #[cfg(target_os = "windows")]
            {
                use windows_sys::Win32::UI::WindowsAndMessaging::*;
                let win = app.get_webview_window("overlay").unwrap();
                let hwnd = win.hwnd().unwrap().0 as *mut std::ffi::c_void;
                unsafe {
                    let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                    SetWindowLongPtrW(
                        hwnd,
                        GWL_EXSTYLE,
                        style | WS_EX_LAYERED as isize | WS_EX_TRANSPARENT as isize | WS_EX_NOACTIVATE as isize,
                    );
                }
            }

            // Background thread: read JSON lines from stdin → emit Tauri events to frontend
            let handle: AppHandle = app.handle().clone();
            std::thread::spawn(move || {
                let stdin = std::io::stdin();
                for line in BufReader::new(stdin.lock()).lines() {
                    match line {
                        Ok(l) if !l.trim().is_empty() => {
                            if let Ok(p) = serde_json::from_str::<ShowPayload>(&l) {
                                let _ = handle.emit("show-overlay", p);
                            }
                        }
                        // EOF or error → parent process exited, shut down
                        _ => break,
                    }
                }
                std::process::exit(0);
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
