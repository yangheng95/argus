// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

struct Server(Mutex<Option<Child>>);

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlaySettings {
    server_url: Option<String>,
    password: Option<String>,
    username: Option<String>,
    executor: Option<String>,
    init_git: Option<bool>,
    always_on_top: Option<bool>,
    sidebar_width: Option<u32>,
    sections_width: Option<u32>,
    theme: Option<String>,
    locale: Option<String>,
    directory: Option<String>,
}

fn overlay_directory(directory: Option<String>) -> Option<PathBuf> {
    directory.and_then(|item| {
        let item = item.trim();
        (!item.is_empty()).then(|| PathBuf::from(item))
    })
}

fn overlay_settings_path(directory: Option<String>) -> Result<PathBuf, String> {
    overlay_directory(directory)
        .map(|dir| Ok(dir.join(".opencorvus").join("overlay.json")))
        .unwrap_or_else(|| {
            std::env::current_dir()
                .map(|dir| dir.join(".opencorvus").join("overlay.json"))
                .map_err(|err| err.to_string())
        })
}

fn legacy_overlay_settings_path() -> Result<PathBuf, String> {
    std::env::current_dir()
        .map(|dir| dir.join("overlay.json"))
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn overlay_settings_load(directory: Option<String>) -> Result<OverlaySettings, String> {
    let path = overlay_settings_path(directory)?;
    if path.exists() {
        let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
        return serde_json::from_str(&text).map_err(|err| err.to_string());
    }

    let legacy = legacy_overlay_settings_path()?;
    if !legacy.exists() {
        return Ok(OverlaySettings::default());
    }

    let text = fs::read_to_string(&legacy).map_err(|err| err.to_string())?;
    let settings: OverlaySettings = serde_json::from_str(&text).map_err(|err| err.to_string())?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&path, text).map_err(|err| err.to_string())?;
    let _ = fs::remove_file(legacy);
    Ok(settings)
}

#[tauri::command]
fn overlay_settings_save(settings: OverlaySettings, directory: Option<String>) -> Result<bool, String> {
    let path = overlay_settings_path(directory.or_else(|| settings.directory.clone()))?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(&path, text).map_err(|err| err.to_string())?;
    if let Ok(legacy) = legacy_overlay_settings_path() {
        if legacy != path {
            let _ = fs::remove_file(legacy);
        }
    }
    Ok(true)
}

#[tauri::command]
fn overlay_open_path<R: Runtime>(app: AppHandle<R>, path: String) -> Result<bool, String> {
    if path.trim().is_empty() {
        return Ok(false);
    }

    app.opener()
        .open_path(path, None::<&str>)
        .map(|_| true)
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn overlay_create_dir(path: String) -> Result<bool, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(false);
    }
    fs::create_dir_all(path).map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn overlay_pick_dir<R: Runtime>(app: AppHandle<R>, start: Option<String>) -> Result<Option<String>, String> {
    let dialog = if let Some(start) = start.map(|item| item.trim().to_string()).filter(|item| !item.is_empty()) {
        app.dialog().file().set_directory(start)
    } else {
        app.dialog().file()
    };

    Ok(dialog
        .blocking_pick_folder()
        .and_then(|item| item.into_path().ok())
        .map(|item| item.to_string_lossy().to_string()))
}

fn candidate_server_paths<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut result = Vec::new();
    let dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|p| p.to_path_buf()));
    let names = if cfg!(windows) {
        ["opencorvus-core.exe", "opencorvus.exe"]
    } else {
        ["opencorvus-core", "opencorvus"]
    };

    if let Some(dir) = dir {
        result.extend(names.iter().map(|name| dir.join(name)));
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        result.extend(names.iter().map(|name| resource_dir.join(name)));
    }

    result
}

fn server_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    candidate_server_paths(app)
        .into_iter()
        .find(|path| path.exists())
}

