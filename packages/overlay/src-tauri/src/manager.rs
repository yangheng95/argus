use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::events;

const CONFIG_FILE: &str = "opencorvus-manager.json";
const LOG_FILE: &str = "opencorvus-manager-log.jsonl";
const MAX_LOGS: usize = 800;
const CONFIG_SCHEMA: &str = "https://opencorvus.ai/config.json";
const SHARED_SESSION_FILE: &str = "shared-session.json";
const MIRROR_PREFIX: &str = "[opencorvus-mirror]";
const CORE_PID_FILE: &str = "opencorvus-core.pid";
const CHANNEL_PID_FILE: &str = "opencorvus-channel.pid";

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct EnvItem {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum McpQuickConfig {
    Local { command: Vec<String> },
    Remote { url: String },
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct ManagerConfig {
    pub command: String,
    pub serve_args: Vec<String>,
    pub run_args: Vec<String>,
    pub bot_command: String,
    pub bot_args: Vec<String>,
    pub server_url: String,
    pub cwd: String,
    pub env: Vec<EnvItem>,
}

#[derive(Serialize, Clone)]
pub struct ManagerSnapshot {
    pub running: bool,
    pub prompt_running: bool,
    pub pid: Option<u32>,
    pub channel_running: bool,
    pub channel_pid: Option<u32>,
    pub shared_session_id: Option<String>,
    pub server_url: String,
    pub config: ManagerConfig,
    pub logs: Vec<LogEntry>,
    pub log_path: String,
}

#[derive(Serialize)]
pub struct SendResult {
    pub success: bool,
    pub code: i32,
    pub output: String,
}

#[derive(Serialize)]
pub struct SendAck {
    pub accepted: bool,
}

#[derive(Serialize, Clone)]
pub struct ChatEvent {
    pub kind: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub alt: Option<String>,
    pub success: Option<bool>,
    pub code: Option<i32>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct LogEntry {
    pub ts: u64,
    pub level: String,
    pub tag: String,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}

pub struct ManagerState {
    config: ManagerConfig,
    logs: VecDeque<LogEntry>,
    log_path: String,
    core: Option<Child>,
    channel: Option<Child>,
    prompt_running: bool,
}

pub type Shared = Arc<Mutex<ManagerState>>;

impl Default for ManagerConfig {
    fn default() -> Self {
        // Prefer sibling binary in the same directory as this overlay executable.
        // Falls back to bare "opencorvus" (relies on PATH) if unavailable.
        let command = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|dir| dir.join("opencorvus")))
            .filter(|p| p.exists())
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "opencorvus".into());

        Self {
            command,
            serve_args: vec![
                "serve".into(),
                "--hostname=127.0.0.1".into(),
                "--port=4096".into(),
            ],
            run_args: vec!["run".into()],
            bot_command: "bun".into(),
            bot_args: vec![
                "run".into(),
                "--no-env-file".into(),
                "--env-file".into(),
                ".env".into(),
                "packages/bot/src/main.ts".into(),
            ],
            server_url: "http://127.0.0.1:4096".into(),
            cwd: String::new(),
            env: vec![],
        }
    }
}

impl ManagerState {
    fn new() -> Self {
        Self {
            config: ManagerConfig::default(),
            logs: VecDeque::new(),
            log_path: String::new(),
            core: None,
            channel: None,
            prompt_running: false,
        }
    }
}

fn stamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs())
        .unwrap_or(0)
}

fn norm_list(list: Vec<String>) -> Vec<String> {
    list.into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn norm_config(config: ManagerConfig) -> ManagerConfig {
    let defaults = ManagerConfig::default();
    ManagerConfig {
        command: {
            let item = config.command.trim();
            if item.is_empty() {
                // Empty command in config: use sibling binary detection same as Default.
                defaults.command
            } else {
                item.into()
            }
        },
        serve_args: norm_list(config.serve_args),
        run_args: norm_list(config.run_args),
        bot_command: config.bot_command.trim().into(),
        bot_args: norm_list(config.bot_args),
        server_url: {
            let item = config.server_url.trim();
            if item.is_empty() {
                defaults.server_url
            } else {
                item.into()
            }
        },
        cwd: config.cwd.trim().into(),
        env: config
            .env
            .into_iter()
            .map(|item| EnvItem {
                key: item.key.trim().into(),
                value: item.value.trim().into(),
            })
            .filter(|item| !item.key.is_empty())
            .collect(),
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(CONFIG_FILE))
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(LOG_FILE))
}

