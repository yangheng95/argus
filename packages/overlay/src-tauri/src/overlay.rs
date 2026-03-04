use serde::{Deserialize, Serialize};
use std::io::{BufRead, BufReader, Write};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

use crate::events;
use crate::manager;

// Fallback logical dimensions used when runtime window size is unavailable.
const OVERLAY_WIDTH: f64 = 420.0;
const OVERLAY_HEIGHT: f64 = 180.0;
// Focus ring center ratio in index.html (#focus top: var(--focus-y))
const FOCUS_Y_RATIO: f64 = 0.74;
// Fallback logical dimensions used when runtime window size is unavailable.
const CONFIRM_WIDTH: f64 = 460.0;
const CONFIRM_HEIGHT: f64 = 220.0;

fn log_result<T, E: std::fmt::Display>(context: &str, result: Result<T, E>) {
    if let Err(error) = result {
        eprintln!("[overlay] {context} failed: {error}");
    }
}

fn window_size(window: &WebviewWindow, fallback_width: f64, fallback_height: f64) -> (f64, f64) {
    let scale = match window.scale_factor() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[overlay] window_size.scale_factor failed: {error}");
            return (fallback_width, fallback_height);
        }
    };
    let size = match window.inner_size() {
        Ok(value) => value,
        Err(error) => {
            eprintln!("[overlay] window_size.inner_size failed: {error}");
            return (fallback_width, fallback_height);
        }
    };
    let logical = size.to_logical::<f64>(scale);
    (logical.width, logical.height)
}

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

#[derive(Deserialize, Serialize, Clone)]
struct DiagnosticPayload {
    event: String,
    ts: Option<u64>,
    available: Option<bool>,
    reason: Option<String>,
    path: Option<String>,
    failures: Option<u32>,
    consecutive_failures: Option<u32>,
    next_retry_at: Option<u64>,
    circuit_open_until: Option<u64>,
    detail: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct HintInput {
    x: i32,
    y: i32,
    action: String,
    label: String,
    status: Option<String>,
}

#[derive(Deserialize)]
struct ConfirmInput {
    id: String,
    x: i32,
    y: i32,
    title: String,
    message: String,
    confirm: Option<String>,
    cancel: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Deserialize)]
struct WindowHighlightInput {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
    label: Option<String>,
    duration_ms: Option<u64>,
}

#[derive(Deserialize)]
struct DiagnosticInput {
    event: String,
    ts: Option<u64>,
    available: Option<bool>,
    reason: Option<String>,
    path: Option<String>,
    failures: Option<u32>,
    consecutive_failures: Option<u32>,
    next_retry_at: Option<u64>,
    circuit_open_until: Option<u64>,
    detail: Option<serde_json::Value>,
}

enum InboundEvent {
    Hint(HintInput),
    Confirm(ConfirmInput),
    WindowHighlight(WindowHighlightInput),
    Diagnostic(DiagnosticInput),
}

fn parse_inbound(line: &str) -> Result<InboundEvent, String> {
    let raw = serde_json::from_str::<serde_json::Value>(line)
        .map_err(|error| format!("invalid json: {error}"))?;
    let kind = raw
        .get("type")
        .and_then(|item| item.as_str())
        .ok_or_else(|| "missing string field `type`".to_string())?;

    match kind {
        item if item == events::MSG_HINT => serde_json::from_value::<HintInput>(raw)
            .map(InboundEvent::Hint)
            .map_err(|error| format!("invalid {} payload: {error}", events::MSG_HINT)),
        item if item == events::MSG_CONFIRM => serde_json::from_value::<ConfirmInput>(raw)
            .map(InboundEvent::Confirm)
            .map_err(|error| format!("invalid {} payload: {error}", events::MSG_CONFIRM)),
        item if item == events::MSG_WINDOW_HIGHLIGHT => serde_json::from_value::<WindowHighlightInput>(raw)
            .map(InboundEvent::WindowHighlight)
            .map_err(|error| format!("invalid {} payload: {error}", events::MSG_WINDOW_HIGHLIGHT)),
        item if item == events::MSG_DIAGNOSTIC => serde_json::from_value::<DiagnosticInput>(raw)
            .map(InboundEvent::Diagnostic)
            .map_err(|error| format!("invalid {} payload: {error}", events::MSG_DIAGNOSTIC)),
        item => Err(format!("unsupported type: {item}")),
    }
}

pub fn position_window(window: WebviewWindow, x: i32, y: i32) {
    log_result(
        "position_window.set_position",
        window.set_position(tauri::LogicalPosition::new(x as f64, y as f64)),
    );
    log_result("position_window.show", window.show());
}

pub fn hide_window(window: WebviewWindow) {
    log_result("hide_window.hide", window.hide());
}

pub fn confirm_reply(window: WebviewWindow, id: String, answer: String) {
    log_result("confirm_reply.hide", window.hide());
    let payload = serde_json::json!({
        "type": events::MSG_CONFIRM_REPLY,
        "id": id,
        "answer": answer,
    });
    println!("{}", payload.to_string());
    log_result("confirm_reply.flush", std::io::stdout().flush());
}

pub fn apply_overlay_window_style(app: &tauri::App) {
    for name in [events::WINDOW_OVERLAY, events::WINDOW_HIGHLIGHT] {
        if let Some(win) = app.get_webview_window(name) {
            log_result("apply_overlay_window_style.set_ignore_cursor_events", win.set_ignore_cursor_events(true));
        }
    }
}