fn stop_server<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Server>();
    let mut lock = state.0.lock().unwrap();
    if let Some(mut child) = lock.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn start_server<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let Some(path) = server_path(app) else {
        eprintln!("overlay: bundled opencorvus binary not found");
        return Ok(());
    };

    let mut cmd = Command::new(path);
    cmd.arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("7878")
        .env("OPENCORVUS_VERSION", env!("CARGO_PKG_VERSION"))
        .env("OPENCORVUS_CHANNEL", "latest")
        .env("OPENCORVUS_CLIENT", "app")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    *app.state::<Server>().0.lock().unwrap() = Some(cmd.spawn()?);
    Ok(())
}

fn restart_server<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    stop_server(app);
    start_server(app)
}

/// Embed the window icon at compile time so it works in both dev and prod builds.
const WINDOW_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

fn set_window_icon<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    match image::load_from_memory_with_format(WINDOW_ICON_PNG, image::ImageFormat::Png) {
        Ok(img) => {
            let rgba = img.to_rgba8();
            let (width, height) = rgba.dimensions();
            let icon = tauri::image::Image::new_owned(rgba.into_raw(), width, height);
            let _ = window.set_icon(icon);
        }
        Err(err) => {
            eprintln!("overlay: failed to decode window icon: {err}");
        }
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            overlay_settings_load,
            overlay_settings_save,
            overlay_open_path,
            overlay_create_dir,
            overlay_pick_dir
        ])
        .setup(|app| {
            app.manage(Server(Mutex::new(None)));
            let handle = app.handle().clone();
            let _ = restart_server(&handle);

            // Set window icon (needed for taskbar/alt-tab when decorations=false).
            // bundle.icon only applies to the packaged exe, not cargo run dev builds.
            if let Some(window) = app.get_webview_window("main") {
                let _ = set_window_icon(&window);
            }

            // Adapt window size & position to primary monitor
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(Some(monitor)) = window.primary_monitor() {
                    let screen = monitor.size();
                    let scale = monitor.scale_factor();
                    let logical_w = screen.width as f64 / scale;
                    let logical_h = screen.height as f64 / scale;

                    // Panel: ~50% width (clamped 640..1100), ~72% height (clamped 480..920)
                    let w = (logical_w * 0.50).clamp(640.0, 1100.0);
                    let h = (logical_h * 0.72).clamp(480.0, 920.0);
                    // Position: bottom-right with 24px margin
                    let x = logical_w - w - 24.0;
                    let y = logical_h - h - 64.0; // leave room for taskbar

                    let _ = window.set_size(tauri::LogicalSize::new(w, h));
                    let _ = window.set_position(tauri::LogicalPosition::new(x, y));
                }
            }

            // Build tray menu
            let show_item = MenuItem::with_id(app, "show", "Show Panel", true, None::<&str>)?;
            let hide_item = MenuItem::with_id(app, "hide", "Hide Panel", true, None::<&str>)?;
            let restart_item = MenuItem::with_id(app, "restart", "Restart", true, None::<&str>)?;
            let separator = MenuItem::with_id(app, "sep", "────────", false, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &hide_item,
                    &restart_item,
                    &separator,
                    &quit_item,
                ],
            )?;

            let icon = create_tray_icon();

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .tooltip("OpenCorvus")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "hide" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.hide();
                            }
                        }
                        "restart" => {
                            let _ = restart_server(app);
                            if let Some(window) = app.get_webview_window("main") {
                                // Reload the frontend
                                let _ = window.eval("location.reload()");
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            stop_server(app);
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                stop_server(app);
            }
        })
}

/// Create a simple 32x32 RGBA icon (blue circle on transparent background)
fn create_tray_icon() -> tauri::image::Image<'static> {
    let size: u32 = 32;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let cx = size as f64 / 2.0;
    let cy = size as f64 / 2.0;
    let r = 12.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;

            if dist <= r {
                rgba[idx] = 0x5b;
                rgba[idx + 1] = 0x8d;
                rgba[idx + 2] = 0xef;
                let edge = r - dist;
                rgba[idx + 3] = if edge >= 1.0 {
                    255
                } else {
                    (edge * 255.0) as u8
                };
            }
        }
    }

    tauri::image::Image::new_owned(rgba, size, size)
}