fn pid_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join(name))
}

fn read_pid(path: &Path) -> Option<u32> {
    let text = fs::read_to_string(path).ok()?;
    text.trim().parse::<u32>().ok()
}

fn write_pid(app: &AppHandle, name: &str, pid: u32) -> Result<(), String> {
    let path = pid_path(app, name)?;
    fs::write(path, format!("{pid}\n")).map_err(|error| error.to_string())
}

fn clear_pid(app: &AppHandle, name: &str) {
    if let Ok(path) = pid_path(app, name) {
        let _ = fs::remove_file(path);
    }
}

#[cfg(target_os = "windows")]
fn kill_pid(pid: u32) -> Result<(), String> {
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        return Ok(());
    }
    Err(format!(
        "taskkill failed for pid {pid} (code {})",
        status
            .code()
            .map(|item| item.to_string())
            .unwrap_or_else(|| "signal".into())
    ))
}

#[cfg(not(target_os = "windows"))]
fn kill_pid(pid: u32) -> Result<(), String> {
    let status = Command::new("kill")
        .arg("-TERM")
        .arg(pid.to_string())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| error.to_string())?;
    if status.success() {
        return Ok(());
    }
    Err(format!(
        "kill failed for pid {pid} (code {})",
        status
            .code()
            .map(|item| item.to_string())
            .unwrap_or_else(|| "signal".into())
    ))
}

fn clear_stale_pid(shared: &Shared, app: &AppHandle, name: &str, label: &str) {
    let Ok(path) = pid_path(app, name) else {
        return;
    };
    let Some(pid) = read_pid(&path) else {
        return;
    };
    if pid == std::process::id() {
        let _ = fs::remove_file(path);
        return;
    }
    match kill_pid(pid) {
        Ok(()) => {
            push_log(shared, app, format!("killed stale {label} process (pid {pid})"));
        }
        Err(error) => {
            push_log(shared, app, format!("failed to kill stale {label} process (pid {pid}): {error}"));
        }
    }
    let _ = fs::remove_file(path);
}

fn load_config(app: &AppHandle) -> Result<ManagerConfig, String> {
    let path = config_path(app)?;
    if !path.exists() {
        return Ok(ManagerConfig::default());
    }
    let data = fs::read_to_string(path).map_err(|error| error.to_string())?;
    let parsed = serde_json::from_str::<ManagerConfig>(&data).map_err(|error| error.to_string())?;
    Ok(norm_config(parsed))
}

fn save_config(app: &AppHandle, config: &ManagerConfig) -> Result<(), String> {
    let path = config_path(app)?;
    let data = serde_json::to_string_pretty(config).map_err(|error| error.to_string())?;
    fs::write(path, data).map_err(|error| error.to_string())
}

fn work_dir(shared: &Shared) -> PathBuf {
    let cwd = {
        let state = shared.lock().unwrap();
        state.config.cwd.trim().to_string()
    };
    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    if cwd.is_empty() {
        return root;
    }
    let path = PathBuf::from(cwd);
    if path.is_absolute() {
        return path;
    }
    root.join(path)
}

fn shared_session_path(shared: &Shared) -> PathBuf {
    work_dir(shared).join(".opencorvus").join(SHARED_SESSION_FILE)
}

fn read_shared_session(shared: &Shared) -> Option<String> {
    let path = shared_session_path(shared);
    let text = fs::read_to_string(path).ok()?;
    let raw = serde_json::from_str::<serde_json::Value>(&text).ok()?;
    let id = raw.get("session_id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    Some(id.to_string())
}

fn write_shared_session(shared: &Shared, session_id: &str) -> Result<(), String> {
    let id = session_id.trim();
    if id.is_empty() {
        return Ok(());
    }
    let path = shared_session_path(shared);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let body = serde_json::json!({
        "session_id": id,
        "updated_at": stamp(),
    });
    let text = serde_json::to_string_pretty(&body).map_err(|error| error.to_string())?;
    fs::write(path, format!("{text}\n")).map_err(|error| error.to_string())
}

fn opencorvus_config_path(base: &Path) -> PathBuf {
    base.join(".opencorvus").join("opencorvus.json")
}

fn ensure_opencorvus_config(path: &Path) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let content = format!("{{\n  \"$schema\": \"{CONFIG_SCHEMA}\",\n  \"mcp\": {{}}\n}}\n");
    fs::write(path, content).map_err(|error| error.to_string())
}

