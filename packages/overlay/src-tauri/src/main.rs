// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    collections::VecDeque,
    fs,
    io::{Read, Write},
    net::{TcpListener, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Condvar, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[cfg(windows)]
use std::os::windows::io::AsRawHandle;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

use serde::{Deserialize, Serialize};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    AppHandle, Manager, Runtime, UserAttentionType,
};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

include!(concat!(env!("OUT_DIR"), "/server_defaults.rs"));

const LOCAL_SERVER_HOST: &str = DEFAULT_SERVER_HOST;
const TRAY_ID: &str = "main-tray";
const TRAY_TOOLTIP_DEFAULT: &str = "OpenCorvus";
const TRAY_TOOLTIP_ALERT: &str = "OpenCorvus - Action required";
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

include!(concat!(env!("OUT_DIR"), "/embedded_sidecar.rs"));

// ── Windows: Job Object with KILL_ON_JOB_CLOSE ──────────────────────────────
//
// When the overlay exits (even on crash), closing the last handle to the job
// object causes Windows to terminate every process in the job — including all
// grandchildren spawned by the Bun server (LSP servers, PTY shells, etc.).
#[cfg(windows)]
mod job_object {
    use std::ffi::c_void;

    pub type HANDLE = *mut c_void;
    const INVALID_HANDLE_VALUE: HANDLE = -1isize as HANDLE;

    // JOBOBJECTINFOCLASS::JobObjectExtendedLimitInformation = 9
    const EXTENDED_LIMIT_INFO_CLASS: u32 = 9;
    // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    const KILL_ON_CLOSE: u32 = 0x00002000;

    #[repr(C)]
    struct IoCounters {
        read_op: u64, write_op: u64, other_op: u64,
        read_xfer: u64, write_xfer: u64, other_xfer: u64,
    }

    #[repr(C)]
    struct BasicLimitInfo {
        per_process_time: i64,
        per_job_time: i64,
        limit_flags: u32,
        min_ws: usize,
        max_ws: usize,
        active_process_limit: u32,
        affinity: usize,
        priority_class: u32,
        scheduling_class: u32,
    }

    #[repr(C)]
    struct ExtendedLimitInfo {
        basic: BasicLimitInfo,
        io: IoCounters,
        process_mem_limit: usize,
        job_mem_limit: usize,
        peak_process_mem: usize,
        peak_job_mem: usize,
    }

    extern "system" {
        fn CreateJobObjectW(attrs: *const c_void, name: *const u16) -> HANDLE;
        fn SetInformationJobObject(
            job: HANDLE, class: u32, info: *const c_void, len: u32,
        ) -> i32;
        fn AssignProcessToJobObject(job: HANDLE, process: HANDLE) -> i32;
        fn CloseHandle(handle: HANDLE) -> i32;
    }

    /// Owns a Windows Job Object handle. Dropping closes the handle, which
    /// triggers KILL_ON_JOB_CLOSE and terminates the entire process tree.
    pub struct JobObject(HANDLE);

    impl Drop for JobObject {
        fn drop(&mut self) {
            if !self.0.is_null() && self.0 != INVALID_HANDLE_VALUE {
                unsafe { CloseHandle(self.0); }
            }
        }
    }

    // HANDLE is just a pointer but we only ever use it from within a Mutex.
    unsafe impl Send for JobObject {}
    unsafe impl Sync for JobObject {}

    /// Creates a kill-on-close job object and assigns `child_handle` to it.
    /// Returns `None` on failure (logged by caller); the child still runs,
    /// just without the automatic tree-kill guarantee.
    pub fn create_and_assign(child_handle: HANDLE) -> Option<JobObject> {
        let job = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if job.is_null() || job == INVALID_HANDLE_VALUE {
            return None;
        }
        let info = ExtendedLimitInfo {
            basic: BasicLimitInfo {
                limit_flags: KILL_ON_CLOSE,
                // SAFETY: all other fields are zero/null, which is valid.
                ..unsafe { std::mem::zeroed() }
            },
            // SAFETY: zero-initialised remaining fields are valid.
            ..unsafe { std::mem::zeroed() }
        };
        let ok = unsafe {
            SetInformationJobObject(
                job,
                EXTENDED_LIMIT_INFO_CLASS,
                &info as *const _ as *const c_void,
                std::mem::size_of::<ExtendedLimitInfo>() as u32,
            )
        };
        if ok == 0 {
            unsafe { CloseHandle(job); }
            return None;
        }
        unsafe { AssignProcessToJobObject(job, child_handle); }
        Some(JobObject(job))
    }
}

// ── Unix: process-group kill ─────────────────────────────────────────────────
//
// The child is spawned with process_group(0), making it a process group leader.
// All grandchildren inherit the group. On shutdown we send SIGKILL to the
// entire group via kill(-pgid, SIGKILL).
#[cfg(unix)]
extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
}

#[derive(Default)]
struct ServerState {
    child: Option<Child>,
    port: Option<u16>,
    sidecar_log_path: Option<PathBuf>,
    /// Windows: Job Object that auto-kills all job members on drop.
    #[cfg(windows)]
    job: Option<job_object::JobObject>,
    /// Unix: process group ID of the server (== child PID after process_group(0)).
    #[cfg(unix)]
    pgid: Option<u32>,
}

struct Server(Mutex<ServerState>);

#[derive(Default)]
struct TrayAttentionState {
    active: bool,
    flashing: bool,
}

