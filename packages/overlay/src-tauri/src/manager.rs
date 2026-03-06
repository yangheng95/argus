use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::events;
use base64::Engine as _;
#[cfg(target_os = "windows")]
use encoding_rs::GB18030;

const CONFIG_FILE: &str = "opencorvus-manager.json";
const LOG_FILE: &str = "opencorvus-manager-log.jsonl";
const MAX_LOGS: usize = 800;
const CONFIG_SCHEMA: &str = "https://opencorvus.ai/config.json";
const SHARED_SESSION_FILE: &str = "shared-session.json";
const MIRROR_PREFIX: &str = "[opencorvus-mirror]";
const CORE_PID_FILE: &str = "opencorvus-core.pid";
const CHANNEL_PID_FILE: &str = "opencorvus-channel.pid";
const SCREENSHOT_SCHEME: &str = "opencorvus://screenshot/";
const ENV_TUI_LLM_BASE_URL: &str = "OPENCORVUS_TUI_LLM_BASE_URL";
const ENV_TUI_LLM_API_KEY: &str = "OPENCORVUS_TUI_LLM_API_KEY";
const ENV_BOT_LLM_BASE_URL: &str = "OPENCORVUS_BOT_LLM_BASE_URL";
const ENV_BOT_LLM_API_KEY: &str = "OPENCORVUS_BOT_LLM_API_KEY";
const ENV_LLM_BASE_URL: &str = "OPENCORVUS_BASE_URL";
const ENV_LLM_API_KEY: &str = "OPENCORVUS_API_KEY";
const SESSION_API_TIMEOUT_CONNECT_MS: u64 = 350;
const SESSION_API_TIMEOUT_READ_MS: u64 = 15_000;
const CHANNEL_SLACK_ENV: &[&str] = &[
    "SLACK_BOT_TOKEN",
    "SLACK_APP_TOKEN",
    "SLACK_SIGNING_SECRET",
    "SLACK_CHANNEL_ID",
    "OPENCLAW_SLACK_BOT_TOKEN",
    "OPENCLAW_SLACK_APP_TOKEN",
    "OPENCLAW_SLACK_SIGNING_SECRET",
];
const CHANNEL_TELEGRAM_ENV: &[&str] = &["TELEGRAM_BOT_TOKEN", "OPENCLAW_TELEGRAM_BOT_TOKEN"];
const CHANNEL_DISCORD_ENV: &[&str] = &["DISCORD_BOT_TOKEN"];
const CHANNEL_FEISHU_ENV: &[&str] = &[
    "FEISHU_APP_ID",
    "FEISHU_APP_SECRET",
    "FEISHU_VERIFICATION_TOKEN",
    "FEISHU_WEBHOOK_HOST",
    "FEISHU_WEBHOOK_PORT",
    "FEISHU_WEBHOOK_PATH",
    "OPENCLAW_FEISHU_APP_ID",
    "OPENCLAW_FEISHU_APP_SECRET",
];
const CHANNEL_WHATSAPP_ENV: &[&str] = &[
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_PHONE_NUMBER_ID",
    "WHATSAPP_VERIFY_TOKEN",
    "WHATSAPP_WEBHOOK_HOST",
    "WHATSAPP_WEBHOOK_PORT",
    "WHATSAPP_WEBHOOK_PATH",
    "OPENCLAW_WHATSAPP_ACCESS_TOKEN",
    "OPENCLAW_WHATSAPP_PHONE_NUMBER_ID",
];
const CHANNEL_GOOGLECHAT_ENV: &[&str] = &[
    "GOOGLECHAT_SERVICE_ACCOUNT_JSON",
    "GOOGLECHAT_WEBHOOK_HOST",
    "GOOGLECHAT_WEBHOOK_PORT",
    "GOOGLECHAT_WEBHOOK_PATH",
    "OPENCLAW_GOOGLECHAT_SERVICE_ACCOUNT_JSON",
];
const CHANNEL_MSTEAMS_ENV: &[&str] = &[
    "MSTEAMS_APP_ID",
    "MSTEAMS_APP_SECRET",
    "MSTEAMS_WEBHOOK_HOST",
    "MSTEAMS_WEBHOOK_PORT",
    "MSTEAMS_WEBHOOK_PATH",
    "OPENCLAW_MSTEAMS_APP_ID",
    "OPENCLAW_MSTEAMS_APP_SECRET",
];
const CHANNEL_LINE_ENV: &[&str] = &[
    "LINE_CHANNEL_ACCESS_TOKEN",
    "LINE_CHANNEL_SECRET",
    "LINE_WEBHOOK_HOST",
    "LINE_WEBHOOK_PORT",
    "LINE_WEBHOOK_PATH",
    "OPENCLAW_LINE_CHANNEL_ACCESS_TOKEN",
];
const CHANNEL_MATRIX_ENV: &[&str] = &[
    "MATRIX_HOMESERVER_URL",
    "MATRIX_ACCESS_TOKEN",
    "MATRIX_SINCE_TOKEN",
    "OPENCLAW_MATRIX_HOMESERVER_URL",
    "OPENCLAW_MATRIX_ACCESS_TOKEN",
];
const CHANNEL_MATTERMOST_ENV: &[&str] = &[
    "MATTERMOST_SERVER_URL",
    "MATTERMOST_BOT_TOKEN",
    "MATTERMOST_WEBHOOK_HOST",
    "MATTERMOST_WEBHOOK_PORT",
    "MATTERMOST_WEBHOOK_PATH",
    "OPENCLAW_MATTERMOST_SERVER_URL",
    "OPENCLAW_MATTERMOST_BOT_TOKEN",
];
const CHANNEL_SIGNAL_ENV: &[&str] = &[
    "SIGNAL_SERVICE_URL",
    "SIGNAL_ACCOUNT",
    "OPENCLAW_SIGNAL_SERVICE_URL",
    "OPENCLAW_SIGNAL_ACCOUNT",
];
const CHANNEL_WECOM_ENV: &[&str] = &[
    "WECOM_CORP_ID",
    "WECOM_SECRET",
    "WECOM_AGENT_ID",
    "WECOM_WEBHOOK_HOST",
    "WECOM_WEBHOOK_PORT",
    "WECOM_WEBHOOK_PATH",
    "OPENCLAW_WECOM_CORP_ID",
    "OPENCLAW_WECOM_SECRET",
    "OPENCLAW_WECOM_AGENT_ID",
];
const CHANNEL_DINGTALK_ENV: &[&str] = &[
    "DINGTALK_APP_KEY",
    "DINGTALK_APP_SECRET",
    "DINGTALK_DEFAULT_WEBHOOK",
    "DINGTALK_WEBHOOK_HOST",
    "DINGTALK_WEBHOOK_PORT",
    "DINGTALK_WEBHOOK_PATH",
    "OPENCLAW_DINGTALK_APP_KEY",
    "OPENCLAW_DINGTALK_APP_SECRET",
];