fn valid_name(input: &str) -> bool {
    if input.is_empty() || input.len() > 64 {
        return false;
    }
    let bytes = input.as_bytes();
    if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
        return false;
    }
    let mut dash = false;
    for byte in bytes {
        if byte.is_ascii_lowercase() || byte.is_ascii_digit() {
            dash = false;
            continue;
        }
        if *byte == b'-' {
            if dash {
                return false;
            }
            dash = true;
            continue;
        }
        return false;
    }
    true
}

fn yaml_text(input: &str) -> String {
    input.replace('\\', "\\\\").replace('"', "\\\"")
}

fn open_target(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/C")
            .arg("start")
            .arg("")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(path)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn build_command(config: &ManagerConfig, args: &[String]) -> Command {
    build_process(&config.command, args, &config.cwd, &config.env)
}

fn build_process(command: &str, args: &[String], cwd: &str, env: &[EnvItem]) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args);
    if !cwd.is_empty() {
        cmd.current_dir(cwd);
    }
    for item in env {
        cmd.env(&item.key, &item.value);
    }
    cmd
}

fn watch_pipe<R: Read + Send + 'static>(shared: Shared, app: AppHandle, source: R, tag: &'static str) {
    std::thread::spawn(move || {
        for line in BufReader::new(source).lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => {
                    if tag == "channel" {
                        if let Some(event) = parse_channel_mirror(&text) {
                            let kind = event.kind.clone();
                            let emit_ok = app.emit_to(events::WINDOW_CONSOLE, events::EVT_MANAGER_CHAT, event).is_ok();
                            push_log(&shared, &app, format!("[mirror-debug] kind={kind} emit_ok={emit_ok}"));
                            continue;
                        }
                    }
                    push_log(&shared, &app, format!("[{tag}] {text}"));
                }
                Ok(_) => {}
                Err(error) => {
                    push_log(&shared, &app, format!("[{tag}] stream read failed: {error}"));
                    break;
                }
            }
        }
    });
}

fn emit_chat(
    app: &AppHandle,
    kind: &str,
    text: Option<String>,
    url: Option<String>,
    alt: Option<String>,
    success: Option<bool>,
    code: Option<i32>,
) {
    let _ = app.emit_to(
        events::WINDOW_CONSOLE,
        events::EVT_MANAGER_CHAT,
        ChatEvent {
            kind: kind.into(),
            text,
            url,
            alt,
            success,
            code,
        },
    );
}

fn parse_channel_mirror(line: &str) -> Option<ChatEvent> {
    let body = line.trim().strip_prefix(MIRROR_PREFIX)?;
    let raw = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let kind = raw.get("kind")?.as_str()?;
    let text = raw.get("text")?.as_str()?.trim();
    if text.is_empty() {
        return None;
    }
    let platform = raw
        .get("platform")
        .and_then(|item| item.as_str())
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string());
    let channel = raw
        .get("channel")
        .and_then(|item| item.as_str())
        .map(|item| item.trim())
        .filter(|item| !item.is_empty())
        .map(|item| item.to_string());
    let source = match (platform, channel) {
        (Some(p), Some(c)) => format!("[{p}:{c}] "),
        (Some(p), None) => format!("[{p}] "),
        (None, Some(c)) => format!("[{c}] "),
        (None, None) => String::new(),
    };
    let kind = match kind {
        "user" => "mirror_user",
        "assistant" => "mirror_assistant",
        "system" => "mirror_system",
        _ => return None,
    };
    Some(ChatEvent {
        kind: kind.into(),
        text: Some(format!("{source}{text}")),
        url: None,
        alt: None,
        success: None,
        code: None,
    })
}

fn ensure_json_format(args: Vec<String>) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut seen = false;
    let mut i = 0usize;
    while i < args.len() {
        let item = &args[i];
        if item == "--format" {
            out.push("--format".into());
            out.push("json".into());
            seen = true;
            i += 1;
            if i < args.len() {
                i += 1;
            }
            continue;
        }
        if item.starts_with("--format=") {
            out.push("--format=json".into());
            seen = true;
            i += 1;
            continue;
        }
        out.push(item.clone());
        i += 1;
    }
    if !seen {
        out.push("--format".into());
        out.push("json".into());
    }
    out
}