struct TrayAttention {
    state: Mutex<TrayAttentionState>,
    cvar: Condvar,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OverlayServerInfo {
    port: u16,
    url: String,
    /// PID of the spawned sidecar `bun` process. Surfaced in the title-bar
    /// connection badge next to the port so an operator can `kill <pid>` /
    /// `lsof -p <pid>` without hunting through netstat or Activity Monitor.
    /// Optional because some callers populate it lazily — every live
    /// callsite goes through `server_info_with_pid` (the legacy
    /// pid-less `server_info` constructor was deleted as dead code).
    #[serde(skip_serializing_if = "Option::is_none")]
    pid: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    sidecar_log_path: Option<String>,
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
    sidebar_collapsed: Option<bool>,
    sidebar_width: Option<u32>,
    sections_width: Option<u32>,
    workspace_panel_height: Option<u32>,
    opacity: Option<f64>,
    zoom: Option<f64>,
    theme: Option<String>,
    locale: Option<String>,
    directory_mode: Option<String>,
    directory: Option<String>,
    workspace_task_id: Option<String>,
    workspace_session_id: Option<String>,
    workspace_directory: Option<String>,
    desktop_notifications: Option<bool>,
}

fn overlay_settings_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("overlay.json"))
        .map_err(|err| err.to_string())
}

#[tauri::command]
fn overlay_settings_load<R: Runtime>(app: AppHandle<R>) -> Result<OverlaySettings, String> {
    let path = overlay_settings_path(&app)?;
    if !path.exists() {
        return Ok(OverlaySettings::default());
    }
    let text = fs::read_to_string(path).map_err(|err| err.to_string())?;
    serde_json::from_str(&text).map_err(|err| err.to_string())
}

#[tauri::command]
fn overlay_settings_save<R: Runtime>(app: AppHandle<R>, settings: OverlaySettings) -> Result<bool, String> {
    let path = overlay_settings_path(&app)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let text = serde_json::to_string_pretty(&settings).map_err(|err| err.to_string())?;
    fs::write(&path, text).map_err(|err| err.to_string())?;
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

#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
enum ProjectEditor {
    Vscode,
    Pycharm,
    Webstorm,
    Intellij,
    Cursor,
}

impl ProjectEditor {
    fn label(self) -> &'static str {
        match self {
            Self::Vscode => "VS Code",
            Self::Pycharm => "PyCharm",
            Self::Webstorm => "WebStorm",
            Self::Intellij => "IntelliJ IDEA",
            Self::Cursor => "Cursor",
        }
    }

    fn command(self) -> &'static str {
        #[cfg(windows)]
        {
            match self {
                Self::Vscode => "code.cmd",
                Self::Pycharm => "pycharm64.exe",
                Self::Webstorm => "webstorm64.exe",
                Self::Intellij => "idea64.exe",
                Self::Cursor => "cursor.cmd",
            }
        }
        #[cfg(not(windows))]
        {
            match self {
                Self::Vscode => "code",
                Self::Pycharm => "pycharm",
                Self::Webstorm => "webstorm",
                Self::Intellij => "idea",
                Self::Cursor => "cursor",
            }
        }
    }
}

#[tauri::command]
fn overlay_open_project_editor(editor: ProjectEditor, path: String) -> Result<bool, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(false);
    }

    let mut cmd = Command::new(editor.command());
    cmd.arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map(|_| true)
        .map_err(|err| format!("{}: {}", editor.label(), err))
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
fn overlay_write_file(path: String, content: String) -> Result<bool, String> {
    let path = path.trim();
    if path.is_empty() {
        return Ok(false);
    }
    let p = std::path::Path::new(path);
    if let Some(parent) = p.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(p, content).map_err(|err| err.to_string())?;
    Ok(true)
}

#[tauri::command]
fn overlay_pick_dir<R: Runtime>(app: AppHandle<R>, start: Option<String>) -> Result<Option<String>, String> {
    let start_clean = start
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let dialog = if let Some(ref dir) = start_clean {
        app.dialog().file().set_directory(dir)
    } else {
        app.dialog().file()
    };

    let picked = dialog.blocking_pick_folder();
    let result = picked
        .and_then(|item| {
            // Try into_path first; fall back to display string for shell/virtual paths
            match item.into_path() {
                Ok(p) => Some(p.to_string_lossy().to_string()),
                Err(item_back) => {
                    let s = item_back.to_string();
                    if s.is_empty() { None } else { Some(s) }
                }
            }
        });

    // Guard: if the dialog returned exactly the start directory, treat it as
    // a cancelled/no-op pick — the user did not select anything new.
    if let (Some(ref picked_path), Some(ref start_path)) = (&result, &start_clean) {
        let norm = |s: &str| s.trim_end_matches(['/', '\\']).replace('\\', "/").to_lowercase();
        if norm(picked_path) == norm(start_path) {
            return Ok(None);
        }
    }

    Ok(result)
}

fn mime_from_ext(filename: &str) -> &'static str {
    let ext = filename.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "pdf" => "application/pdf",
        "json" => "application/json",
        "xml" => "application/xml",
        "csv" => "text/csv",
        "txt" | "log" => "text/plain",
        "md" => "text/markdown",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" | "cjs" => "text/javascript",
        "ts" | "tsx" => "text/typescript",
        "py" => "text/x-python",
        "go" => "text/x-go",
        "rs" => "text/x-rust",
        "c" | "h" => "text/x-c",
        "cpp" | "cc" | "cxx" => "text/x-c++",
        "java" => "text/x-java",
        "rb" => "text/x-ruby",
        "sh" | "bash" => "text/x-shellscript",
        "bat" | "cmd" => "text/x-bat",
        "ps1" => "text/x-powershell",
        "sql" => "text/x-sql",
        "toml" => "text/x-toml",
        "yaml" | "yml" => "text/x-yaml",
        _ => "application/octet-stream",
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct PickedFile {
    filename: String,
    mime: String,
    url: String,
}