fn yes() -> bool {
    true
}

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct EnvItem {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct ChannelEnvApply {
    pub channel: String,
    pub env: Vec<EnvItem>,
    #[serde(default = "yes")]
    pub restart: bool,
    #[serde(default = "yes")]
    pub replace: bool,
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
    pub loop_id: String,
    pub event_seq: u64,
    pub active_task_id: Option<String>,
    pub active_turn_id: Option<String>,
    pub last_chat_event: Option<ChatEvent>,
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
    pub loop_id: String,
    pub turn_id: String,
    pub task_id: String,
}

#[derive(Serialize, Clone)]
pub struct ChatEvent {
    pub kind: String,
    pub text: Option<String>,
    pub url: Option<String>,
    pub alt: Option<String>,
    pub success: Option<bool>,
    pub code: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub loop_event: Option<LoopEvent>,
}

#[derive(Serialize, Clone)]
pub struct LoopEvent {
    pub v: String,
    pub seq: u64,
    pub event_id: String,
    pub loop_id: String,
    pub turn_id: String,
    pub task_id: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    pub terminal: bool,
    pub ts: u64,
    pub source: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct LogEntry {
    pub ts: u64,
    pub level: String,
    pub tag: String,
    pub message: String,
    pub detail: Option<serde_json::Value>,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct SessionListItem {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub created: u64,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub directory: Option<String>,
}

#[derive(Deserialize)]
struct SessionApiTime {
    updated: u64,
    created: u64,
}

#[derive(Deserialize)]
struct SessionApiItem {
    id: String,
    title: String,
    time: SessionApiTime,
    #[serde(rename = "projectID")]
    project_id: Option<String>,
    directory: Option<String>,
}

#[derive(Deserialize)]
struct SessionExportApiResult {
    file: String,
}

pub struct ManagerState {
    config: ManagerConfig,
    logs: VecDeque<LogEntry>,
    log_path: String,
    core: Option<Child>,
    channel: Option<Child>,
    prompt_running: bool,
    loop_id: String,
    event_seq: u64,
    active_task: Option<TaskRun>,
    last_chat_event: Option<ChatEvent>,
}

#[derive(Clone)]
struct TaskRun {
    turn_id: String,
    task_id: String,
}

pub type Shared = Arc<Mutex<ManagerState>>;

fn repo_root(path: &Path) -> Option<PathBuf> {
    let mut node = if path.is_file() {
        path.parent().map(|item| item.to_path_buf())?
    } else {
        path.to_path_buf()
    };
    loop {
        let pkg = node.join("packages");
        if pkg.join("bot").is_dir() && pkg.join("opencorvus").is_dir() {
            return Some(node);
        }
        if !node.pop() {
            return None;
        }
    }
}

fn infer_cwd(command: &str) -> Option<PathBuf> {
    let cmd = command.trim();
    if !cmd.is_empty() {
        let path = PathBuf::from(cmd);
        if path.is_absolute() {
            if let Some(root) = repo_root(&path) {
                return Some(root);
            }
        }
    }
    if let Ok(path) = std::env::current_exe() {
        if let Some(root) = repo_root(&path) {
            return Some(root);
        }
    }
    if let Ok(path) = std::env::current_dir() {
        if let Some(root) = repo_root(&path) {
            return Some(root);
        }
    }
    None
}

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
        let cwd = infer_cwd(&command)
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();

        Self {
            command,
            serve_args: vec![
                "serve".into(),
                "--hostname=127.0.0.1".into(),
                "--port=7878".into(),
            ],
            run_args: vec!["run".into()],
            bot_command: "bun".into(),
            bot_args: default_bot_args(),
            server_url: "http://127.0.0.1:7878".into(),
            cwd,
            env: vec![],
        }
    }
}

impl ManagerState {
    fn new() -> Self {
        let seed = stamp();
        Self {
            config: ManagerConfig::default(),
            logs: VecDeque::new(),
            log_path: String::new(),
            core: None,
            channel: None,
            prompt_running: false,
            loop_id: format!("loop_{seed:x}"),
            event_seq: 0,
            active_task: None,
            last_chat_event: None,
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

fn serve_port(args: &[String]) -> Option<u16> {
    let mut i = 0;
    while i < args.len() {
        let item = args[i].trim();
        if let Some(value) = item.strip_prefix("--port=") {
            if let Ok(port) = value.trim().parse::<u16>() {
                return Some(port);
            }
        }
        if item == "--port" && i + 1 < args.len() {
            if let Ok(port) = args[i + 1].trim().parse::<u16>() {
                return Some(port);
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    None
}

fn serve_host(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        let item = args[i].trim();
        if let Some(value) = item.strip_prefix("--hostname=") {
            let host = value.trim();
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
        if let Some(value) = item.strip_prefix("--host=") {
            let host = value.trim();
            if !host.is_empty() {
                return Some(host.to_string());
            }
        }
        if (item == "--hostname" || item == "--host") && i + 1 < args.len() {
            let host = args[i + 1].trim();
            if !host.is_empty() {
                return Some(host.to_string());
            }
            i += 2;
            continue;
        }
        i += 1;
    }
    None
}

fn derive_server_url(args: &[String]) -> String {
    let host = serve_host(args).unwrap_or_else(|| "127.0.0.1".into());
    let port = serve_port(args).unwrap_or(7878);
    format!("http://{host}:{port}")
}

fn with_port(args: Vec<String>, port: u16) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut set = false;
    let mut i = 0;
    while i < args.len() {
        let item = args[i].trim();
        if item.starts_with("--port=") {
            out.push(format!("--port={port}"));
            set = true;
            i += 1;
            continue;
        }
        if item == "--port" && i + 1 < args.len() {
            out.push("--port".into());
            out.push(port.to_string());
            set = true;
            i += 2;
            continue;
        }
        out.push(args[i].clone());
        i += 1;
    }
    if !set {
        out.push("--port".into());
        out.push(port.to_string());
    }
    out
}

fn port_busy(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

fn free_port() -> Option<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0)).ok()?;
    listener.local_addr().ok().map(|addr| addr.port())
}

fn default_bot_args() -> Vec<String> {
    vec![
        "run".into(),
        "--cwd".into(),
        "packages/bot".into(),
        "--no-env-file".into(),
        "--env-file".into(),
        ".env".into(),
        "src/main.ts".into(),
    ]
}

fn legacy_bot_args(args: &[String]) -> bool {
    args.len() == 5
        && args[0] == "run"
        && args[1] == "--no-env-file"
        && args[2] == "--env-file"
        && args[3] == ".env"
        && args[4] == "packages/bot/src/main.ts"
}

fn norm_bot_args(args: Vec<String>) -> Vec<String> {
    let args = norm_list(args);
    if args.is_empty() {
        return default_bot_args();
    }
    if legacy_bot_args(&args) {
        return default_bot_args();
    }
    args
}

fn has_cwd_arg(args: &[String]) -> bool {
    args.iter().any(|item| {
        let item = item.trim();
        item == "--cwd" || item.starts_with("--cwd=") || item == "-C"
    })
}

fn abs_cwd_args(args: Vec<String>, base: &Path) -> Vec<String> {
    let mut out = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let item = args[i].trim();
        if item == "--cwd" || item == "-C" {
            out.push(args[i].clone());
            if i + 1 < args.len() {
                let next = args[i + 1].trim();
                if next.is_empty() {
                    out.push(args[i + 1].clone());
                } else {
                    let path = PathBuf::from(next);
                    if path.is_absolute() {
                        out.push(path.to_string_lossy().to_string());
                    } else {
                        out.push(base.join(path).to_string_lossy().to_string());
                    }
                }
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }

        if let Some(value) = item.strip_prefix("--cwd=") {
            let value = value.trim();
            if value.is_empty() {
                out.push(args[i].clone());
            } else {
                let path = PathBuf::from(value);
                if path.is_absolute() {
                    out.push(args[i].clone());
                } else {
                    out.push(format!("--cwd={}", base.join(path).to_string_lossy()));
                }
            }
            i += 1;
            continue;
        }

        out.push(args[i].clone());
        i += 1;
    }
    out
}

fn norm_env(env: Vec<EnvItem>) -> Vec<EnvItem> {
    env.into_iter()
        .map(|item| EnvItem {
            key: item.key.trim().into(),
            value: item.value.trim().into(),
        })
        .filter(|item| !item.key.is_empty())
        .collect()
}

fn channel_name(input: &str) -> Option<&'static str> {
    let key = input.trim().to_ascii_lowercase();
    match key.as_str() {
        "slack" => Some("slack"),
        "telegram" => Some("telegram"),
        "discord" => Some("discord"),
        "feishu" | "lark" => Some("feishu"),
        "whatsapp" => Some("whatsapp"),
        "googlechat" | "google-chat" => Some("googlechat"),
        "msteams" | "ms-teams" | "teams" => Some("msteams"),
        "line" => Some("line"),
        "matrix" => Some("matrix"),
        "mattermost" => Some("mattermost"),
        "signal" => Some("signal"),
        "wecom" | "wechat-work" => Some("wecom"),
        "dingtalk" => Some("dingtalk"),
        _ => None,
    }
}

fn channel_env(channel: &str) -> Option<&'static [&'static str]> {
    match channel {
        "slack" => Some(CHANNEL_SLACK_ENV),
        "telegram" => Some(CHANNEL_TELEGRAM_ENV),
        "discord" => Some(CHANNEL_DISCORD_ENV),
        "feishu" => Some(CHANNEL_FEISHU_ENV),
        "whatsapp" => Some(CHANNEL_WHATSAPP_ENV),
        "googlechat" => Some(CHANNEL_GOOGLECHAT_ENV),
        "msteams" => Some(CHANNEL_MSTEAMS_ENV),
        "line" => Some(CHANNEL_LINE_ENV),
        "matrix" => Some(CHANNEL_MATRIX_ENV),
        "mattermost" => Some(CHANNEL_MATTERMOST_ENV),
        "signal" => Some(CHANNEL_SIGNAL_ENV),
        "wecom" => Some(CHANNEL_WECOM_ENV),
        "dingtalk" => Some(CHANNEL_DINGTALK_ENV),
        _ => None,
    }
}

fn merge_env(mut base: Vec<EnvItem>, incoming: Vec<EnvItem>, keys: &[&str], replace: bool) -> Vec<EnvItem> {
    base = norm_env(base);
    if replace {
        base.retain(|item| !keys.iter().any(|key| *key == item.key));
    }
    for item in norm_env(incoming) {
        base.retain(|cur| cur.key != item.key);
        base.push(item);
    }
    base
}

fn norm_config(config: ManagerConfig) -> ManagerConfig {
    let defaults = ManagerConfig::default();
    let bot_command = config.bot_command.trim().to_string();
    let bot_args = norm_bot_args(config.bot_args);
    let command = {
        let item = config.command.trim();
        if item.is_empty() {
            // Empty command in config: use sibling binary detection same as Default.
            defaults.command
        } else {
            item.into()
        }
    };
    let cwd = {
        let item = config.cwd.trim();
        if !item.is_empty() {
            item.into()
        } else {
            infer_cwd(&command)
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or(defaults.cwd)
        }
    };
    ManagerConfig {
        command,
        serve_args: norm_list(config.serve_args),
        run_args: norm_list(config.run_args),
        bot_command,
        bot_args,
        server_url: {
            let item = config.server_url.trim();
            if item.is_empty() {
                defaults.server_url
            } else {
                item.into()
            }
        },
        cwd,
        env: norm_env(config.env),
    }
}

fn state_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(value) = std::env::var("OPENCORVUS_OVERLAY_STATE_DIR") {
        let item = value.trim();
        if !item.is_empty() {
            let dir = PathBuf::from(item);
            fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
            return Ok(dir);
        }
    }
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(state_dir(app)?.join(CONFIG_FILE))
}

fn log_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(state_dir(app)?.join(LOG_FILE))
}

