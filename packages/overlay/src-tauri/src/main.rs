#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

#[derive(Deserialize, Serialize, Clone)]
struct ShowPayload {
    x: i32,
    y: i32,
    action: String,
    label: String,
    status: Option<String>,
}

#[derive(Deserialize, Serialize, Clone)]
struct ConfirmPayload {
    id: String,
    x: i32,
    y: i32,
    title: String,
    message: String,
    confirm: String,
    cancel: String,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
enum InboundEvent {
    Hint {
        x: i32,
        y: i32,
        action: String,
        label: String,
        status: Option<String>,
    },
    Confirm {
        id: String,
        x: i32,
        y: i32,
        title: String,
        message: String,
        confirm: Option<String>,
        cancel: Option<String>,
        timeout_ms: Option<u64>,
    },
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

#[tauri::command]
fn confirm_reply(window: WebviewWindow, id: String, answer: String) {
    let _ = window.hide();
    let payload = serde_json::json!({
        "type": "confirm-reply",
        "id": id,
        "answer": answer,
    });
    println!("{}", payload.to_string());
    let _ = std::io::stdout().flush();
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![position_window, hide_window, confirm_reply])
        .setup(|app| {
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

            let handle: AppHandle = app.handle().clone();
            std::thread::spawn(move || {
                let stdin = std::io::stdin();
                for line in BufReader::new(stdin.lock()).lines() {
                    match line {
                        Ok(l) if !l.trim().is_empty() => {
                            if let Ok(event) = serde_json::from_str::<InboundEvent>(&l) {
                                match event {
                                    InboundEvent::Hint {
                                        x,
                                        y,
                                        action,
                                        label,
                                        status,
                                    } => {
                                        let _ = handle.emit(
                                            "show-overlay",
                                            ShowPayload {
                                                x,
                                                y,
                                                action,
                                                label,
                                                status,
                                            },
                                        );
                                    }
                                    InboundEvent::Confirm {
                                        id,
                                        x,
                                        y,
                                        title,
                                        message,
                                        confirm,
                                        cancel,
                                        timeout_ms,
                                    } => {
                                        let _ = handle.emit(
                                            "show-confirm",
                                            ConfirmPayload {
                                                id,
                                                x,
                                                y,
                                                title,
                                                message,
                                                confirm: confirm.unwrap_or("Confirm".into()),
                                                cancel: cancel.unwrap_or("Cancel".into()),
                                                timeout_ms,
                                            },
                                        );
                                    }
                                }
                            }
                        }
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