#[tauri::command]
fn overlay_pick_files<R: Runtime>(app: AppHandle<R>, start: Option<String>) -> Result<Vec<PickedFile>, String> {
    let mut builder = app.dialog().file().add_filter(
        "Supported Files",
        &[
            "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico",
            "pdf", "txt", "md", "json", "csv", "xml", "yaml", "yml",
            "log", "ts", "tsx", "js", "py", "go", "rs", "c", "cpp", "h",
            "java", "rb", "sh", "bat", "ps1", "html", "css", "sql", "toml",
        ],
    );

    if let Some(start) = start.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        builder = builder.set_directory(start);
    }

    let paths = match builder.blocking_pick_files() {
        Some(paths) => paths,
        None => return Ok(Vec::new()),
    };

    let max_size: u64 = 10 * 1024 * 1024;
    let mut results = Vec::new();
    for entry in paths {
        if let Ok(path) = entry.into_path() {
            let filename = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();
            let meta = fs::metadata(&path).map_err(|e| e.to_string())?;
            if meta.len() > max_size {
                continue;
            }
            let data = fs::read(&path).map_err(|e| e.to_string())?;
            let mime = mime_from_ext(&filename);
            let b64 = STANDARD.encode(&data);
            let url = format!("data:{};base64,{}", mime, b64);
            results.push(PickedFile { filename, mime: mime.to_string(), url });
        }
    }

    Ok(results)
}

fn candidate_server_paths<R: Runtime>(app: &AppHandle<R>) -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Ok(Some(path)) = ensure_embedded_server_path(app) {
        result.push(path);
    }
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

fn embedded_server_payload_dir_name() -> String {
    format!("sidecar-{}", EMBEDDED_SERVER_STAMP)
}

fn ensure_embedded_server_path<R: Runtime>(app: &AppHandle<R>) -> Result<Option<PathBuf>, String> {
    if EMBEDDED_SERVER_FILES.is_empty() {
        return Ok(None);
    }

    let mut root = app
        .path()
        .app_local_data_dir()
        .unwrap_or_else(|_| std::env::temp_dir());
    root.push("embedded");
    root.push(embedded_server_payload_dir_name());
    fs::create_dir_all(&root).map_err(|err| err.to_string())?;

    for file in EMBEDDED_SERVER_FILES {
        let path = root.join(file.path);
        let expected_len = file.bytes.len() as u64;
        let up_to_date = fs::metadata(&path)
            .map(|meta| meta.len() == expected_len)
            .unwrap_or(false);
        if up_to_date {
            continue;
        }

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
        fs::write(&tmp, file.bytes).map_err(|err| err.to_string())?;
        #[cfg(unix)]
        if file.executable {
            let perms = fs::Permissions::from_mode(0o755);
            fs::set_permissions(&tmp, perms).map_err(|err| err.to_string())?;
        }
        if path.exists() {
            let _ = fs::remove_file(&path);
        }
        fs::rename(&tmp, &path).map_err(|err| err.to_string())?;
    }

    Ok(Some(root.join(EMBEDDED_SERVER_NAME)))
}

fn server_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    candidate_server_paths(app)
        .into_iter()
        .find(|path| path.exists())
}

fn server_info_with_pid_and_log(port: u16, pid: u32, sidecar_log_path: Option<PathBuf>) -> OverlayServerInfo {
    OverlayServerInfo {
        port,
        url: format!("http://{LOCAL_SERVER_HOST}:{port}"),
        pid: Some(pid),
        sidecar_log_path: sidecar_log_path.map(|path| path.to_string_lossy().to_string()),
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
    let mut lock = state.0.lock().unwrap();

    let exited_gracefully = if let (Some(port), Some(child)) = (lock.port, lock.child.as_mut()) {
        match request_server_shutdown(port) {
            Ok(()) => match wait_for_child_exit(child, Duration::from_secs(5)) {
                Ok(exited) => exited,
                Err(err) => {
                    eprintln!("overlay: failed while waiting for graceful shutdown: {err}");
                    false
                }
            },
            Err(err) => {
                eprintln!("overlay: graceful shutdown request failed: {err}");
                false
            }
        }
    } else {
        false
    };

    // Windows: drop the Job Object handle → KILL_ON_JOB_CLOSE terminates every
    // process in the job (direct child + all grandchildren).
    #[cfg(windows)]
    { lock.job = None; }

    // Unix: SIGKILL the entire process group — reaches direct child and all
    // grandchildren that inherited the group (LSP servers, PTY shells, etc.).
    #[cfg(unix)]
    if let Some(pgid) = lock.pgid.take() {
        if !exited_gracefully && pgid > 1 {
            // SAFETY: kill(2) is always safe to call; SIGKILL = 9.
            unsafe { kill(-(pgid as i32), 9); }
        }
    }

    // Reap the direct child (may already be dead from the above).
    if let Some(mut child) = lock.child.take() {
        if !exited_gracefully {
            let _ = child.kill(); // Ignore error — process may already be gone.
        }
        if let Err(err) = child.wait() {
            eprintln!("overlay: failed to wait on server process: {err}");
        }
    }

    lock.port = None;
    lock.sidecar_log_path = None;
}

fn server_shutdown_authorization() -> Option<String> {
    let password = std::env::var("OPENCORVUS_SERVER_PASSWORD").ok()?;
    let password = password.trim();
    if password.is_empty() {
        return None;
    }
    let username = std::env::var("OPENCORVUS_SERVER_USERNAME")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "opencorvus".to_string());
    Some(format!("Basic {}", STANDARD.encode(format!("{username}:{password}"))))
}