fn pid_path(app: &AppHandle, name: &str) -> Result<PathBuf, String> {
    Ok(state_dir(app)?.join(name))
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
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let status = Command::new("taskkill")
        .arg("/PID")
        .arg(pid.to_string())
        .arg("/T")
        .arg("/F")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
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
            push_log(
                shared,
                app,
                format!("killed stale {label} process (pid {pid})"),
            );
        }
        Err(error) => {
            push_log(
                shared,
                app,
                format!("failed to kill stale {label} process (pid {pid}): {error}"),
            );
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

fn resolve_work_dir(cwd: &str) -> PathBuf {
    let root = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let item = cwd.trim();
    if item.is_empty() {
        return root;
    }
    let path = PathBuf::from(item);
    if path.is_absolute() {
        return path;
    }
    root.join(path)
}

fn config_work_dir(config: &ManagerConfig) -> PathBuf {
    resolve_work_dir(&config.cwd)
}

fn work_dir(shared: &Shared) -> PathBuf {
    let cwd = {
        let state = shared.lock().unwrap();
        state.config.cwd.trim().to_string()
    };
    resolve_work_dir(&cwd)
}

fn shared_session_path(shared: &Shared) -> PathBuf {
    work_dir(shared)
        .join(".opencorvus")
        .join(SHARED_SESSION_FILE)
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

fn clear_shared_session(shared: &Shared) -> Result<bool, String> {
    let path = shared_session_path(shared);
    if !path.exists() {
        return Ok(false);
    }
    fs::remove_file(path).map_err(|error| error.to_string())?;
    Ok(true)
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

fn reveal_target(path: &Path) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        if path.is_file() {
            Command::new("explorer")
                .arg(format!("/select,{}", path.to_string_lossy()))
                .spawn()
                .map_err(|error| error.to_string())?;
        } else {
            open_target(path)?;
        }
    }
    #[cfg(target_os = "macos")]
    {
        if path.is_file() {
            Command::new("open")
                .arg("-R")
                .arg(path)
                .spawn()
                .map_err(|error| error.to_string())?;
        } else {
            open_target(path)?;
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let target = if path.is_file() {
            path.parent().unwrap_or(path)
        } else {
            path
        };
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn build_command(config: &ManagerConfig, args: &[String]) -> Command {
    let mut cmd = build_process(&config.command, args, &config.cwd, &config.env);
    apply_llm_env(&mut cmd, &config.env, false);
    cmd
}

fn env_pick(env: &[EnvItem], key: &str) -> Option<String> {
    env.iter().rev().find_map(|item| {
        if item.key.trim() != key {
            return None;
        }
        let value = item.value.trim();
        if value.is_empty() {
            return None;
        }
        Some(value.to_string())
    })
}

fn apply_llm_env(cmd: &mut Command, env: &[EnvItem], bot: bool) {
    let base = if bot {
        ENV_BOT_LLM_BASE_URL
    } else {
        ENV_TUI_LLM_BASE_URL
    };
    let key = if bot {
        ENV_BOT_LLM_API_KEY
    } else {
        ENV_TUI_LLM_API_KEY
    };

    if let Some(value) = env_pick(env, base) {
        cmd.env(ENV_LLM_BASE_URL, value);
    }
    if let Some(value) = env_pick(env, key) {
        cmd.env(ENV_LLM_API_KEY, value);
    }
}

fn build_process(command: &str, args: &[String], cwd: &str, env: &[EnvItem]) -> Command {
    let mut cmd = Command::new(command);
    cmd.args(args);
    cmd.current_dir(resolve_work_dir(cwd));
    for item in env {
        cmd.env(&item.key, &item.value);
    }
    // Hide console windows for background processes on Windows.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn watch_pipe<R: Read + Send + 'static>(
    shared: Shared,
    app: AppHandle,
    source: R,
    tag: &'static str,
) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(source);
        let mut raw = Vec::new();
        loop {
            match read_output_line(&mut reader, &mut raw) {
                Ok(Some(text)) if !text.trim().is_empty() => {
                    if tag == "channel" {
                        if let Some(event) = parse_channel_mirror(&text) {
                            shared.lock().unwrap().last_chat_event = Some(event.clone());
                            let _ = app.emit_to(
                                events::WINDOW_CONSOLE,
                                events::EVT_MANAGER_CHAT,
                                event,
                            );
                            continue;
                        }
                    }
                    push_log(&shared, &app, format!("[{tag}] {text}"));
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(error) => {
                    push_log(
                        &shared,
                        &app,
                        format!("[{tag}] stream read failed: {error}"),
                    );
                    break;
                }
            }
        }
        // Stream closure usually means process termination or pipe teardown.
        // Probe once to collapse stale running/channel state promptly.
        probe(&shared, &app);
    });
}

fn start_probe_loop(shared: Shared, app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_millis(1000));
        probe(&shared, &app);
    });
}

fn trim_line_end(text: &str) -> &str {
    text.trim_end_matches(|item| item == '\r' || item == '\n')
}

