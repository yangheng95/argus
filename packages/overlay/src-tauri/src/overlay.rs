use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::events;

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

#[derive(Deserialize, Serialize, Clone)]
struct WindowHighlightPayload {
    label: Option<String>,
    duration_ms: Option<u64>,
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
    WindowHighlight {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
        label: Option<String>,
        duration_ms: Option<u64>,
    },
}

pub fn position_window(window: WebviewWindow, x: i32, y: i32) {
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = window.show();
}

pub fn hide_window(window: WebviewWindow) {
    let _ = window.hide();
}

pub fn confirm_reply(window: WebviewWindow, id: String, answer: String) {
    let _ = window.hide();
    let payload = serde_json::json!({
        "type": "confirm-reply",
        "id": id,
        "answer": answer,
    });
    println!("{}", payload.to_string());
    let _ = std::io::stdout().flush();
}

pub fn apply_overlay_window_style(app: &tauri::App) {
    #[cfg(target_os = "windows")]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::*;
        for name in [events::WINDOW_OVERLAY, events::WINDOW_HIGHLIGHT] {
            let Some(win) = app.get_webview_window(name) else {
                continue;
            };
            let Ok(hwnd) = win.hwnd() else {
                continue;
            };
            let raw = hwnd.0 as *mut std::ffi::c_void;
            unsafe {
                let style = GetWindowLongPtrW(raw, GWL_EXSTYLE);
                SetWindowLongPtrW(
                    raw,
                    GWL_EXSTYLE,
                    style | WS_EX_LAYERED as isize | WS_EX_TRANSPARENT as isize | WS_EX_NOACTIVATE as isize,
                );
            }
        }
    }
}

pub fn start_stdin_bridge(app: &tauri::App) {
    let handle: AppHandle = app.handle().clone();
    let exit_on_eof = std::env::var("ARGUS_OVERLAY_STDIN_EXIT")
        .ok()
        .map(|item| item == "1")
        .unwrap_or(false);

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
                                    events::EVT_SHOW_OVERLAY,
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
                                    events::EVT_SHOW_CONFIRM,
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
                            InboundEvent::WindowHighlight {
                                x,
                                y,
                                width,
                                height,
                                label,
                                duration_ms,
                            } => {
                                if let Some(window) = handle.get_webview_window(events::WINDOW_HIGHLIGHT) {
                                    let w = width.max(40).min(10000);
                                    let h = height.max(40).min(10000);
                                    let _ = window.set_size(tauri::PhysicalSize::new(w, h));
                                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                                    let _ = window.show();
                                    let _ = handle.emit_to(
                                        events::WINDOW_HIGHLIGHT,
                                        events::EVT_SHOW_WINDOW_HIGHLIGHT,
                                        WindowHighlightPayload { label, duration_ms },
                                    );
                                }
                            }
                        }
                    }
                }
                _ => break,
            }
        }
        if exit_on_eof {
            std::process::exit(0);
        }
    });
}
