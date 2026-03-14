// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::VecDeque,
    fs,
    net::TcpListener,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime, UserAttentionType,
};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

const LOCAL_SERVER_HOST: &str = "127.0.0.1";
const DEFAULT_SERVER_PORT: u16 = 7878;
const TRAY_ID: &str = "main-tray";
const TRAY_TOOLTIP_DEFAULT: &str = "OpenCorvus";
const TRAY_TOOLTIP_ALERT: &str = "OpenCorvus - Action required";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Default)]
struct ServerState {
    child: Option<Child>,
    port: Option<u16>,
}

struct Server(Mutex<ServerState>);

#[derive(Default)]
struct TrayAttentionState {
    active: bool,
    flashing: bool,
}

struct TrayAttention(Mutex<TrayAttentionState>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayServerInfo {
    port: u16,
    url: String,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OverlaySettings {
    server_url: Option<String>,
    auto_server: Option<bool>,
    password: Option<String>,
    username: Option<String>,
    executor: Option<String>,
    init_git: Option<bool>,
    always_on_top: Option<bool>,
    unattended: Option<bool>,
    auto_permission: Option<bool>,
    auto_question: Option<bool>,
    sidebar_width: Option<u32>,
    sections_width: Option<u32>,
    opacity: Option<f64>,
    zoom: Option<f64>,
    theme: Option<String>,
    locale: Option<String>,
    directory_mode: Option<String>,
    directory: Option<String>,
    workspace_task_id: Option<String>,
    workspace_session_id: Option<String>,
    workspace_directory: Option<String>,
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
fn overlay_open_url<R: Runtime>(app: AppHandle<R>, url: String) -> Result<bool, String> {
    if url.trim().is_empty() {
        return Ok(false);
    }

    app.opener()
        .open_url(url, None::<&str>)
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
fn overlay_create_temp_dir() -> Result<String, String> {
    let root = std::env::temp_dir();
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();

    for attempt in 0..64 {
        let suffix = if attempt == 0 {
            format!("{stamp}-{}", std::process::id())
        } else {
            format!("{stamp}-{}-{attempt}", std::process::id())
        };
        let path = root.join(format!("opencorvus-overlay-{suffix}"));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path.to_string_lossy().to_string()),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err.to_string()),
        }
    }

    Err("failed to create overlay temp directory".into())
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

fn server_info(port: u16) -> OverlayServerInfo {
    OverlayServerInfo {
        port,
        url: format!("http://{LOCAL_SERVER_HOST}:{port}"),
    }
}

fn next_server_port() -> Result<u16, String> {
    if let Ok(listener) = TcpListener::bind((LOCAL_SERVER_HOST, DEFAULT_SERVER_PORT)) {
        return listener
            .local_addr()
            .map(|addr| addr.port())
            .map_err(|err| err.to_string());
    }

    for port in (DEFAULT_SERVER_PORT + 1)..=(DEFAULT_SERVER_PORT + 32) {
        if let Ok(listener) = TcpListener::bind((LOCAL_SERVER_HOST, port)) {
            return listener
                .local_addr()
                .map(|addr| addr.port())
                .map_err(|err| err.to_string());
        }
    }

    TcpListener::bind((LOCAL_SERVER_HOST, 0))
        .map_err(|err| err.to_string())?
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|err| err.to_string())
}

fn stop_server<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<Server>();
    let mut lock = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("overlay: server mutex poisoned in stop_server, recovering");
            poisoned.into_inner()
        }
    };
    if let Some(mut child) = lock.child.take() {
        if let Err(err) = child.kill() {
            eprintln!("overlay: failed to kill server process: {err}");
        }
        if let Err(err) = child.wait() {
            eprintln!("overlay: failed to wait on server process: {err}");
        }
    }
    lock.port = None;
}

fn start_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    let Some(path) = server_path(app) else {
        eprintln!("overlay: bundled opencorvus binary not found");
        return Err("Bundled opencorvus binary not found".into());
    };
    let port = next_server_port()?;

    let mut cmd = Command::new(path);
    cmd.arg("serve")
        .arg("--hostname")
        .arg(LOCAL_SERVER_HOST)
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCORVUS_VERSION", env!("CARGO_PKG_VERSION"))
        .env("OPENCORVUS_CHANNEL", "latest")
        .env("OPENCORVUS_CLIENT", "app")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|err| err.to_string())?;
    let info = server_info(port);
    let state = app.state::<Server>();
    let mut lock = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("overlay: server mutex poisoned in start_server, recovering");
            poisoned.into_inner()
        }
    };
    lock.child = Some(child);
    lock.port = Some(port);
    Ok(info)
}

fn restart_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    stop_server(app);
    start_server(app)
}