fn decode_output_bytes(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return text.to_string();
    }
    #[cfg(target_os = "windows")]
    {
        let utf8 = String::from_utf8_lossy(bytes).to_string();
        let utf8_bad = utf8.chars().filter(|item| *item == '\u{FFFD}').count();
        if utf8_bad == 0 {
            return utf8;
        }
        let (gb, _, _) = GB18030.decode(bytes);
        let gb = gb.into_owned();
        let gb_bad = gb.chars().filter(|item| *item == '\u{FFFD}').count();
        let utf8_len = utf8.chars().count().max(1);
        if utf8_bad * 100 <= utf8_len * 2 {
            return utf8;
        }
        if gb_bad < utf8_bad {
            return gb;
        }
        return utf8;
    }
    #[cfg(not(target_os = "windows"))]
    {
        String::from_utf8_lossy(bytes).to_string()
    }
}

fn decode_output_line(bytes: &[u8]) -> String {
    trim_line_end(&decode_output_bytes(bytes)).to_string()
}

fn read_output_line<R: BufRead>(
    reader: &mut R,
    raw: &mut Vec<u8>,
) -> std::io::Result<Option<String>> {
    raw.clear();
    let read = reader.read_until(b'\n', raw)?;
    if read == 0 {
        return Ok(None);
    }
    Ok(Some(decode_output_line(raw)))
}

fn next_task_run(state: &mut ManagerState) -> TaskRun {
    let ts = stamp();
    let idx = state.event_seq.saturating_add(1);
    TaskRun {
        turn_id: format!("turn_{ts:x}_{idx:x}"),
        task_id: format!("task_{ts:x}_{idx:x}"),
    }
}

fn next_loop_event(
    shared: &Shared,
    task: Option<&TaskRun>,
    kind: &str,
    status: Option<&str>,
    terminal: bool,
    source: &str,
) -> Option<LoopEvent> {
    let mut state = shared.lock().unwrap();
    let ctx = task.cloned().or_else(|| state.active_task.clone())?;
    state.event_seq = state.event_seq.saturating_add(1);
    let seq = state.event_seq;
    let loop_id = state.loop_id.clone();
    Some(LoopEvent {
        v: "1.0".into(),
        seq,
        event_id: format!("evt_{seq:x}"),
        loop_id,
        turn_id: ctx.turn_id,
        task_id: ctx.task_id,
        kind: kind.into(),
        status: status.map(|item| item.into()),
        terminal,
        ts: stamp(),
        source: source.into(),
    })
}

fn emit_chat_ex(
    shared: Option<&Shared>,
    app: &AppHandle,
    kind: &str,
    text: Option<String>,
    url: Option<String>,
    alt: Option<String>,
    success: Option<bool>,
    code: Option<i32>,
    loop_event: Option<LoopEvent>,
) {
    let event = ChatEvent {
        kind: kind.into(),
        text,
        url,
        alt,
        success,
        code,
        loop_event,
    };
    if let Some(shared) = shared {
        shared.lock().unwrap().last_chat_event = Some(event.clone());
    }
    let _ = app.emit_to(
        events::WINDOW_CONSOLE,
        events::EVT_MANAGER_CHAT,
        event,
    );
}

fn emit_chat(
    shared: Option<&Shared>,
    app: &AppHandle,
    kind: &str,
    text: Option<String>,
    url: Option<String>,
    alt: Option<String>,
    success: Option<bool>,
    code: Option<i32>,
) {
    emit_chat_ex(shared, app, kind, text, url, alt, success, code, None);
}

fn emit_loop_chat(
    shared: &Shared,
    app: &AppHandle,
    task: Option<&TaskRun>,
    loop_kind: &str,
    status: Option<&str>,
    terminal: bool,
    source: &str,
    kind: &str,
    text: Option<String>,
    url: Option<String>,
    alt: Option<String>,
    success: Option<bool>,
    code: Option<i32>,
) {
    let loop_event = next_loop_event(shared, task, loop_kind, status, terminal, source);
    emit_chat_ex(
        Some(shared),
        app,
        kind,
        text,
        url,
        alt,
        success,
        code,
        loop_event,
    );
}

fn probe_cancelled_task(state: &mut ManagerState, core_done: bool) -> Option<TaskRun> {
    if !core_done || !state.prompt_running {
        return None;
    }
    if state.active_task.is_none() {
        state.prompt_running = false;
        return None;
    }
    state.active_task.clone()
}

fn close_active_task(shared: &Shared, task: &TaskRun) -> bool {
    let mut state = shared.lock().unwrap();
    let active = state
        .active_task
        .as_ref()
        .map(|item| item.task_id.as_str())
        == Some(task.task_id.as_str());
    if !active {
        return false;
    }
    state.prompt_running = false;
    state.active_task = None;
    true
}

fn emit_task_terminal(
    shared: &Shared,
    app: &AppHandle,
    task: &TaskRun,
    status: &str,
    source: &str,
    text: Option<String>,
    success: Option<bool>,
    code: Option<i32>,
) -> bool {
    if !close_active_task(shared, task) {
        return false;
    }
    emit_loop_chat(
        shared,
        app,
        Some(task),
        "task.status",
        Some(status),
        true,
        source,
        "done",
        text,
        None,
        None,
        success,
        code,
    );
    emit_state(shared, app);
    true
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
        loop_event: None,
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

fn ensure_dir(args: Vec<String>, dir: &str) -> Vec<String> {
    if dir.trim().is_empty() {
        return args;
    }
    let mut out = Vec::with_capacity(args.len() + 2);
    let mut seen = false;
    let mut i = 0usize;
    while i < args.len() {
        let item = &args[i];
        if item == "--dir" {
            out.push("--dir".into());
            out.push(dir.into());
            seen = true;
            i += 1;
            if i < args.len() {
                i += 1;
            }
            continue;
        }
        if item.starts_with("--dir=") {
            out.push(format!("--dir={dir}"));
            seen = true;
            i += 1;
            continue;
        }
        out.push(item.clone());
        i += 1;
    }
    if !seen {
        out.push("--dir".into());
        out.push(dir.into());
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

fn user_home_dir() -> PathBuf {
    if let Ok(item) = std::env::var("OPENCORVUS_TEST_HOME") {
        let val = item.trim();
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }
    if let Ok(item) = std::env::var("USERPROFILE") {
        let val = item.trim();
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }
    if let Ok(item) = std::env::var("HOME") {
        let val = item.trim();
        if !val.is_empty() {
            return PathBuf::from(val);
        }
    }
    PathBuf::from(".")
}

fn opencorvus_data_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(item) = std::env::var("XDG_DATA_HOME") {
        let val = item.trim();
        if !val.is_empty() {
            out.push(PathBuf::from(val).join("opencorvus"));
        }
    }
    let home = user_home_dir();
    out.push(home.join(".local").join("share").join("opencorvus"));
    if cfg!(target_os = "windows") {
        if let Ok(item) = std::env::var("LOCALAPPDATA") {
            let val = item.trim();
            if !val.is_empty() {
                out.push(PathBuf::from(val).join("opencorvus"));
            }
        }
        out.push(home.join("AppData").join("Local").join("opencorvus"));
    }
    out
}

fn screenshot_paths_from_url(url: &str) -> Option<Vec<PathBuf>> {
    let rel = url.trim().strip_prefix(SCREENSHOT_SCHEME)?;
    if rel.is_empty() {
        return None;
    }
    let mut tail = PathBuf::new();
    for part in rel.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            return None;
        }
        tail.push(part);
    }
    Some(
        opencorvus_data_dirs()
            .into_iter()
            .map(|base| base.join("screenshots").join(&tail))
            .collect(),
    )
}

fn screenshot_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|item| item.to_str())
        .map(|item| item.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => "image/png",
    }
}

fn resolve_overlay_image_url(url: &str) -> String {
    let trimmed = url.trim();
    if !trimmed.starts_with(SCREENSHOT_SCHEME) {
        return trimmed.to_string();
    }
    let Some(paths) = screenshot_paths_from_url(trimmed) else {
        return trimmed.to_string();
    };
    for path in paths {
        let Ok(bytes) = fs::read(&path) else {
            continue;
        };
        let mime = screenshot_mime(&path);
        let data = base64::engine::general_purpose::STANDARD.encode(bytes);
        return format!("data:{mime};base64,{data}");
    }
    trimmed.to_string()
}