fn ensure_attach(args: Vec<String>, url: &str) -> Vec<String> {
    if url.trim().is_empty() {
        return args;
    }
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut seen = false;
    let mut i = 0usize;
    while i < args.len() {
        let item = &args[i];
        if item == "--attach" {
            out.push("--attach".into());
            out.push(url.into());
            seen = true;
            i += 1;
            if i < args.len() {
                i += 1;
            }
            continue;
        }
        if item.starts_with("--attach=") {
            out.push(format!("--attach={url}"));
            seen = true;
            i += 1;
            continue;
        }
        out.push(item.clone());
        i += 1;
    }
    if !seen {
        out.push("--attach".into());
        out.push(url.into());
    }
    out
}

fn ensure_session(args: Vec<String>, session_id: &str) -> Vec<String> {
    if session_id.trim().is_empty() {
        return args;
    }
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut seen = false;
    let mut i = 0usize;
    while i < args.len() {
        let item = &args[i];
        if item == "--session" {
            out.push("--session".into());
            out.push(session_id.into());
            seen = true;
            i += 1;
            if i < args.len() {
                i += 1;
            }
            continue;
        }
        if item.starts_with("--session=") {
            out.push(format!("--session={session_id}"));
            seen = true;
            i += 1;
            continue;
        }
        out.push(item.clone());
        i += 1;
    }
    if !seen {
        out.push("--session".into());
        out.push(session_id.into());
    }
    out
}

fn emit_delta(app: &AppHandle, output: &mut String, text: &str) {
    if text.is_empty() {
        return;
    }
    output.push_str(text);
    emit_chat(app, "delta", Some(text.into()), None, None, None, None);
}

fn emit_replace(app: &AppHandle, output: &mut String, text: &str) {
    output.clear();
    output.push_str(text);
    emit_chat(app, "replace", Some(text.into()), None, None, None, None);
}

fn process_json_line(app: &AppHandle, value: &serde_json::Value, output: &mut String, delta_seen: &mut bool) -> bool {
    let Some(kind) = value.get("type").and_then(|item| item.as_str()) else {
        return false;
    };

    // Silently discard structural / metadata events that should not appear in chat output.
    if matches!(kind, "step_start" | "step_finish" | "reasoning" | "reasoning_delta") {
        return true;
    }

    if kind == "text_delta" {
        let Some(delta) = value.get("delta").and_then(|item| item.as_str()) else {
            return true;
        };
        *delta_seen = true;
        emit_delta(app, output, delta);
        return true;
    }

    if kind == "text" {
        let Some(text) = value.pointer("/part/text").and_then(|item| item.as_str()) else {
            return true;
        };
        if !*delta_seen {
            emit_replace(app, output, text);
        }
        return true;
    }

    if kind == "file" {
        let Some(mime) = value.pointer("/part/mime").and_then(|item| item.as_str()) else {
            return true;
        };
        if !mime.starts_with("image/") {
            return true;
        }
        let Some(url) = value.pointer("/part/url").and_then(|item| item.as_str()) else {
            return true;
        };
        let alt = value
            .pointer("/part/filename")
            .and_then(|item| item.as_str())
            .unwrap_or("image");
        emit_chat(app, "image", None, Some(url.into()), Some(alt.into()), None, None);
        return true;
    }

    if kind == "tool_use" {
        let Some(items) = value.pointer("/part/state/attachments").and_then(|item| item.as_array()) else {
            return true;
        };
        for item in items {
            let Some(mime) = item.get("mime").and_then(|x| x.as_str()) else {
                continue;
            };
            if !mime.starts_with("image/") {
                continue;
            }
            let Some(url) = item.get("url").and_then(|x| x.as_str()) else {
                continue;
            };
            let alt = item
                .get("filename")
                .and_then(|x| x.as_str())
                .unwrap_or("image");
            emit_chat(app, "image", None, Some(url.into()), Some(alt.into()), None, None);
        }
        return true;
    }

    if kind == "error" {
        let text = value
            .pointer("/error/data/message")
            .and_then(|item| item.as_str())
            .or_else(|| value.pointer("/error/name").and_then(|item| item.as_str()))
            .unwrap_or("Unknown error");
        emit_chat(app, "system", Some(text.into()), None, None, None, None);
        return true;
    }

    false
}