fn request_server_shutdown(port: u16) -> Result<(), String> {
    let mut stream = TcpStream::connect((LOCAL_SERVER_HOST, port)).map_err(|err| err.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_millis(750)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(750)));

    let mut request = format!(
        "POST /shutdown HTTP/1.1\r\nHost: {host}:{port}\r\nConnection: close\r\nContent-Length: 0\r\n",
        host = LOCAL_SERVER_HOST,
        port = port,
    );
    if let Some(auth) = server_shutdown_authorization() {
        request.push_str(&format!("Authorization: {auth}\r\n"));
    }
    request.push_str("\r\n");

    stream.write_all(request.as_bytes()).map_err(|err| err.to_string())?;
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    Ok(())
}

fn wait_for_child_exit(child: &mut Child, timeout: Duration) -> Result<bool, String> {
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return Ok(true),
            Ok(None) => {
                if started.elapsed() >= timeout {
                    return Ok(false);
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

/// Resolve the writable directory we want the spawned sidecar's
/// `process.cwd()` to be. The sidecar inherits whatever cwd the Tauri
/// host had when it spawned, which on macOS .app launched from
/// Finder/Dock is `/` — a read-only directory that turned every
/// fallback-to-cwd code path on the server into a 500 (W2-V31 fixed
/// the explicit fallback; this fix removes the implicit one too so a
/// future regression cannot reach `/` again).
///
/// We use the same per-OS app-data root that `opencorvus_log_dir`
/// already creates and that the sidecar already has write access to.
/// Walking the path so the cwd lands at the parent of `log/` keeps
/// scope minimal — we don't want to land *inside* `log/` because
/// every random `git init` or `mkdir` the sidecar issues would then
/// pollute the log tree.
fn sidecar_cwd_dir() -> PathBuf {
    opencorvus_log_dir()
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(std::env::temp_dir)
}

/// Resolve the directory where opencorvus stores its log files. Mirrors
/// `Global.Path.log` on the sidecar side so all logs land together:
///   - Windows: %LOCALAPPDATA%\opencorvus\log
///   - macOS:   ~/Library/Application Support/opencorvus/log (xdg fallback below)
///   - Linux:   $XDG_DATA_HOME/opencorvus/log or ~/.local/share/opencorvus/log
/// Falls back to the system temp dir if no home is resolvable.
fn opencorvus_log_dir() -> PathBuf {
    if let Ok(portable) = std::env::var("OPENCORVUS_HOME") {
        if !portable.trim().is_empty() {
            return PathBuf::from(portable).join("data").join("log");
        }
    }
    #[cfg(windows)]
    {
        if let Ok(local) = std::env::var("LOCALAPPDATA") {
            if !local.is_empty() {
                return PathBuf::from(local).join("opencorvus").join("log");
            }
        }
    }
    #[cfg(not(windows))]
    {
        if let Ok(xdg) = std::env::var("XDG_DATA_HOME") {
            if !xdg.is_empty() {
                return PathBuf::from(xdg).join("opencorvus").join("log");
            }
        }
        if let Ok(home) = std::env::var("HOME") {
            if !home.is_empty() {
                return PathBuf::from(home).join(".local").join("share").join("opencorvus").join("log");
            }
        }
    }
    std::env::temp_dir().join("opencorvus").join("log")
}

fn append_overlay_startup_diagnostic(message: &str) -> Option<PathBuf> {
    let dir = opencorvus_log_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("overlay: cannot create startup diagnostic log dir {:?}: {}", dir, err);
        return None;
    }
    let path = dir.join("overlay-startup.log");
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let entry = format!("[{secs}] {message}\n\n");
    match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(err) = file.write_all(entry.as_bytes()) {
                eprintln!("overlay: cannot write startup diagnostic log {:?}: {}", path, err);
                return None;
            }
            Some(path)
        }
        Err(err) => {
            eprintln!("overlay: cannot open startup diagnostic log {:?}: {}", path, err);
            None
        }
    }
}

fn startup_failure_diagnostic_message(error: &str, log_path: Option<&PathBuf>) -> String {
    let mut parts = vec![
        "OpenCorvus backend failed to start.".to_string(),
        error.to_string(),
    ];
    if let Some(path) = log_path {
        parts.push(format!("overlay diagnostic log: {}", path.to_string_lossy()));
    }
    parts.join("\n\n")
}

fn surface_initial_server_failure<R: Runtime>(app: &AppHandle<R>, error: &str) {
    let log_path = append_overlay_startup_diagnostic(error);
    let details = startup_failure_diagnostic_message(error, log_path.as_ref());
    eprintln!("overlay: initial managed server start failed: {details}");

    if let Err(err) = app
        .notification()
        .builder()
        .title("OpenCorvus backend failed to start")
        .body("Overlay could not start the managed backend. Open the error dialog for the diagnostic log path.")
        .large_body(details.clone())
        .show()
    {
        let retry = format!("native notification failed: {err}\n\n{details}");
        let _ = append_overlay_startup_diagnostic(&retry);
        eprintln!("overlay: native startup failure notification failed: {err}");
    }

    app.dialog()
        .message(details)
        .title("OpenCorvus backend failed to start")
        .kind(MessageDialogKind::Error)
        .show(|_| {});
}