pub fn start_stdin_bridge(app: &tauri::App) {
    let handle: AppHandle = app.handle().clone();
    let exit_on_eof = std::env::var("OPENCORVUS_OVERLAY_STDIN_EXIT")
        .ok()
        .map(|item| item == "1")
        .unwrap_or(false);

    std::thread::spawn(move || {
        let stdin = std::io::stdin();
        for line in BufReader::new(stdin.lock()).lines() {
            match line {
                Ok(l) if !l.trim().is_empty() => {
                    match parse_inbound(&l) {
                        Ok(event) => match event {
                            InboundEvent::Hint(item) => {
                                // All coordinates are logical (DPI-aware) from OpenCorvus.
                                // Position overlay so focus ring center aligns with target.
                                if let Some(window) = handle.get_webview_window(events::WINDOW_OVERLAY) {
                                    let (width, height) = window_size(&window, OVERLAY_WIDTH, OVERLAY_HEIGHT);
                                    let win_x = item.x as f64 - width / 2.0;
                                    let win_y = item.y as f64 - height * FOCUS_Y_RATIO;
                                    log_result(
                                        "stdin_bridge.hint.set_position",
                                        window.set_position(tauri::LogicalPosition::new(win_x, win_y)),
                                    );
                                    log_result("stdin_bridge.hint.show", window.show());
                                }
                                log_result(
                                    "stdin_bridge.hint.emit",
                                    handle.emit(
                                    events::EVT_SHOW_OVERLAY,
                                    ShowPayload {
                                        x: item.x,
                                        y: item.y,
                                        action: item.action,
                                        label: item.label,
                                        status: item.status,
                                    },
                                ),
                                );
                            }
                            InboundEvent::Confirm(item) => {
                                if let Some(window) = handle.get_webview_window(events::WINDOW_CONFIRM) {
                                    let (width, height) = window_size(&window, CONFIRM_WIDTH, CONFIRM_HEIGHT);
                                    log_result(
                                        "stdin_bridge.confirm.set_position",
                                        window.set_position(tauri::LogicalPosition::new(
                                            item.x as f64 - width / 2.0,
                                            item.y as f64 - height / 2.0,
                                        )),
                                    );
                                    log_result("stdin_bridge.confirm.show", window.show());
                                    log_result("stdin_bridge.confirm.set_focus", window.set_focus());
                                }
                                log_result(
                                    "stdin_bridge.confirm.emit",
                                    handle.emit(
                                    events::EVT_SHOW_CONFIRM,
                                    ConfirmPayload {
                                        id: item.id,
                                        x: item.x,
                                        y: item.y,
                                        title: item.title,
                                        message: item.message,
                                        confirm: item.confirm.unwrap_or("Confirm".into()),
                                        cancel: item.cancel.unwrap_or("Cancel".into()),
                                        timeout_ms: item.timeout_ms,
                                    },
                                ),
                                );
                            }
                            InboundEvent::WindowHighlight(item) => {
                                // Coordinates are logical (DPI-aware) — use LogicalSize/LogicalPosition
                                if let Some(window) = handle.get_webview_window(events::WINDOW_HIGHLIGHT) {
                                    const HIGHLIGHT_MIN_SIZE: u32 = 40;
                                    const HIGHLIGHT_MAX_SIZE: u32 = 10000;
                                    let w = (item.width.max(HIGHLIGHT_MIN_SIZE).min(HIGHLIGHT_MAX_SIZE)) as f64;
                                    let h = (item.height.max(HIGHLIGHT_MIN_SIZE).min(HIGHLIGHT_MAX_SIZE)) as f64;
                                    log_result("stdin_bridge.window_highlight.set_size", window.set_size(tauri::LogicalSize::new(w, h)));
                                    log_result(
                                        "stdin_bridge.window_highlight.set_position",
                                        window.set_position(tauri::LogicalPosition::new(item.x as f64, item.y as f64)),
                                    );
                                    log_result("stdin_bridge.window_highlight.show", window.show());
                                    log_result(
                                        "stdin_bridge.window_highlight.emit",
                                        handle.emit_to(
                                            events::WINDOW_HIGHLIGHT,
                                            events::EVT_SHOW_WINDOW_HIGHLIGHT,
                                            WindowHighlightPayload {
                                                label: item.label,
                                                duration_ms: item.duration_ms,
                                            },
                                        ),
                                    );
                                }
                            }
                            InboundEvent::Diagnostic(item) => {
                                let payload = DiagnosticPayload {
                                    event: item.event,
                                    ts: item.ts,
                                    available: item.available,
                                    reason: item.reason,
                                    path: item.path,
                                    failures: item.failures,
                                    consecutive_failures: item.consecutive_failures,
                                    next_retry_at: item.next_retry_at,
                                    circuit_open_until: item.circuit_open_until,
                                    detail: item.detail,
                                };
                                log_result(
                                    "stdin_bridge.diagnostic.emit",
                                    handle.emit_to(
                                        events::WINDOW_CONSOLE,
                                        events::EVT_OVERLAY_DIAGNOSTIC,
                                        payload.clone(),
                                    ),
                                );
                                let shared = handle.state::<manager::Shared>();
                                let level = if payload.available.unwrap_or(false) {
                                    "info"
                                } else {
                                    "warn"
                                };
                                manager::push_log_json(
                                    shared.inner(),
                                    &handle,
                                    level,
                                    "overlay",
                                    format!("overlay diagnostic: {}", payload.event),
                                    serde_json::to_value(payload).ok(),
                                );
                            }
                        },
                        Err(error) => {
                            eprintln!("[overlay] stdin_bridge.parse failed: {error}; line={l}");
                        }
                    }
                }
                Ok(_) => {}
                Err(error) => {
                    eprintln!("[overlay] stdin_bridge.read failed: {error}");
                    break;
                }
            }
        }
        if exit_on_eof {
            std::process::exit(0);
        }
    });
}