fn run_prompt(shared: &Shared, app: &AppHandle, prompt: String) -> SendResult {
    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };
    let shared_session = read_shared_session(shared);

    push_log(shared, app, format!("prompt> {prompt}"));

    let mut args = if config.run_args.first().map(|item| item.as_str()) == Some("run") {
        let formatted = ensure_json_format(config.run_args.clone());
        let attached = ensure_attach(formatted, &config.server_url);
        if let Some(item) = shared_session.as_ref() {
            ensure_session(attached, item)
        } else {
            attached
        }
    } else {
        config.run_args.clone()
    };
    args.push(prompt);

    let mut cmd = build_command(&config, &args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    emit_chat(app, "start", None, None, None, None, None);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("failed to run prompt command: {error}");
            push_log(shared, app, message.clone());
            emit_chat(app, "system", Some(message.clone()), None, None, None, None);
            emit_chat(app, "done", None, None, None, Some(false), Some(-1));
            return SendResult {
                success: false,
                code: -1,
                output: message,
            };
        }
    };

    let mut stderr_task = None;
    if let Some(stderr) = child.stderr.take() {
        let app2 = app.clone();
        let shared2 = shared.clone();
        stderr_task = Some(std::thread::spawn(move || {
            let mut text = String::new();
            for line in BufReader::new(stderr).lines() {
                match line {
                    Ok(item) if !item.trim().is_empty() => {
                        push_log(&shared2, &app2, format!("[run:err] {item}"));
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(item.trim_end());
                    }
                    Ok(_) => {}
                    Err(error) => {
                        push_log(&shared2, &app2, format!("[run:err] stream read failed: {error}"));
                        break;
                    }
                }
            }
            text
        }));
    }

    let mut out = String::new();
    let mut delta_seen = false;
    let mut captured_session: Option<String> = None;
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(item) if !item.trim().is_empty() => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&item) {
                        if captured_session.is_none() {
                            if let Some(session_id) = value.get("sessionID").and_then(|entry| entry.as_str()) {
                                let next = session_id.trim();
                                if !next.is_empty() {
                                    captured_session = Some(next.to_string());
                                }
                            }
                        }
                        if process_json_line(app, &value, &mut out, &mut delta_seen) {
                            continue;
                        }
                    }
                    push_log(shared, app, format!("[run] {item}"));
                    let chunk = format!("{item}\n");
                    emit_delta(app, &mut out, &chunk);
                    delta_seen = true;
                }
                Ok(_) => {}
                Err(error) => {
                    let line = format!("[run] stream read failed: {error}");
                    push_log(shared, app, line.clone());
                    emit_chat(app, "system", Some(line), None, None, None, None);
                    break;
                }
            }
        }
    }

    let stderr = stderr_task
        .map(|task| task.join().unwrap_or_default())
        .unwrap_or_default();

    let status = match child.wait() {
        Ok(item) => item,
        Err(error) => {
            let message = format!("failed to wait prompt command: {error}");
            push_log(shared, app, message.clone());
            emit_chat(app, "system", Some(message.clone()), None, None, None, None);
            emit_chat(app, "done", None, None, None, Some(false), Some(-1));
            return SendResult {
                success: false,
                code: -1,
                output: message,
            };
        }
    };

    let success = status.success();
    let code = status.code().unwrap_or(if success { 0 } else { -1 });
    let text = if !out.trim().is_empty() {
        out.trim_end().into()
    } else if !stderr.is_empty() {
        stderr
    } else if success {
        "(empty response)".into()
    } else {
        format!("command failed with code {code}")
    };

    if !success {
        emit_chat(
            app,
            "system",
            Some(format!("Command failed (code {code}): {text}")),
            None,
            None,
            None,
            None,
        );
    }

    if shared_session.is_none() {
        if let Some(session_id) = captured_session {
            if write_shared_session(shared, &session_id).is_ok() {
                push_log(shared, app, format!("shared session captured: {session_id}"));
                emit_state(shared, app);
            }
        }
    }

    emit_chat(app, "done", None, None, None, Some(success), Some(code));
    SendResult { success, code, output: text }
}

pub fn new_shared() -> Shared {
    Arc::new(Mutex::new(ManagerState::new()))
}