/// Build (stdout, stderr) Stdio targets for the spawned sidecar. Both streams
/// are written to a single per-launch file so chronological order is preserved.
/// On any failure we fall back to Stdio::null() — capturing logs is best-effort
/// diagnostic plumbing, not a hard requirement for the sidecar to run.
fn sidecar_stdio_targets() -> (Stdio, Stdio, Option<PathBuf>) {
    let dir = opencorvus_log_dir();
    if let Err(err) = fs::create_dir_all(&dir) {
        eprintln!("overlay: cannot create sidecar log dir {:?}: {}", dir, err);
        return (Stdio::null(), Stdio::null(), None);
    }
    let pid = std::process::id();
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let path = dir.join(format!("sidecar-{}-{}.log", secs, pid));
    let file = match fs::OpenOptions::new().create(true).append(true).open(&path) {
        Ok(f) => f,
        Err(err) => {
            eprintln!("overlay: cannot open sidecar log {:?}: {}", path, err);
            return (Stdio::null(), Stdio::null(), None);
        }
    };
    let dup = match file.try_clone() {
        Ok(f) => f,
        Err(err) => {
            eprintln!("overlay: cannot clone sidecar log handle: {}", err);
            return (Stdio::null(), Stdio::null(), None);
        }
    };
    (Stdio::from(file), Stdio::from(dup), Some(path))
}

fn start_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    let Some(path) = server_path(app) else {
        eprintln!("overlay: bundled opencorvus binary not found");
        return Err("Bundled opencorvus binary not found".into());
    };
    let port = next_server_port()?;

    // Capture the sidecar's stdio to a per-launch log file. Without this,
    // any panic the sidecar produces before its internal Log.init() writes
    // the first record (env/proxy detection, registry probes, missing DLLs,
    // bun runtime errors) is silently dropped — which is exactly what makes
    // VM-only failures impossible to diagnose. The Tauri-side stderr is
    // already eaten by the windows_subsystem = "windows" attribute, so the
    // log file is the only signal.
    let (stdout_target, stderr_target, sidecar_log_path) = sidecar_stdio_targets();

    // W2-V35: ensure the spawned sidecar inherits a writable, predictable
    // cwd. Without this, macOS .app launched from Finder/Dock spawns the
    // sidecar with `cwd="/"`. Anything inside the sidecar that reads
    // `process.cwd()` (or did so before W2-V31 / W2-V32 removed the
    // server-side fallbacks) would then attempt to write at `/` and
    // permission-deny across every project route.
    let sidecar_cwd = sidecar_cwd_dir();
    if let Err(err) = fs::create_dir_all(&sidecar_cwd) {
        eprintln!(
            "overlay: cannot create sidecar cwd {:?}: {} (continuing with default cwd inheritance)",
            sidecar_cwd, err
        );
    }
    let mut cmd = Command::new(&path);
    cmd.current_dir(&sidecar_cwd)
        .arg("serve")
        .arg("--hostname")
        .arg(LOCAL_SERVER_HOST)
        .arg("--port")
        .arg(port.to_string())
        .env("OPENCORVUS_VERSION", env!("CARGO_PKG_VERSION"))
        .env("OPENCORVUS_CHANNEL", "latest")
        .env("OPENCORVUS_CLIENT", "app")
        // Overlay-launched opencorvus must always write trace files under the
        // active project's `<Instance.directory>/.opencorvus/trace/`. Inheriting
        // a stray `OPENCORVUS_AGENT_TRACE_DIR` from the launching shell (or
        // a prior benchmark run that exported it globally) would silently
        // route trace into a stale temp path instead of the project directory,
        // and the overlay's debug surfaces would never see it. Strip it before
        // spawn so the env override only applies where it's set on purpose.
        .env_remove("OPENCORVUS_AGENT_TRACE_DIR")
        .stdin(Stdio::null())
        .stdout(stdout_target)
        .stderr(stderr_target);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    // Unix: move child into its own process group so kill(-pgid) reaches all
    // grandchildren (LSP servers, PTY shells, JSON-RPC processes, etc.).
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    let child = cmd.spawn().map_err(|err| {
        let log = sidecar_log_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| "unavailable".to_string());
        format!(
            "failed to spawn bundled opencorvus server: {err}\nserver binary: {}\nserver cwd: {}\nserver port: {port}\nsidecar log: {log}",
            path.to_string_lossy(),
            sidecar_cwd.to_string_lossy(),
        )
    })?;

    // Windows: assign the child to a kill-on-close Job Object so the entire
    // process tree is terminated automatically when the overlay exits.
    #[cfg(windows)]
    let job = {
        let raw = child.as_raw_handle() as job_object::HANDLE;
        let j = job_object::create_and_assign(raw);
        if j.is_none() {
            eprintln!("overlay: job object unavailable; grandchild processes may linger");
        }
        j
    };

    // Unix: PGID == child PID because we used process_group(0).
    #[cfg(unix)]
    let pgid = child.id();

    let pid = child.id();
    let info = server_info_with_pid_and_log(port, pid, sidecar_log_path.clone());
    let state = app.state::<Server>();
    let mut lock = state.0.lock().unwrap();
    lock.child = Some(child);
    lock.port = Some(port);
    lock.sidecar_log_path = sidecar_log_path;
    #[cfg(windows)]
    { lock.job = job; }
    #[cfg(unix)]
    { lock.pgid = Some(pgid); }
    Ok(info)
}