fn has_continue_or_session(args: &[String]) -> bool {
    let mut i = 0usize;
    while i < args.len() {
        let item = args[i].trim();
        if item == "--continue" || item == "-c" || item.starts_with("--continue=") {
            return true;
        }
        if item == "--session" || item == "-s" {
            if i + 1 < args.len() {
                let value = args[i + 1].trim();
                if !value.is_empty() && !value.starts_with('-') {
                    return true;
                }
            }
            i += 2;
            continue;
        }
        if let Some(value) = item.strip_prefix("--session=") {
            if !value.trim().is_empty() {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn strip_orphan_fork(args: Vec<String>) -> (Vec<String>, bool) {
    if has_continue_or_session(&args) {
        return (args, false);
    }
    let mut out = Vec::with_capacity(args.len());
    let mut removed = false;
    let mut i = 0usize;
    while i < args.len() {
        let item = args[i].trim();
        if item == "--fork" {
            removed = true;
            if i + 1 < args.len() {
                let next = args[i + 1].trim().to_ascii_lowercase();
                if next == "true" || next == "false" {
                    i += 2;
                    continue;
                }
            }
            i += 1;
            continue;
        }
        if item.starts_with("--fork=") {
            removed = true;
            i += 1;
            continue;
        }
        out.push(args[i].clone());
        i += 1;
    }
    (out, removed)
}

fn emit_delta(
    shared: &Shared,
    app: &AppHandle,
    task: Option<&TaskRun>,
    output: &mut String,
    text: &str,
) {
    if text.is_empty() {
        return;
    }
    output.push_str(text);
    emit_loop_chat(
        shared,
        app,
        task,
        "output.delta",
        None,
        false,
        "run",
        "delta",
        Some(text.into()),
        None,
        None,
        None,
        None,
    );
}

fn emit_replace(
    shared: &Shared,
    app: &AppHandle,
    task: Option<&TaskRun>,
    output: &mut String,
    text: &str,
) {
    output.clear();
    output.push_str(text);
    emit_loop_chat(
        shared,
        app,
        task,
        "output.replace",
        None,
        false,
        "run",
        "replace",
        Some(text.into()),
        None,
        None,
        None,
        None,
    );
}

fn process_json_line(
    shared: &Shared,
    app: &AppHandle,
    task: Option<&TaskRun>,
    value: &serde_json::Value,
    output: &mut String,
    delta_seen: &mut bool,
) -> bool {
    let Some(kind) = value.get("type").and_then(|item| item.as_str()) else {
        return false;
    };

    // Silently discard structural / metadata events that should not appear in chat output.
    if matches!(
        kind,
        "step_start" | "step_finish" | "reasoning" | "reasoning_delta"
    ) {
        return true;
    }

    if kind == "text_delta" {
        let Some(delta) = value.get("delta").and_then(|item| item.as_str()) else {
            return true;
        };
        *delta_seen = true;
        emit_delta(shared, app, task, output, delta);
        return true;
    }

    if kind == "text" {
        let Some(text) = value.pointer("/part/text").and_then(|item| item.as_str()) else {
            return true;
        };
        if !*delta_seen {
            emit_replace(shared, app, task, output, text);
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
        let resolved = resolve_overlay_image_url(url);
        emit_loop_chat(
            shared,
            app,
            task,
            "output.image",
            None,
            false,
            "run",
            "image",
            None,
            Some(resolved),
            Some(alt.into()),
            None,
            None,
        );
        return true;
    }

    if kind == "tool_use" {
        let Some(items) = value
            .pointer("/part/state/attachments")
            .and_then(|item| item.as_array())
        else {
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
            let resolved = resolve_overlay_image_url(url);
            emit_loop_chat(
                shared,
                app,
                task,
                "output.image",
                None,
                false,
                "run",
                "image",
                None,
                Some(resolved),
                Some(alt.into()),
                None,
                None,
            );
        }
        return true;
    }

    if kind == "error" {
        let text = value
            .pointer("/error/data/message")
            .and_then(|item| item.as_str())
            .or_else(|| value.pointer("/error/name").and_then(|item| item.as_str()))
            .unwrap_or("Unknown error");
        emit_loop_chat(
            shared,
            app,
            task,
            "system.message",
            None,
            false,
            "run",
            "system",
            Some(text.into()),
            None,
            None,
            None,
            None,
        );
        return true;
    }

    false
}

fn run_prompt(shared: &Shared, app: &AppHandle, prompt: String, task: TaskRun) -> SendResult {
    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };
    let shared_session = read_shared_session(shared);
    let dir = config_work_dir(&config).to_string_lossy().to_string();

    push_log(shared, app, format!("prompt> {prompt}"));

    let args = if config.run_args.first().map(|item| item.as_str()) == Some("run") {
        let formatted = ensure_json_format(config.run_args.clone());
        let attached = ensure_attach(formatted, &config.server_url);
        let directed = if config.cwd.trim().is_empty() {
            attached
        } else {
            ensure_dir(attached, &dir)
        };
        if let Some(item) = shared_session.as_ref() {
            ensure_session(directed, item)
        } else {
            directed
        }
    } else {
        config.run_args.clone()
    };
    let (mut args, orphan_fork_removed) = strip_orphan_fork(args);
    if orphan_fork_removed {
        push_log(
            shared,
            app,
            "removed invalid `--fork` from run args (requires --continue or --session)",
        );
    }
    args.push(prompt);

    let mut cmd = build_command(&config, &args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    emit_loop_chat(
        shared,
        app,
        Some(&task),
        "task.status",
        Some("running"),
        false,
        "manager",
        "start",
        None,
        None,
        None,
        None,
        None,
    );

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("failed to run prompt command: {error}");
            push_log(shared, app, message.clone());
            emit_loop_chat(
                shared,
                app,
                Some(&task),
                "system.message",
                None,
                false,
                "manager",
                "system",
                Some(message.clone()),
                None,
                None,
                None,
                None,
            );
            emit_task_terminal(
                shared,
                app,
                &task,
                "failed",
                "manager",
                None,
                Some(false),
                Some(-1),
            );
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
            let mut reader = BufReader::new(stderr);
            let mut raw = Vec::new();
            loop {
                match read_output_line(&mut reader, &mut raw) {
                    Ok(Some(item)) if !item.trim().is_empty() => {
                        push_log(&shared2, &app2, format!("[run:err] {item}"));
                        if !text.is_empty() {
                            text.push('\n');
                        }
                        text.push_str(item.trim_end());
                    }
                    Ok(Some(_)) => {}
                    Ok(None) => break,
                    Err(error) => {
                        push_log(
                            &shared2,
                            &app2,
                            format!("[run:err] stream read failed: {error}"),
                        );
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
        let mut reader = BufReader::new(stdout);
        let mut raw = Vec::new();
        loop {
            match read_output_line(&mut reader, &mut raw) {
                Ok(Some(item)) if !item.trim().is_empty() => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&item) {
                        if captured_session.is_none() {
                            if let Some(session_id) =
                                value.get("sessionID").and_then(|entry| entry.as_str())
                            {
                                let next = session_id.trim();
                                if !next.is_empty() {
                                    captured_session = Some(next.to_string());
                                }
                            }
                        }
                        if process_json_line(shared, app, Some(&task), &value, &mut out, &mut delta_seen) {
                            continue;
                        }
                    }
                    push_log(shared, app, format!("[run] {item}"));
                    let chunk = format!("{item}\n");
                    emit_delta(shared, app, Some(&task), &mut out, &chunk);
                    delta_seen = true;
                }
                Ok(Some(_)) => {}
                Ok(None) => break,
                Err(error) => {
                    let line = format!("[run] stream read failed: {error}");
                    push_log(shared, app, line.clone());
                    emit_loop_chat(
                        shared,
                        app,
                        Some(&task),
                        "system.message",
                        None,
                        false,
                        "run",
                        "system",
                        Some(line),
                        None,
                        None,
                        None,
                        None,
                    );
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
            emit_loop_chat(
                shared,
                app,
                Some(&task),
                "system.message",
                None,
                false,
                "manager",
                "system",
                Some(message.clone()),
                None,
                None,
                None,
                None,
            );
            emit_task_terminal(
                shared,
                app,
                &task,
                "failed",
                "manager",
                None,
                Some(false),
                Some(-1),
            );
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
        emit_loop_chat(
            shared,
            app,
            Some(&task),
            "system.message",
            None,
            false,
            "run",
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
                push_log(
                    shared,
                    app,
                    format!("shared session captured: {session_id}"),
                );
                emit_state(shared, app);
            }
        }
    }

    emit_task_terminal(
        shared,
        app,
        &task,
        if success { "completed" } else { "failed" },
        "manager",
        None,
        Some(success),
        Some(code),
    );
    SendResult {
        success,
        code,
        output: text,
    }
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
        loop_id: state.loop_id.clone(),
        event_seq: state.event_seq,
        active_task_id: state.active_task.as_ref().map(|item| item.task_id.clone()),
        active_turn_id: state.active_task.as_ref().map(|item| item.turn_id.clone()),
        last_chat_event: state.last_chat_event.clone(),
    }
}

pub fn emit_state(shared: &Shared, app: &AppHandle) {
    let _ = app.emit_to(
        events::WINDOW_CONSOLE,
        events::EVT_MANAGER_STATE,
        snapshot(shared),
    );
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
    let (notes, core_exited, channel_exited, cancelled) = {
        let mut state = shared.lock().unwrap();
        let mut lines = Vec::<String>::new();
        let mut core_done = false;
        let mut channel_done = false;
        if let Some(child) = state.core.as_mut() {
            match child.try_wait() {
                Ok(Some(status)) => {
                    state.core = None;
                    let code = status
                        .code()
                        .map(|item| item.to_string())
                        .unwrap_or_else(|| "signal".into());
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
                    let code = status
                        .code()
                        .map(|item| item.to_string())
                        .unwrap_or_else(|| "signal".into());
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
        let cancelled = probe_cancelled_task(&mut state, core_done);
        (lines, core_done, channel_done, cancelled)
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
    if let Some(task) = cancelled.as_ref() {
        if emit_task_terminal(
            shared,
            app,
            task,
            "stalled",
            "manager",
            Some("Task stopped because OpenCorvus core process exited".into()),
            Some(false),
            Some(-3),
        ) {
            push_log(shared, app, format!("active task stopped after process exit: {}", task.task_id));
        }
    }
    emit_state(shared, app);
}

pub fn init(shared: &Shared, app: &AppHandle) {
    start_probe_loop(shared.clone(), app.clone());
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

    let args = abs_cwd_args(config.bot_args.clone(), &config_work_dir(config));
    let bot_cwd = if has_cwd_arg(&args) { "" } else { &config.cwd };
    let mut cmd = build_process(&config.bot_command, &args, bot_cwd, &config.env);
    apply_llm_env(&mut cmd, &config.env, true);
    let bot_cwd_log = resolve_work_dir(bot_cwd).to_string_lossy().to_string();
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.env("OPENCORVUS_BOT_SERVER_URL", config.server_url.clone());
    cmd.env("OPENCORVUS_SHARED_SESSION_MODE", "0");
    cmd.env("OPENCORVUS_MIRROR_STDOUT", "1");
    cmd.env(
        "OPENCORVUS_SHARED_SESSION_FILE",
        shared_session_path(shared).to_string_lossy().to_string(),
    );
    if !config.command.trim().is_empty()
        && !config
            .env
            .iter()
            .any(|item| item.key.trim() == "OPENCORVUS_BIN_PATH")
    {
        cmd.env("OPENCORVUS_BIN_PATH", config.command.clone());
    }
    if !config.cwd.trim().is_empty()
        && !config
            .env
            .iter()
            .any(|item| item.key.trim() == "OPENCORVUS_PROJECT_DIR")
    {
        cmd.env(
            "OPENCORVUS_PROJECT_DIR",
            config_work_dir(config).to_string_lossy().to_string(),
        );
    }

    let mut child = cmd.spawn().map_err(|error| {
        format!(
            "failed to start channel bot ({}): {error}",
            config.bot_command
        )
    })?;

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
        push_log(
            shared,
            app,
            format!("failed to persist channel pid {pid}: {error}"),
        );
    }

    push_log(
        shared,
        app,
        format!(
            "channel bot started (pid {pid}) cwd={} with: {} {}",
            bot_cwd_log,
            config.bot_command,
            config.bot_args.join(" ")
        ),
    );
    Ok(())
}

pub fn start_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    probe(shared, app);

    let mut config = {
        let state = shared.lock().unwrap();
        if state.core.is_some() {
            push_log(shared, app, "OpenCorvus is already running");
            return Ok(());
        }
        state.config.clone()
    };

    if let Some(port) = serve_port(&config.serve_args) {
        if port_busy(port) {
            if let Some(next) = free_port() {
                if next != port {
                    config.serve_args = with_port(config.serve_args.clone(), next);
                    config.server_url = derive_server_url(&config.serve_args);
                    {
                        let mut state = shared.lock().unwrap();
                        state.config = config.clone();
                    }
                    if let Err(error) = save_config(app, &config) {
                        push_log(
                            shared,
                            app,
                            format!("failed to save auto-updated port config: {error}"),
                        );
                    }
                    push_log(
                        shared,
                        app,
                        format!("port {port} is busy, switched OpenCorvus to {next}"),
                    );
                }
            }
        }
    }

    // Keep attach URL in sync with serve args to avoid port drift between
    // core server and channel/run clients.
    let expected_server_url = derive_server_url(&config.serve_args);
    if config.server_url != expected_server_url {
        let old = config.server_url.clone();
        config.server_url = expected_server_url.clone();
        {
            let mut state = shared.lock().unwrap();
            state.config = config.clone();
        }
        if let Err(error) = save_config(app, &config) {
            push_log(
                shared,
                app,
                format!("failed to save synced server_url: {error}"),
            );
        }
        push_log(
            shared,
            app,
            format!("synced server_url from `{old}` to `{expected_server_url}`"),
        );
    }

    match clear_shared_session(shared) {
        Ok(true) => push_log(
            shared,
            app,
            "shared session reset for startup (create new session)",
        ),
        Ok(false) => {}
        Err(error) => push_log(
            shared,
            app,
            format!("failed to reset shared session: {error}"),
        ),
    }

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
        push_log(
            shared,
            app,
            format!("failed to persist OpenCorvus pid {pid}: {error}"),
        );
    }

    push_log(
        shared,
        app,
        format!(
            "OpenCorvus started (pid {pid}) with: {} {}",
            config.command,
            config.serve_args.join(" ")
        ),
    );

    if let Err(error) = start_channel(shared, app, &config) {
        push_log(
            shared,
            app,
            format!("channel bot auto-start failed: {error}"),
        );
    }

    emit_state(shared, app);
    Ok(())
}

pub fn stop_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    let cancelled = {
        let state = shared.lock().unwrap();
        state.active_task.clone()
    };
    let mut channel = {
        let mut state = shared.lock().unwrap();
        state.channel.take()
    };
    let mut core = {
        let mut state = shared.lock().unwrap();
        state.core.take()
    };

    if let Some(proc) = channel.as_mut() {
        proc.kill()
            .map_err(|error| format!("failed to stop channel bot: {error}"))?;
        let _ = proc.wait();
        push_log(shared, app, "channel bot stopped");
    }

    if let Some(proc) = core.as_mut() {
        proc.kill()
            .map_err(|error| format!("failed to stop OpenCorvus: {error}"))?;
        let _ = proc.wait();
        push_log(shared, app, "OpenCorvus stopped");
    } else {
        push_log(shared, app, "OpenCorvus is already stopped");
    }
    clear_pid(app, CHANNEL_PID_FILE);
    clear_pid(app, CORE_PID_FILE);

    if let Some(task) = cancelled.as_ref() {
        if emit_task_terminal(shared, app, task, "cancelled", "manager", None, Some(false), Some(-2)) {
            push_log(shared, app, format!("active task cancelled: {}", task.task_id));
        }
    }
    {
        let mut state = shared.lock().unwrap();
        state.prompt_running = false;
        state.active_task = None;
    }

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

pub fn save(
    shared: &Shared,
    app: &AppHandle,
    config: ManagerConfig,
) -> Result<ManagerSnapshot, String> {
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

pub fn apply_channel_env(
    shared: &Shared,
    app: &AppHandle,
    input: ChannelEnvApply,
) -> Result<ManagerSnapshot, String> {
    let Some(channel) = channel_name(&input.channel) else {
        return Err("unsupported channel, use slack/telegram/discord/feishu/whatsapp/googlechat/msteams/line/matrix/mattermost/signal/wecom/dingtalk".into());
    };
    let Some(keys) = channel_env(channel) else {
        return Err(format!("unsupported channel: {channel}"));
    };

    let incoming = norm_env(input.env);
    if incoming.is_empty() {
        return Err("env is empty".into());
    }

    let mut config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };
    config.env = merge_env(config.env, incoming, keys, input.replace);

    let mut shot = save(shared, app, config)?;
    push_log(
        shared,
        app,
        format!(
            "channel env applied: {channel} (restart={}, replace={})",
            input.restart, input.replace
        ),
    );

    if input.restart && (shot.running || shot.channel_running) {
        push_log(
            shared,
            app,
            format!("restarting OpenCorvus to apply `{channel}` channel env"),
        );
        stop_bot(shared, app)?;
        start_bot(shared, app)?;
        shot = snapshot(shared);
    }

    Ok(shot)
}

pub fn reveal_log_path(shared: &Shared, app: &AppHandle) -> Result<String, String> {
    let path = {
        let state = shared.lock().unwrap();
        let item = state.log_path.trim();
        if item.is_empty() {
            log_path(app)?
        } else {
            PathBuf::from(item)
        }
    };

    let target = if path.exists() {
        path.clone()
    } else if let Some(parent) = path.parent() {
        if parent.exists() {
            parent.to_path_buf()
        } else {
            return Err(format!("log path does not exist: {}", path.to_string_lossy()));
        }
    } else {
        return Err(format!("log path does not exist: {}", path.to_string_lossy()));
    };

    reveal_target(&target)?;
    let value = path.to_string_lossy().to_string();
    push_log(shared, app, format!("revealed log path: {value}"));
    Ok(value)
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
    let mut data: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| error.to_string())?;
    let Some(root) = data.as_object_mut() else {
        return Err("invalid config root, expected JSON object".into());
    };

    if !root.contains_key("$schema") {
        root.insert(
            "$schema".into(),
            serde_json::Value::String(CONFIG_SCHEMA.into()),
        );
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

    let dir = work_dir(shared)
        .join(".opencorvus")
        .join("skills")
        .join(&name);
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

fn session_api_base(config: &ManagerConfig) -> Option<String> {
    let base = config.server_url.trim().trim_end_matches('/').trim();
    if base.is_empty() {
        return None;
    }
    if !base.starts_with("http://") && !base.starts_with("https://") {
        return None;
    }
    Some(base.to_string())
}

fn session_api_agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_millis(SESSION_API_TIMEOUT_CONNECT_MS))
        .timeout_read(Duration::from_millis(SESSION_API_TIMEOUT_READ_MS))
        .timeout_write(Duration::from_millis(SESSION_API_TIMEOUT_READ_MS))
        .build()
}

fn session_api_error(error: ureq::Error) -> String {
    match error {
        ureq::Error::Status(code, resp) => {
            let body = resp.into_string().unwrap_or_default();
            let text = body.trim();
            if text.is_empty() {
                return format!("http {code}");
            }
            format!("http {code}: {text}")
        }
        ureq::Error::Transport(error) => error.to_string(),
    }
}

fn list_sessions_via_api(config: &ManagerConfig) -> Result<Vec<SessionListItem>, String> {
    let Some(base) = session_api_base(config) else {
        return Err("server_url is empty".into());
    };
    let url = format!("{base}/session?roots=true&limit=120");
    let response = session_api_agent()
        .get(&url)
        .call()
        .map_err(session_api_error)?;
    let list = response
        .into_json::<Vec<SessionApiItem>>()
        .map_err(|error| format!("parse session API response failed: {error}"))?;
    Ok(list
        .into_iter()
        .map(|item| SessionListItem {
            id: item.id,
            title: item.title,
            updated: item.time.updated,
            created: item.time.created,
            project_id: item.project_id,
            directory: item.directory,
        })
        .collect())
}

fn delete_session_via_api(config: &ManagerConfig, session_id: &str) -> Result<(), String> {
    let Some(base) = session_api_base(config) else {
        return Err("server_url is empty".into());
    };
    let url = format!("{base}/session/{session_id}");
    let response = session_api_agent()
        .delete(&url)
        .call()
        .map_err(session_api_error)?;
    let ok = response
        .into_json::<bool>()
        .map_err(|error| format!("parse session delete API response failed: {error}"))?;
    if ok {
        return Ok(());
    }
    Err("session delete API returned false".into())
}

fn export_session_html_via_api(
    config: &ManagerConfig,
    session_id: &str,
    out: &str,
) -> Result<String, String> {
    let Some(base) = session_api_base(config) else {
        return Err("server_url is empty".into());
    };
    let url = format!("{base}/session/{session_id}/export-html");
    let response = session_api_agent()
        .post(&url)
        .send_json(serde_json::json!({ "out": out }))
        .map_err(session_api_error)?;
    let result = response
        .into_json::<SessionExportApiResult>()
        .map_err(|error| format!("parse session export API response failed: {error}"))?;
    Ok(result.file)
}

pub fn list_sessions(shared: &Shared, app: &AppHandle) -> Result<Vec<SessionListItem>, String> {
    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };

    let list_api = list_sessions_via_api(&config);
    if let Ok(list) = list_api {
        push_log(
            shared,
            app,
            format!("loaded {} sessions from server API", list.len()),
        );
        return Ok(list);
    }
    if let Err(error) = list_api {
        push_log(
            shared,
            app,
            format!("session list API unavailable, fallback to CLI: {error}"),
        );
    }

    let mut cmd = build_command(
        &config,
        &[
            "session".into(),
            "list".into(),
            "--format".into(),
            "json".into(),
            "--max-count".into(),
            "120".into(),
        ],
    );
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|error| format!("failed to load sessions from database: {error}"))?;
    let stdout = decode_output_bytes(&output.stdout).trim().to_string();
    let stderr = decode_output_bytes(&output.stderr).trim().to_string();
    if !output.status.success() {
        let hint = if stderr.is_empty() {
            "unknown error".to_string()
        } else {
            stderr
        };
        return Err(format!("failed to run `session list`: {hint}"));
    }

    if stdout.is_empty() {
        push_log(shared, app, "loaded 0 sessions from database");
        return Ok(vec![]);
    }

    let list = serde_json::from_str::<Vec<SessionListItem>>(&stdout)
        .map_err(|error| format!("failed to parse session list JSON: {error}"))?;
    push_log(
        shared,
        app,
        format!("loaded {} sessions from database (CLI fallback)", list.len()),
    );
    Ok(list)
}

pub fn use_session(
    shared: &Shared,
    app: &AppHandle,
    session_id: String,
) -> Result<ManagerSnapshot, String> {
    let id = session_id.trim().to_string();
    if id.is_empty() {
        return Err("session id is empty".into());
    }
    write_shared_session(shared, &id)?;
    push_log(shared, app, format!("session loaded from database: {id}"));
    emit_state(shared, app);
    Ok(snapshot(shared))
}

pub fn delete_session(
    shared: &Shared,
    app: &AppHandle,
    session_id: String,
) -> Result<ManagerSnapshot, String> {
    let id = session_id.trim().to_string();
    if id.is_empty() {
        return Err("session id is empty".into());
    }

    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };

    let delete_api = delete_session_via_api(&config, &id);
    if delete_api.is_ok() {
        if read_shared_session(shared).as_deref() == Some(id.as_str()) {
            match clear_shared_session(shared) {
                Ok(true) => push_log(shared, app, "shared session cleared after deletion"),
                Ok(false) => {}
                Err(error) => push_log(
                    shared,
                    app,
                    format!("failed to clear shared session after deletion: {error}"),
                ),
            }
        }
        push_log(shared, app, format!("session deleted from server API: {id}"));
        emit_state(shared, app);
        return Ok(snapshot(shared));
    }
    if let Err(error) = delete_api {
        push_log(
            shared,
            app,
            format!("session delete API unavailable, fallback to CLI: {error}"),
        );
    }

    let mut cmd = build_command(
        &config,
        &["session".into(), "delete".into(), id.clone(), "--yes".into()],
    );
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|error| format!("failed to delete session from database: {error}"))?;
    let stdout = decode_output_bytes(&output.stdout).trim().to_string();
    let stderr = decode_output_bytes(&output.stderr).trim().to_string();
    if !output.status.success() {
        let hint = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "unknown error".to_string()
        };
        return Err(format!("failed to run `session delete`: {hint}"));
    }

    if read_shared_session(shared).as_deref() == Some(id.as_str()) {
        match clear_shared_session(shared) {
            Ok(true) => push_log(shared, app, "shared session cleared after deletion"),
            Ok(false) => {}
            Err(error) => push_log(
                shared,
                app,
                format!("failed to clear shared session after deletion: {error}"),
            ),
        }
    }

    push_log(
        shared,
        app,
        format!("session deleted from database (CLI fallback): {id}"),
    );
    emit_state(shared, app);
    Ok(snapshot(shared))
}

fn safe_file_name(input: &str) -> String {
    let id = input
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || *ch == '-' || *ch == '_')
        .collect::<String>();
    if id.is_empty() {
        "session".into()
    } else {
        id
    }
}