pub fn show_console(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(events::WINDOW_CONSOLE) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn snapshot(shared: &Shared) -> ManagerSnapshot {
    // Read shared session BEFORE locking to avoid deadlock:
    // read_shared_session -> shared_session_path -> work_dir -> shared.lock() would deadlock
    // if snapshot() already holds the lock.
    let shared_session_id = read_shared_session(shared);
    let state = shared.lock().unwrap();
    ManagerSnapshot {
        running: state.core.is_some(),
        prompt_running: state.prompt_running,
        pid: state.core.as_ref().map(|child| child.id()),
        channel_running: state.channel.is_some(),
        channel_pid: state.channel.as_ref().map(|child| child.id()),
        shared_session_id,
        server_url: state.config.server_url.clone(),
        config: state.config.clone(),
        logs: state.logs.iter().cloned().collect(),
        log_path: state.log_path.clone(),
    }
}

pub fn emit_state(shared: &Shared, app: &AppHandle) {
    let _ = app.emit_to(events::WINDOW_CONSOLE, events::EVT_MANAGER_STATE, snapshot(shared));
}

fn persist_log(app: &AppHandle, item: &LogEntry) {
    let Ok(path) = log_path(app) else {
        return;
    };
    let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(path) else {
        return;
    };
    let Ok(line) = serde_json::to_string(item) else {
        return;
    };
    let _ = writeln!(file, "{line}");
}

fn push_log_entry(shared: &Shared, app: &AppHandle, item: LogEntry) {
    persist_log(app, &item);
    {
        let mut state = shared.lock().unwrap();
        if state.log_path.is_empty() {
            state.log_path = log_path(app)
                .map(|item| item.to_string_lossy().to_string())
                .unwrap_or_default();
        }
        state.logs.push_back(item.clone());
        while state.logs.len() > MAX_LOGS {
            state.logs.pop_front();
        }
    }
    let _ = app.emit_to(events::WINDOW_CONSOLE, events::EVT_MANAGER_LOG, item);
}

pub fn push_log(shared: &Shared, app: &AppHandle, line: impl Into<String>) {
    push_log_entry(
        shared,
        app,
        LogEntry {
            ts: stamp(),
            level: "info".into(),
            tag: "manager".into(),
            message: line.into(),
            detail: None,
        },
    );
}

pub fn push_log_json(
    shared: &Shared,
    app: &AppHandle,
    level: impl Into<String>,
    tag: impl Into<String>,
    message: impl Into<String>,
    detail: Option<serde_json::Value>,
) {
    push_log_entry(
        shared,
        app,
        LogEntry {
            ts: stamp(),
            level: level.into(),
            tag: tag.into(),
            message: message.into(),
            detail,
        },
    );
}

pub fn probe(shared: &Shared, app: &AppHandle) {
    let (notes, core_exited, channel_exited) = {
        let mut state = shared.lock().unwrap();
        let mut lines = Vec::<String>::new();
        let mut core_done = false;
        let mut channel_done = false;
        if let Some(child) = state.core.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    state.core = None;
                    let code = status.code().map(|item| item.to_string()).unwrap_or_else(|| "signal".into());
                    lines.push(format!("OpenCorvus exited ({code})"));
                    core_done = true;
                }
                Ok(None) => {}
                Err(error) => {
                    state.core = None;
                    lines.push(format!("failed to check OpenCorvus status: {error}"));
                    core_done = true;
                }
            }
        }
        if let Some(child) = state.channel.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    state.channel = None;
                    let code = status.code().map(|item| item.to_string()).unwrap_or_else(|| "signal".into());
                    lines.push(format!("channel bot exited ({code})"));
                    channel_done = true;
                }
                Ok(None) => {}
                Err(error) => {
                    state.channel = None;
                    lines.push(format!("failed to check channel bot status: {error}"));
                    channel_done = true;
                }
            }
        }
        (lines, core_done, channel_done)
    };

    if notes.is_empty() {
        return;
    }
    if core_exited {
        clear_pid(app, CORE_PID_FILE);
    }
    if channel_exited {
        clear_pid(app, CHANNEL_PID_FILE);
    }
    for line in notes {
        push_log(shared, app, line);
    }
    emit_state(shared, app);
}

pub fn init(shared: &Shared, app: &AppHandle) {
    if let Ok(path) = log_path(app) {
        shared.lock().unwrap().log_path = path.to_string_lossy().to_string();
    }
    if let Ok(config) = load_config(app) {
        shared.lock().unwrap().config = config;
    }
    if let Some(session_id) = read_shared_session(shared) {
        push_log(shared, app, format!("shared session: {session_id}"));
    }
    push_log(shared, app, "OpenCorvus manager ready");
    emit_state(shared, app);
}

