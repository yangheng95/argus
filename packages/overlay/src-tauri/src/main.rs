// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
};

use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime,
};

struct Server(Mutex<Option<Child>>);

fn server_path() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let names = if cfg!(windows) {
        ["opencorvus-core.exe", "opencorvus.exe"]
    } else {
        ["opencorvus-core", "opencorvus"]
    };

    names
        .into_iter()
        .map(|name| dir.join(name))
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
    let Some(path) = server_path() else {
        eprintln!("overlay: bundled opencorvus binary not found next to overlay");
        return Ok(());
    };

    let mut cmd = Command::new(path);
    cmd.arg("serve")
        .arg("--hostname")
        .arg("127.0.0.1")
        .arg("--port")
        .arg("7878")
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

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            app.manage(Server(Mutex::new(None)));
            let handle = app.handle().clone();
            let _ = restart_server(&handle);

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
                &[&show_item, &hide_item, &restart_item, &separator, &quit_item],
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
                    if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
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
                rgba[idx + 3] = if edge >= 1.0 { 255 } else { (edge * 255.0) as u8 };
            }
        }
    }

    tauri::image::Image::new_owned(rgba, size, size)
}