fn ensure_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    {
        let state = app.state::<Server>();
        let mut lock = match state.0.lock() {
            Ok(guard) => guard,
            Err(poisoned) => {
                eprintln!("overlay: server mutex poisoned in ensure_server, recovering");
                poisoned.into_inner()
            }
        };
        if let Some(child) = lock.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if let Some(port) = lock.port {
                        return Ok(server_info(port));
                    }
                }
                Ok(Some(_)) | Err(_) => {
                    lock.child = None;
                    lock.port = None;
                }
            }
        }
    }

    start_server(app)
}

#[tauri::command]
fn overlay_server_info<R: Runtime>(app: AppHandle<R>) -> Result<OverlayServerInfo, String> {
    ensure_server(&app)
}

#[tauri::command]
fn overlay_server_restart<R: Runtime>(app: AppHandle<R>) -> Result<OverlayServerInfo, String> {
    restart_server(&app)
}

/// Embed the window icon at compile time so it works in both dev and prod builds.
const WINDOW_ICON_PNG: &[u8] = include_bytes!("../icons/icon.png");

fn embedded_icon(size: Option<u32>) -> Option<tauri::image::Image<'static>> {
    match image::load_from_memory_with_format(WINDOW_ICON_PNG, image::ImageFormat::Png) {
        Ok(img) => {
            let rgba = if let Some(size) = size {
                img.resize_exact(size, size, image::imageops::FilterType::Lanczos3)
                    .to_rgba8()
            } else {
                img.to_rgba8()
            };
            let (width, height) = rgba.dimensions();
            Some(tauri::image::Image::new_owned(
                rgba.into_raw(),
                width,
                height,
            ))
        }
        Err(err) => {
            eprintln!("overlay: failed to decode window icon: {err}");
            None
        }
    }
}

fn tray_background(pixel: &image::Rgba<u8>) -> bool {
    let [r, g, b, a] = pixel.0;
    if a == 0 {
        return false;
    }

    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let lum = (u16::from(r) + u16::from(g) + u16::from(b)) / 3;
    max - min <= 28 && lum >= 150
}

fn queue_tray_pixel(
    rgba: &image::RgbaImage,
    seen: &mut [bool],
    queue: &mut VecDeque<(u32, u32)>,
    x: u32,
    y: u32,
) {
    let idx = (y * rgba.width() + x) as usize;
    if seen[idx] || !tray_background(rgba.get_pixel(x, y)) {
        return;
    }
    seen[idx] = true;
    queue.push_back((x, y));
}

fn clear_tray_background(rgba: &mut image::RgbaImage) {
    let (width, height) = rgba.dimensions();
    let mut seen = vec![false; (width * height) as usize];
    let mut queue = VecDeque::new();

    for x in 0..width {
        queue_tray_pixel(rgba, &mut seen, &mut queue, x, 0);
        queue_tray_pixel(rgba, &mut seen, &mut queue, x, height - 1);
    }
    for y in 1..height.saturating_sub(1) {
        queue_tray_pixel(rgba, &mut seen, &mut queue, 0, y);
        queue_tray_pixel(rgba, &mut seen, &mut queue, width - 1, y);
    }

    while let Some((x, y)) = queue.pop_front() {
        rgba.get_pixel_mut(x, y).0[3] = 0;

        if x > 0 {
            queue_tray_pixel(rgba, &mut seen, &mut queue, x - 1, y);
        }
        if x + 1 < width {
            queue_tray_pixel(rgba, &mut seen, &mut queue, x + 1, y);
        }
        if y > 0 {
            queue_tray_pixel(rgba, &mut seen, &mut queue, x, y - 1);
        }
        if y + 1 < height {
            queue_tray_pixel(rgba, &mut seen, &mut queue, x, y + 1);
        }
    }
}

fn crop_tray_icon(rgba: image::RgbaImage) -> Option<image::RgbaImage> {
    let (width, height) = rgba.dimensions();
    let mut left = width;
    let mut top = height;
    let mut right = 0;
    let mut bottom = 0;

    for y in 0..height {
        for x in 0..width {
            if rgba.get_pixel(x, y).0[3] == 0 {
                continue;
            }
            left = left.min(x);
            top = top.min(y);
            right = right.max(x);
            bottom = bottom.max(y);
        }
    }

    if left == width || top == height {
        return None;
    }

    let pad = ((right - left + 1).min(bottom - top + 1) / 18).max(12);
    let left = left.saturating_sub(pad);
    let top = top.saturating_sub(pad);
    let right = (right + pad).min(width - 1);
    let bottom = (bottom + pad).min(height - 1);

    Some(
        image::imageops::crop_imm(&rgba, left, top, right - left + 1, bottom - top + 1)
            .to_image(),
    )
}

fn tray_icon_from_bundle() -> Option<tauri::image::Image<'static>> {
    match image::load_from_memory_with_format(WINDOW_ICON_PNG, image::ImageFormat::Png) {
        Ok(img) => {
            let mut rgba = img.to_rgba8();
            clear_tray_background(&mut rgba);
            let rgba = crop_tray_icon(rgba)?;
            let rgba = image::DynamicImage::ImageRgba8(rgba)
                .resize_exact(32, 32, image::imageops::FilterType::Lanczos3)
                .to_rgba8();
            Some(tauri::image::Image::new_owned(rgba.into_raw(), 32, 32))
        }
        Err(err) => {
            eprintln!("overlay: failed to decode tray icon: {err}");
            None
        }
    }
}