fn start_channel(shared: &Shared, app: &AppHandle, config: &ManagerConfig) -> Result<(), String> {
    if config.bot_command.trim().is_empty() {
        push_log(shared, app, "channel bot command is empty, skip auto-start");
        return Ok(());
    }

    let already = {
        let state = shared.lock().unwrap();
        state.channel.is_some()
    };
    if already {
        return Ok(());
    }

    let args = config.bot_args.clone();
    let mut cmd = build_process(&config.bot_command, &args, &config.cwd, &config.env);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.env("OPENCORVUS_BOT_SERVER_URL", config.server_url.clone());
    cmd.env("OPENCORVUS_SHARED_SESSION_MODE", "1");
    cmd.env("OPENCORVUS_MIRROR_STDOUT", "1");
    cmd.env(
        "OPENCORVUS_SHARED_SESSION_FILE",
        shared_session_path(shared).to_string_lossy().to_string(),
    );

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("failed to start channel bot ({}): {error}", config.bot_command))?;

    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        watch_pipe(shared.clone(), app.clone(), stdout, "channel");
    }
    if let Some(stderr) = child.stderr.take() {
        watch_pipe(shared.clone(), app.clone(), stderr, "channel:err");
    }

    {
        let mut state = shared.lock().unwrap();
        state.channel = Some(child);
    }
    if let Err(error) = write_pid(app, CHANNEL_PID_FILE, pid) {
        push_log(shared, app, format!("failed to persist channel pid {pid}: {error}"));
    }

    push_log(
        shared,
        app,
        format!(
            "channel bot started (pid {pid}) with: {} {}",
            config.bot_command,
            config.bot_args.join(" ")
        ),
    );
    Ok(())
}

pub fn start_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    probe(shared, app);

    let config = {
        let state = shared.lock().unwrap();
        if state.core.is_some() {
            push_log(shared, app, "OpenCorvus is already running");
            return Ok(());
        }
        state.config.clone()
    };

    clear_stale_pid(shared, app, CHANNEL_PID_FILE, "channel bot");
    clear_stale_pid(shared, app, CORE_PID_FILE, "OpenCorvus");

    let mut cmd = build_command(&config, &config.serve_args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("failed to start OpenCorvus ({}): {error}", config.command))?;

    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        watch_pipe(shared.clone(), app.clone(), stdout, "core");
    }
    if let Some(stderr) = child.stderr.take() {
        watch_pipe(shared.clone(), app.clone(), stderr, "core:err");
    }

    {
        let mut state = shared.lock().unwrap();
        state.core = Some(child);
    }
    if let Err(error) = write_pid(app, CORE_PID_FILE, pid) {
        push_log(shared, app, format!("failed to persist OpenCorvus pid {pid}: {error}"));
    }

    push_log(
        shared,
        app,
        format!("OpenCorvus started (pid {pid}) with: {} {}", config.command, config.serve_args.join(" ")),
    );

    if let Err(error) = start_channel(shared, app, &config) {
        push_log(shared, app, format!("channel bot auto-start failed: {error}"));
    }

    emit_state(shared, app);
    Ok(())
}

pub fn stop_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    let mut channel = {
        let mut state = shared.lock().unwrap();
        state.channel.take()
    };
    let mut core = {
        let mut state = shared.lock().unwrap();
        state.core.take()
    };

    if let Some(proc) = channel.as_mut() {
        proc.kill().map_err(|error| format!("failed to stop channel bot: {error}"))?;
        let _ = proc.wait();
        push_log(shared, app, "channel bot stopped");
    }

    if let Some(proc) = core.as_mut() {
        proc.kill().map_err(|error| format!("failed to stop OpenCorvus: {error}"))?;
        let _ = proc.wait();
        push_log(shared, app, "OpenCorvus stopped");
    } else {
        push_log(shared, app, "OpenCorvus is already stopped");
    }
    clear_pid(app, CHANNEL_PID_FILE);
    clear_pid(app, CORE_PID_FILE);

    emit_state(shared, app);
    Ok(())
}

pub fn clear_logs(shared: &Shared, app: &AppHandle) -> ManagerSnapshot {
    {
        let mut data = shared.lock().unwrap();
        data.logs.clear();
    }
    push_log(shared, app, "logs cleared");
    emit_state(shared, app);
    snapshot(shared)
}

pub fn save(shared: &Shared, app: &AppHandle, config: ManagerConfig) -> Result<ManagerSnapshot, String> {
    let config = norm_config(config);
    save_config(app, &config)?;

    {
        let mut data = shared.lock().unwrap();
        data.config = config;
    }

    push_log(shared, app, "configuration saved");
    emit_state(shared, app);
    Ok(snapshot(shared))
}