fn restart_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    stop_server(app);
    start_server(app)
}

fn ensure_server<R: Runtime>(app: &AppHandle<R>) -> Result<OverlayServerInfo, String> {
    {
        let state = app.state::<Server>();
        let mut lock = state.0.lock().unwrap();
        // Capture `port` BEFORE borrowing `lock.child` mutably — otherwise
        // the immutable read inside the `Ok(None)` arm overlaps the mutable
        // borrow held by `child` and the borrow checker rejects (E0502).
        let port_snapshot = lock.port;
        let sidecar_log_path = lock.sidecar_log_path.clone();
        if let Some(child) = lock.child.as_mut() {
            match child.try_wait() {
                Ok(None) => {
                    if let Some(port) = port_snapshot {
                        let pid = child.id();
                        return Ok(server_info_with_pid_and_log(port, pid, sidecar_log_path));
                    }
                }
                Ok(Some(_)) | Err(_) => {
                    lock.child = None;
                    lock.port = None;
                    lock.sidecar_log_path = None;
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
    let attention = app.state::<TrayAttention>();
    let mut lock = attention.state.lock().unwrap();
    lock.active = false;
    lock.flashing = false;
    drop(lock);
    attention.cvar.notify_one();
    apply_tray_attention(app, false);
    request_attention(app, false);
}

#[tauri::command]
fn overlay_attention_set<R: Runtime>(app: AppHandle<R>, active: bool) -> Result<bool, String> {
    let attention = app.state::<TrayAttention>();
    let mut lock = attention.state.lock().unwrap();
    lock.active = active;
    if !active {
        lock.flashing = false;
    }
    drop(lock);
    attention.cvar.notify_one();

    if active {
        request_attention(&app, true);
        return Ok(true);
    }

    apply_tray_attention(&app, false);
    request_attention(&app, false);
    Ok(true)
}

fn badge_count_value(count: i64) -> Option<i64> {
    if count > 0 { Some(count) } else { None }
}

#[tauri::command]
#[cfg(windows)]
fn overlay_badge_set<R: Runtime>(app: AppHandle<R>, count: i64) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        let icon = if count > 0 {
            Some(create_taskbar_badge_icon())
        } else {
            None
        };
        window.set_overlay_icon(icon).map_err(|err| err.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
#[cfg(not(windows))]
fn overlay_badge_set<R: Runtime>(app: AppHandle<R>, count: i64) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        window.set_badge_count(badge_count_value(count)).map_err(|err| err.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
#[cfg(feature = "devtools")]
fn overlay_toggle_devtools<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window("main") {
        if window.is_devtools_open() {
            window.close_devtools();
        } else {
            window.open_devtools();
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
fn overlay_quit<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    stop_server(&app);
    app.exit(0);
    Ok(true)
}

fn main() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        ;

    #[cfg(feature = "devtools")]
    let builder = builder.invoke_handler(tauri::generate_handler![
            overlay_settings_load,
            overlay_settings_save,
            overlay_server_info,
            overlay_server_restart,
            overlay_open_path,
            overlay_open_url,
            overlay_open_project_editor,
            overlay_create_dir,
            overlay_write_file,
            overlay_pick_dir,
            overlay_pick_files,
            overlay_attention_set,
            overlay_badge_set,
            overlay_toggle_devtools,
            overlay_quit
    ]);

    #[cfg(not(feature = "devtools"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
            overlay_settings_load,
            overlay_settings_save,
            overlay_server_info,
            overlay_server_restart,
            overlay_open_path,
            overlay_open_url,
            overlay_open_project_editor,
            overlay_create_dir,
            overlay_write_file,
            overlay_pick_dir,
            overlay_pick_files,
            overlay_attention_set,
            overlay_badge_set,
            overlay_quit
    ]);

    builder
        .setup(|app| {
            app.manage(Server(Mutex::new(ServerState::default())));
            app.manage(TrayAttention {
                state: Mutex::new(TrayAttentionState::default()),
                cvar: Condvar::new(),
            });
            let handle = app.handle().clone();
            if let Err(err) = restart_server(&handle) {
                surface_initial_server_failure(&handle, &err);
            }

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
                    // Position: centered on primary monitor
                    let x = (logical_w - w) / 2.0;
                    let y = (logical_h - h) / 2.0;

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
                    let attention = app.state::<TrayAttention>();
                    // Block until attention becomes active. No polling, no
                    // wake-ups while idle — set/clear notify the cvar.
                    let mut lock = attention
                        .cvar
                        .wait_while(attention.state.lock().unwrap(), |s| !s.active)
                        .unwrap();
                    lock.flashing = !lock.flashing;
                    let next = lock.active && lock.flashing;
                    drop(lock);
                    apply_tray_attention(&app, next);
                    // Sleep 700ms; set/clear can wake us early via notify_one
                    // so a clear takes effect on the next iteration without
                    // waiting out the remainder of this tick.
                    let lock = attention.state.lock().unwrap();
                    let _ = attention
                        .cvar
                        .wait_timeout(lock, Duration::from_millis(700))
                        .unwrap();
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

// Tray icons are decoded once (PNG decode + Lanczos3 resize + flood-fill) and
// cached for the lifetime of the process. The flasher swaps icons every 700ms
// while attention is active, so re-running the pipeline each call burned CPU
// for no reason.

struct CachedIcon {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

fn cached_icon_image(cached: &'static CachedIcon) -> tauri::image::Image<'static> {
    tauri::image::Image::new(cached.rgba.as_slice(), cached.width, cached.height)
}

fn build_normal_tray_icon() -> CachedIcon {
    if let Some(icon) = tray_icon_from_bundle() {
        let width = icon.width();
        let height = icon.height();
        return CachedIcon { rgba: icon.rgba().to_vec(), width, height };
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

    CachedIcon { rgba, width: size, height: size }
}

fn build_attention_tray_icon() -> CachedIcon {
    let base = build_normal_tray_icon();
    let mut rgba = base.rgba.clone();
    let width = base.width;
    let height = base.height;
    let cx = 24.0_f64;
    let cy = 8.0_f64;
    let outer = 6.0_f64;
    let inner = 3.0_f64;

    for y in 0..height {
        for x in 0..width {
            let dx = x as f64 - cx;
            let dy = y as f64 - cy;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * width + x) * 4) as usize;

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

    CachedIcon { rgba, width, height }
}

fn build_taskbar_badge_icon() -> CachedIcon {
    let size: u32 = 16;
    let mut rgba = vec![0u8; (size * size * 4) as usize];
    let center = (size as f64 - 1.0) / 2.0;
    let outer = 6.0_f64;
    let inner = 2.6_f64;

    for y in 0..size {
        for x in 0..size {
            let dx = x as f64 - center;
            let dy = y as f64 - center;
            let dist = (dx * dx + dy * dy).sqrt();
            let idx = ((y * size + x) * 4) as usize;

            if dist <= outer {
                rgba[idx] = 0xf8;
                rgba[idx + 1] = 0x71;
                rgba[idx + 2] = 0x71;
                rgba[idx + 3] = if outer - dist >= 1.0 {
                    255
                } else {
                    ((outer - dist).max(0.0) * 255.0) as u8
                };
            }
            if dist <= inner {
                rgba[idx] = 0xff;
                rgba[idx + 1] = 0xff;
                rgba[idx + 2] = 0xff;
                rgba[idx + 3] = 255;
            }
        }
    }

    CachedIcon { rgba, width: size, height: size }
}

fn create_tray_icon() -> tauri::image::Image<'static> {
    static CACHED: OnceLock<CachedIcon> = OnceLock::new();
    cached_icon_image(CACHED.get_or_init(build_normal_tray_icon))
}

fn create_attention_tray_icon() -> tauri::image::Image<'static> {
    static CACHED: OnceLock<CachedIcon> = OnceLock::new();
    cached_icon_image(CACHED.get_or_init(build_attention_tray_icon))
}

fn create_taskbar_badge_icon() -> tauri::image::Image<'static> {
    static CACHED: OnceLock<CachedIcon> = OnceLock::new();
    cached_icon_image(CACHED.get_or_init(build_taskbar_badge_icon))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    /// W2-V35 — `sidecar_cwd_dir()` MUST never resolve to `/` (macOS app
    /// bundle launch default) or any other read-only root. Pre-fix, the
    /// Tauri sidecar inherited cwd from Finder, which is `/` on macOS;
    /// every server-side route that fell back to `process.cwd()` then
    /// tried to write at `/` and permission-denied. This test pins the
    /// new contract: the chosen cwd is a child of an app-data root, not
    /// the filesystem root.
    #[test]
    fn sidecar_cwd_dir_is_not_filesystem_root() {
        let dir = sidecar_cwd_dir();
        assert_ne!(dir, Path::new("/"), "sidecar cwd should not be filesystem root");
        // The chosen cwd must have at least one non-root path component
        // (e.g. `opencorvus`, `Application Support`, `AppData`, etc.) —
        // landing directly at `/` or `C:\` is the regression we're guarding
        // against.
        let has_meaningful_component = dir
            .components()
            .filter(|c| matches!(c, std::path::Component::Normal(_)))
            .next()
            .is_some();
        assert!(has_meaningful_component, "sidecar cwd has no meaningful path components: {:?}", dir);
    }

    /// `sidecar_cwd_dir()` must be deterministic for the same env so
    /// repeated launches don't drift between locations.
    #[test]
    fn sidecar_cwd_dir_is_deterministic() {
        let a = sidecar_cwd_dir();
        let b = sidecar_cwd_dir();
        assert_eq!(a, b);
    }

    /// On a portable install (`OPENCORVUS_HOME` set), the sidecar cwd
    /// must point under that root rather than the per-user app-data
    /// directory.
    #[test]
    fn sidecar_cwd_dir_respects_opencorvus_home() {
        let original = std::env::var("OPENCORVUS_HOME").ok();
        let tmp = std::env::temp_dir().join("oc_cwd_test_portable");
        std::env::set_var("OPENCORVUS_HOME", &tmp);
        let dir = sidecar_cwd_dir();
        // Reset before assert so a panic doesn't leak the var.
        match original {
            Some(v) => std::env::set_var("OPENCORVUS_HOME", v),
            None => std::env::remove_var("OPENCORVUS_HOME"),
        }
        // The portable layout is `OPENCORVUS_HOME/data/log` for log_dir;
        // the cwd we pick is its parent, i.e. `OPENCORVUS_HOME/data`.
        assert!(
            dir.starts_with(&tmp),
            "expected cwd to start with {:?}, got {:?}",
            tmp,
            dir
        );
    }

    #[test]
    fn badge_count_value_clears_zero_and_preserves_i64_positive_counts() {
        assert_eq!(badge_count_value(0), None);
        assert_eq!(badge_count_value(-1), None);
        assert_eq!(badge_count_value(42_i64), Some(42_i64));
    }

    #[test]
    fn server_info_preserves_sidecar_log_path() {
        let path = PathBuf::from("C:/opencorvus/log/sidecar-test.log");
        let info = server_info_with_pid_and_log(7878, 123, Some(path.clone()));

        assert_eq!(info.port, 7878);
        assert_eq!(info.pid, Some(123));
        assert_eq!(info.sidecar_log_path, Some(path.to_string_lossy().to_string()));
    }

    #[test]
    fn embedded_payload_contains_server_file_when_present() {
        if EMBEDDED_SERVER_FILES.is_empty() {
            return;
        }
        assert!(
            EMBEDDED_SERVER_FILES.iter().any(|file| file.path == EMBEDDED_SERVER_NAME),
            "embedded sidecar payload must include {}",
            EMBEDDED_SERVER_NAME
        );
    }

    #[test]
    fn embedded_payload_contains_browser_mcp_runtime_when_present() {
        if EMBEDDED_SERVER_FILES.is_empty() {
            return;
        }
        let node = if cfg!(windows) {
            "browser-mcp-node/node.exe"
        } else {
            "browser-mcp-node/node"
        };
        assert!(
            EMBEDDED_SERVER_FILES.iter().any(|file| file.path == "browser-mcp-node/stdio.mjs"),
            "embedded sidecar payload must include browser-mcp-node/stdio.mjs"
        );
        let node_entry = EMBEDDED_SERVER_FILES
            .iter()
            .find(|file| file.path == node)
            .unwrap_or_else(|| panic!("embedded sidecar payload must include {node}"));
        assert!(!node_entry.bytes.is_empty(), "{node} must not be embedded as an empty file");
        #[cfg(unix)]
        assert!(node_entry.executable, "{node} must be executable after extraction");
    }

    #[test]
    fn embedded_payload_contains_browser_mcp_node_modules_when_present() {
        if EMBEDDED_SERVER_FILES.is_empty() {
            return;
        }
        for package_json in [
            "node_modules/playwright/package.json",
            "node_modules/playwright-core/package.json",
            "browser-mcp-node/node_modules/playwright/package.json",
            "browser-mcp-node/node_modules/playwright-core/package.json",
        ] {
            assert!(
                EMBEDDED_SERVER_FILES.iter().any(|file| file.path == package_json),
                "embedded sidecar payload must include {package_json}"
            );
        }
    }

    #[test]
    fn embedded_payload_contains_parcel_watcher_runtime_when_present() {
        if EMBEDDED_SERVER_FILES.is_empty() {
            return;
        }

        let native_package = if cfg!(windows) {
            "node_modules/@parcel/watcher/node_modules/@parcel/watcher-win32-x64/package.json"
        } else if cfg!(target_os = "macos") && cfg!(target_arch = "x86_64") {
            "node_modules/@parcel/watcher/node_modules/@parcel/watcher-darwin-x64/package.json"
        } else if cfg!(target_os = "macos") && cfg!(target_arch = "aarch64") {
            "node_modules/@parcel/watcher/node_modules/@parcel/watcher-darwin-arm64/package.json"
        } else if cfg!(target_os = "linux") && cfg!(target_arch = "x86_64") {
            "node_modules/@parcel/watcher/node_modules/@parcel/watcher-linux-x64-glibc/package.json"
        } else if cfg!(target_os = "linux") && cfg!(target_arch = "aarch64") {
            "node_modules/@parcel/watcher/node_modules/@parcel/watcher-linux-arm64-glibc/package.json"
        } else {
            return;
        };

        for path in ["node_modules/@parcel/watcher/wrapper.js", native_package] {
            assert!(
                EMBEDDED_SERVER_FILES.iter().any(|file| file.path == path),
                "embedded sidecar payload must include {path}"
            );
        }
    }

    #[test]
    fn startup_failure_diagnostic_includes_error_and_log_path() {
        let path = PathBuf::from("C:/opencorvus/log/overlay-startup.log");
        let message = startup_failure_diagnostic_message("spawn failed", Some(&path));

        assert!(message.contains("OpenCorvus backend failed to start."));
        assert!(message.contains("spawn failed"));
        assert!(message.contains("overlay-startup.log"));
    }

    #[test]
    fn taskbar_badge_icon_is_dot_only_not_full_app_icon() {
        let icon = build_taskbar_badge_icon();
        assert_eq!(icon.width, 16);
        assert_eq!(icon.height, 16);
        assert_eq!(icon.rgba.len(), 16 * 16 * 4);
        assert_eq!(icon.rgba[3], 0, "corner must stay transparent");

        let center = ((8 * icon.width + 8) * 4) as usize;
        assert_eq!(&icon.rgba[center..center + 4], &[0xff, 0xff, 0xff, 0xff]);

        let opaque_pixels = icon.rgba.chunks_exact(4).filter(|px| px[3] > 0).count();
        assert!(
            opaque_pixels < (16 * 16) / 2,
            "taskbar badge overlay must be a small glyph, not a full icon"
        );
    }
}