pub fn export_session_html(
    shared: &Shared,
    app: &AppHandle,
    session_id: String,
) -> Result<String, String> {
    let id = session_id.trim().to_string();
    if id.is_empty() {
        return Err("session id is empty".into());
    }

    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };

    let dir = work_dir(shared).join(".opencorvus").join("exports");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let fallback = dir.join(format!("session-{}-trace.html", safe_file_name(&id)));
    let fallback_text = fallback.to_string_lossy().to_string();

    let export_api = export_session_html_via_api(&config, &id, &fallback_text);
    if let Ok(file) = export_api {
        let path = PathBuf::from(file.trim());
        open_target(&path)?;
        let value = path.to_string_lossy().to_string();
        push_log(shared, app, format!("session HTML exported via server API: {value}"));
        return Ok(value);
    }
    if let Err(error) = export_api {
        push_log(
            shared,
            app,
            format!("session export API unavailable, fallback to CLI: {error}"),
        );
    }

    let mut cmd = build_command(
        &config,
        &[
            "export".into(),
            id.clone(),
            "--html".into(),
            "--out".into(),
            fallback_text.clone(),
        ],
    );
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = cmd
        .output()
        .map_err(|error| format!("failed to export session HTML: {error}"))?;
    let stdout = decode_output_bytes(&output.stdout).trim().to_string();
    let stderr = decode_output_bytes(&output.stderr).trim().to_string();
    if !output.status.success() {
        let hint = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "unknown error".to_string()
        };
        return Err(format!("failed to run `export --html`: {hint}"));
    }

    let file = if !stdout.is_empty() {
        stdout.lines().last().unwrap_or("").trim().to_string()
    } else {
        fallback_text
    };

    let path = PathBuf::from(file.trim());
    open_target(&path)?;
    let value = path.to_string_lossy().to_string();
    push_log(
        shared,
        app,
        format!("session HTML exported via CLI fallback: {value}"),
    );
    Ok(value)
}