pub fn open_mcp_config(shared: &Shared, app: &AppHandle) -> Result<String, String> {
    let path = opencorvus_config_path(&work_dir(shared));
    ensure_opencorvus_config(&path)?;
    open_target(&path)?;
    let value = path.to_string_lossy().to_string();
    push_log(shared, app, format!("opened MCP config: {value}"));
    Ok(value)
}

pub fn open_skill_dir(shared: &Shared, app: &AppHandle) -> Result<String, String> {
    let path = work_dir(shared).join(".opencorvus").join("skills");
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    open_target(&path)?;
    let value = path.to_string_lossy().to_string();
    push_log(shared, app, format!("opened skills folder: {value}"));
    Ok(value)
}

pub fn add_mcp(
    shared: &Shared,
    app: &AppHandle,
    name: String,
    config: McpQuickConfig,
) -> Result<String, String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("invalid MCP name, use lowercase letters/numbers and single '-'".into());
    }

    let path = opencorvus_config_path(&work_dir(shared));
    ensure_opencorvus_config(&path)?;
    let text = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut data: serde_json::Value = serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let Some(root) = data.as_object_mut() else {
        return Err("invalid config root, expected JSON object".into());
    };

    if !root.contains_key("$schema") {
        root.insert("$schema".into(), serde_json::Value::String(CONFIG_SCHEMA.into()));
    }

    if !root.contains_key("mcp") {
        root.insert("mcp".into(), serde_json::json!({}));
    }

    let Some(mcp) = root.get_mut("mcp").and_then(|item| item.as_object_mut()) else {
        return Err("invalid `mcp` field, expected object".into());
    };

    let value = match config {
        McpQuickConfig::Local { command } => {
            let command = command
                .into_iter()
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>();
            if command.is_empty() {
                return Err("local MCP command is empty".into());
            }
            serde_json::json!({
                "type": "local",
                "command": command,
            })
        }
        McpQuickConfig::Remote { url } => {
            let url = url.trim().to_string();
            if url.is_empty() || !url.starts_with("http") {
                return Err("remote MCP URL must start with http/https".into());
            }
            serde_json::json!({
                "type": "remote",
                "url": url,
            })
        }
    };

    mcp.insert(name.clone(), value);

    let output = serde_json::to_string_pretty(&data).map_err(|error| error.to_string())?;
    fs::write(&path, format!("{output}\n")).map_err(|error| error.to_string())?;
    open_target(&path)?;
    let value = path.to_string_lossy().to_string();
    push_log(shared, app, format!("added MCP `{name}` in {value}"));
    Ok(value)
}

pub fn create_skill(
    shared: &Shared,
    app: &AppHandle,
    name: String,
    description: String,
) -> Result<String, String> {
    let name = name.trim().to_string();
    if !valid_name(&name) {
        return Err("invalid skill name, use lowercase letters/numbers and single '-'".into());
    }

    let description = {
        let text = description.trim();
        if text.is_empty() {
            "Describe when and why this skill should be used.".to_string()
        } else {
            text.to_string()
        }
    };

    let dir = work_dir(shared).join(".opencorvus").join("skills").join(&name);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join("SKILL.md");
    if !path.exists() {
        let content = format!(
            "---\nname: {name}\ndescription: \"{}\"\n---\n\n## Purpose\n\n## When To Use\n\n## Steps\n\n",
            yaml_text(&description)
        );
        fs::write(&path, content).map_err(|error| error.to_string())?;
    }
    open_target(&path)?;
    let value = path.to_string_lossy().to_string();
    push_log(shared, app, format!("created skill scaffold: {value}"));
    Ok(value)
}

pub fn send(shared: &Shared, app: &AppHandle, prompt: String) -> Result<SendAck, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }

    {
        let mut state = shared.lock().unwrap();
        if state.prompt_running {
            return Err("a prompt is already running".into());
        }
        state.prompt_running = true;
    }

    emit_state(shared, app);

    let shared2 = shared.clone();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = run_prompt(&shared2, &app2, prompt);
        if !result.success {
            push_log(
                &shared2,
                &app2,
                format!("prompt failed (code {}): {}", result.code, result.output),
            );
        }
        {
            let mut state = shared2.lock().unwrap();
            state.prompt_running = false;
        }
        emit_state(&shared2, &app2);
    });

    Ok(SendAck { accepted: true })
}