fn set_window_icon<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    if let Some(icon) = embedded_icon(None) {
        let _ = window.set_icon(icon);
    }
}

fn show_window<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

fn request_attention<R: Runtime>(app: &AppHandle<R>, active: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.request_user_attention(if active {
            Some(UserAttentionType::Informational)
        } else {
            None
        });
    }
}

fn apply_tray_attention<R: Runtime>(app: &AppHandle<R>, active: bool) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let icon = if active {
            create_attention_tray_icon()
        } else {
            create_tray_icon()
        };
        let _ = tray.set_icon(Some(icon));
        let _ = tray.set_tooltip(Some(if active {
            TRAY_TOOLTIP_ALERT
        } else {
            TRAY_TOOLTIP_DEFAULT
        }));
    }
}

fn clear_tray_attention<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<TrayAttention>();
    let mut lock = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("overlay: tray attention mutex poisoned while clearing, recovering");
            poisoned.into_inner()
        }
    };
    lock.active = false;
    lock.flashing = false;
    drop(lock);
    apply_tray_attention(app, false);
    request_attention(app, false);
}

#[tauri::command]
fn overlay_attention_set<R: Runtime>(app: AppHandle<R>, active: bool) -> Result<bool, String> {
    let state = app.state::<TrayAttention>();
    let mut lock = match state.0.lock() {
        Ok(guard) => guard,
        Err(poisoned) => {
            eprintln!("overlay: tray attention mutex poisoned while updating, recovering");
            poisoned.into_inner()
        }
    };
    lock.active = active;
    if !active {
        lock.flashing = false;
    }
    drop(lock);

    if active {
        request_attention(&app, true);
        return Ok(true);
    }

    apply_tray_attention(&app, false);
    request_attention(&app, false);
    Ok(true)
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            overlay_settings_load,
            overlay_settings_save,
            overlay_server_info,
            overlay_server_restart,
            overlay_open_path,
            overlay_open_url,
            overlay_create_dir,
            overlay_create_temp_dir,
            overlay_pick_dir,
            overlay_attention_set
        ])
        .setup(|app| {
            app.manage(Server(Mutex::new(ServerState::default())));
            app.manage(TrayAttention(Mutex::new(TrayAttentionState::default())));
            let handle = app.handle().clone();
            restart_server(&handle)?;

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

                    // Panel: ~80% width (clamped 760..1600), ~72% height (clamped 480..920)
                    let w = (logical_w * 0.80).clamp(760.0, 1600.0);
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

            let _tray = TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .tooltip(TRAY_TOOLTIP_DEFAULT)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                clear_tray_attention(app);
                                show_window(&window);
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
                                clear_tray_attention(app);
                                show_window(&window);
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
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            clear_tray_attention(&app);
                            show_window(&window);
                        }
                    }
                })
                .build(app)?;

            {
                let app = app.handle().clone();
                thread::spawn(move || loop {
                    thread::sleep(Duration::from_millis(700));
                    let next = {
                        let state = app.state::<TrayAttention>();
                        let mut lock = match state.0.lock() {
                            Ok(guard) => guard,
                            Err(poisoned) => {
                                eprintln!("overlay: tray attention mutex poisoned in flasher, recovering");
                                poisoned.into_inner()
                            }
                        };
                        if !lock.active {
                            if !lock.flashing {
                                None
                            } else {
                                lock.flashing = false;
                                Some(false)
                            }
                        } else {
                            lock.flashing = !lock.flashing;
                            Some(lock.flashing)
                        }
                    };
                    if let Some(active) = next {
                        apply_tray_attention(&app, active);
                    }
                });
            }

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

/// Build a tray-specific icon by stripping the flat background from the bundled logo.
fn create_tray_icon() -> tauri::image::Image<'static> {
    if let Some(icon) = tray_icon_from_bundle() {
        return icon;
    }

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

fn create_attention_tray_icon() -> tauri::image::Image<'static> {
    let size: u32 = 32;
    let mut rgba = create_tray_icon().rgba().to_vec();
    let cx = 24.0;
    let cy = 8.0;
    let outer = 6.0;
    let inner = 3.0;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;

            if dist <= outer {
                rgba[idx] = 0xf8;
                rgba[idx + 1] = 0x71;
                rgba[idx + 2] = 0x71;
                rgba[idx + 3] = 255;
            }
            if dist <= inner {
                rgba[idx] = 0xff;
                rgba[idx + 1] = 0xff;
                rgba[idx + 2] = 0xff;
                rgba[idx + 3] = 255;
            }
        }
    }

    tauri::image::Image::new_owned(rgba, size, size)
}