pub fn send(shared: &Shared, app: &AppHandle, prompt: String) -> Result<SendAck, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }

    let (task, loop_id) = {
        let mut state = shared.lock().unwrap();
        if state.prompt_running {
            return Err("a prompt is already running".into());
        }
        state.prompt_running = true;
        let task = next_task_run(&mut state);
        state.active_task = Some(task.clone());
        (task, state.loop_id.clone())
    };

    emit_state(shared, app);
    emit_loop_chat(
        shared,
        app,
        Some(&task),
        "task.status",
        Some("accepted"),
        false,
        "manager",
        "task",
        None,
        None,
        None,
        None,
        None,
    );

    let shared2 = shared.clone();
    let app2 = app.clone();
    let task2 = task.clone();
    std::thread::spawn(move || {
        let result = run_prompt(&shared2, &app2, prompt, task2.clone());
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
            if state
                .active_task
                .as_ref()
                .map(|item| item.task_id.as_str())
                == Some(task2.task_id.as_str())
            {
                state.active_task = None;
            }
        }
        emit_state(&shared2, &app2);
    });

    Ok(SendAck {
        accepted: true,
        loop_id,
        turn_id: task.turn_id,
        task_id: task.task_id,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seed_task(shared: &Shared) -> TaskRun {
        let mut state = shared.lock().unwrap();
        state.prompt_running = true;
        let task = next_task_run(&mut state);
        state.active_task = Some(task.clone());
        task
    }

    #[test]
    fn channel_alias_works() {
        assert_eq!(channel_name("slack"), Some("slack"));
        assert_eq!(channel_name("lark"), Some("feishu"));
        assert_eq!(channel_name("ms-teams"), Some("msteams"));
        assert!(channel_env("slack").is_some());
        assert!(channel_env("unknown").is_none());
    }

    #[test]
    fn merge_env_replaces_channel_keys() {
        let base = vec![
            EnvItem {
                key: "SLACK_BOT_TOKEN".into(),
                value: "old".into(),
            },
            EnvItem {
                key: "SLACK_APP_TOKEN".into(),
                value: "old-app".into(),
            },
            EnvItem {
                key: "OPENCORVUS_BOT_PERMISSION_PROFILE".into(),
                value: "standard".into(),
            },
        ];
        let next = vec![
            EnvItem {
                key: "SLACK_BOT_TOKEN".into(),
                value: "new".into(),
            },
            EnvItem {
                key: "SLACK_CHANNEL_ID".into(),
                value: "C123".into(),
            },
        ];
        let out = merge_env(base, next, CHANNEL_SLACK_ENV, true);
        assert_eq!(
            out.iter()
                .find(|item| item.key == "SLACK_BOT_TOKEN")
                .map(|item| item.value.as_str()),
            Some("new")
        );
        assert_eq!(
            out.iter()
                .find(|item| item.key == "SLACK_CHANNEL_ID")
                .map(|item| item.value.as_str()),
            Some("C123")
        );
        assert_eq!(
            out.iter()
                .find(|item| item.key == "OPENCORVUS_BOT_PERMISSION_PROFILE")
                .map(|item| item.value.as_str()),
            Some("standard")
        );
    }

    #[test]
    fn close_active_task_is_idempotent() {
        let shared = new_shared();
        let task = seed_task(&shared);
        assert!(close_active_task(&shared, &task));
        assert!(!close_active_task(&shared, &task));
    }

    #[test]
    fn probe_first_then_run_prompt_late_close() {
        let shared = new_shared();
        let task = seed_task(&shared);
        {
            let mut state = shared.lock().unwrap();
            let claimed = probe_cancelled_task(&mut state, true)
                .as_ref()
                .map(|item| item.task_id.clone());
            assert_eq!(claimed.as_deref(), Some(task.task_id.as_str()));
            assert!(state.prompt_running);
        }
        assert!(close_active_task(&shared, &task));
        assert!(!close_active_task(&shared, &task));
    }

    #[test]
    fn run_prompt_first_then_probe_skips_cancel() {
        let shared = new_shared();
        let task = seed_task(&shared);
        assert!(close_active_task(&shared, &task));
        {
            let mut state = shared.lock().unwrap();
            assert!(probe_cancelled_task(&mut state, true).is_none());
            assert!(!state.prompt_running);
            assert!(state.active_task.is_none());
        }
    }
}
