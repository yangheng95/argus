use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream, ToSocketAddrs};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use crate::events;

const CONFIG_FILE: &str = "opencorvus-manager.json";
const LOG_FILE: &str = "opencorvus-manager-log.jsonl";
const MAX_LOGS: usize = 800;
const DEFAULT_SERVE_ARGS: &[&str] = &["serve"];
const DEFAULT_RUN_ARGS: &[&str] = &["run", "--continue"];
const AUTO_PORT_ENV: &str = "OPENCORVUS_OVERLAY_AUTO_PORT";

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct EnvItem {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, Clone)]
#[serde(default)]
pub struct ManagerConfig {
    pub command: String,
    pub cwd: String,
    pub env: Vec<EnvItem>,
    pub serve_args: Vec<String>,
    pub run_args: Vec<String>,
}

#[derive(Serialize, Clone)]
pub struct ManagerSnapshot {
    pub running: bool,
    pub pid: Option<u32>,
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
    bot: Option<Child>,
}

pub type Shared = Arc<Mutex<ManagerState>>;

impl Default for ManagerConfig {
    fn default() -> Self {
        Self {
            command: "opencorvus".into(),
            cwd: String::new(),
            env: vec![],
            serve_args: DEFAULT_SERVE_ARGS.iter().map(|s| (*s).to_string()).collect(),
            run_args: DEFAULT_RUN_ARGS.iter().map(|s| (*s).to_string()).collect(),
        }
    }
}

impl ManagerState {
    fn new() -> Self {
        Self {
            config: ManagerConfig::default(),
            logs: VecDeque::new(),
            log_path: String::new(),
            bot: None,
        }
    }
}

fn stamp() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs())
        .unwrap_or(0)
}

fn norm_config(config: ManagerConfig) -> ManagerConfig {
    let serve_args: Vec<String> = config
        .serve_args
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let run_args: Vec<String> = config
        .run_args
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    ManagerConfig {
        command: {
            let item = config.command.trim();
            if item.is_empty() {
                "opencorvus".into()
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
        serve_args: if serve_args.is_empty() {
            vec!["serve".into()]
        } else {
            serve_args
        },
        run_args: if run_args.is_empty() {
            vec!["run".into(), "--continue".into()]
        } else {
            run_args
        },
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

fn build_command(config: &ManagerConfig, args: &[String]) -> Command {
    let mut cmd = Command::new(&config.command);
    cmd.args(args);
    if !config.cwd.is_empty() {
        cmd.current_dir(&config.cwd);
    }
    for item in &config.env {
        cmd.env(&item.key, &item.value);
    }
    #[cfg(target_os = "windows")]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

fn watch_pipe<R: Read + Send + 'static>(shared: Shared, app: AppHandle, source: R, tag: &'static str) {
    std::thread::spawn(move || {
        for line in BufReader::new(source).lines() {
            match line {
                Ok(text) if !text.trim().is_empty() => {
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

fn run_prompt(shared: &Shared, app: &AppHandle, prompt: String) -> SendResult {
    let config = {
        let state = shared.lock().unwrap();
        state.config.clone()
    };

    push_log(shared, app, format!("prompt> {prompt}"));

    let mut args = if config.run_args.is_empty() {
        DEFAULT_RUN_ARGS.iter().map(|item| (*item).to_string()).collect::<Vec<_>>()
    } else {
        config.run_args.clone()
    };
    args.push(prompt);

    if let Err(error) = check_attach_health(&config.run_args) {
        let message = format!("attach endpoint unavailable: {error}");
        push_log(shared, app, message.clone());
        return SendResult {
            success: false,
            code: -1,
            output: message,
        };
    }

    let mut cmd = build_command(&config, &args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let output = match cmd.output() {
        Ok(output) => output,
        Err(error) => {
            let message = format!("failed to run prompt command: {error}");
            push_log(shared, app, message.clone());
            return SendResult {
                success: false,
                code: -1,
                output: message,
            };
        }
    };

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    for line in stdout.lines() {
        push_log(shared, app, format!("[run] {line}"));
    }
    for line in stderr.lines() {
        push_log(shared, app, format!("[run:err] {line}"));
    }

    let success = output.status.success();
    let code = output.status.code().unwrap_or(if success { 0 } else { -1 });
    let text = if !stdout.is_empty() {
        stdout
    } else if !stderr.is_empty() {
        stderr
    } else if success {
        "(empty response)".into()
    } else {
        format!("command failed with code {code}")
    };

    SendResult {
        success,
        code,
        output: text,
    }
}

fn attach_arg(args: &[String]) -> Option<String> {
    args.iter().enumerate().find_map(|(index, arg)| {
        if arg == "--attach" {
            return args.get(index + 1).cloned();
        }
        arg.strip_prefix("--attach=").map(|item| item.to_string())
    })
}

fn attach_target(input: &str) -> Option<(String, u16)> {
    let text = input.trim();
    if text.is_empty() {
        return None;
    }
    let rest = text.strip_prefix("http://")?;
    let host = rest.split('/').next()?;
    let (name, port) = host.rsplit_once(':')?;
    if name.trim().is_empty() {
        return None;
    }
    let value = port.parse::<u16>().ok()?;
    Some((name.to_string(), value))
}

fn check_attach_health(args: &[String]) -> Result<(), String> {
    let Some(raw) = attach_arg(args) else {
        return Ok(());
    };
    let Some((host, port)) = attach_target(&raw) else {
        return Ok(());
    };

    let addr = format!("{host}:{port}");
    let socket = addr
        .to_socket_addrs()
        .map_err(|error| format!("cannot resolve {addr}: {error}"))?
        .next()
        .ok_or_else(|| format!("cannot resolve {addr}"))?;
    let mut stream = TcpStream::connect_timeout(&socket, Duration::from_millis(1200))
        .map_err(|error| format!("{addr} connect failed: {error}"))?;
    let _ = stream.set_write_timeout(Some(Duration::from_millis(1200)));
    let _ = stream.set_read_timeout(Some(Duration::from_millis(1200)));
    let req = format!("GET /path HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n");
    stream
        .write_all(req.as_bytes())
        .map_err(|error| format!("{addr} write failed: {error}"))?;

    let mut buf = [0u8; 12];
    let count = stream
        .read(&mut buf)
        .map_err(|error| format!("{addr} read failed: {error}"))?;
    if count == 0 {
        return Err(format!("{addr} sent empty response"));
    }
    let prefix = String::from_utf8_lossy(&buf[..count]);
    if prefix.starts_with("HTTP/") {
        return Ok(());
    }
    Err(format!(
        "{addr} responded with invalid protocol, likely occupied by another process"
    ))
}

fn flag_value(args: &[String], key: &str) -> Option<String> {
    let prefix = format!("{key}=");
    args.iter().enumerate().find_map(|(index, item)| {
        if item == key {
            return args.get(index + 1).cloned();
        }
        item.strip_prefix(&prefix).map(|value| value.to_string())
    })
}

fn set_flag(args: &mut Vec<String>, key: &str, value: String) {
    let prefix = format!("{key}=");
    for index in 0..args.len() {
        if args[index] == key {
            if let Some(next) = args.get_mut(index + 1) {
                *next = value;
            } else {
                args.push(value);
            }
            return;
        }
        if args[index].starts_with(&prefix) {
            args[index] = format!("{key}={value}");
            return;
        }
    }
    args.push(key.to_string());
    args.push(value);
}

fn serve_host(args: &[String]) -> String {
    flag_value(args, "--hostname")
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

fn serve_port(args: &[String]) -> Option<u16> {
    flag_value(args, "--port")
        .and_then(|item| item.trim().parse::<u16>().ok())
        .filter(|item| *item > 0)
}

fn bind_addr(host: &str, port: u16) -> String {
    format!("{host}:{port}")
}

fn port_available(host: &str, port: u16) -> bool {
    TcpListener::bind(bind_addr(host, port)).is_ok()
}

fn next_port(host: &str) -> Option<u16> {
    TcpListener::bind(bind_addr(host, 0))
        .ok()
        .and_then(|listener| listener.local_addr().ok())
        .map(|addr| addr.port())
        .filter(|port| *port > 0)
}

fn align_attach(args: &mut Vec<String>, host: &str, port: u16) {
    let attach_host = attach_arg(args)
        .and_then(|item| attach_target(&item))
        .map(|(name, _)| name)
        .unwrap_or_else(|| {
            if host == "0.0.0.0" || host == "::" {
                "127.0.0.1".to_string()
            } else {
                host.to_string()
            }
        });
    set_flag(args, "--attach", format!("http://{attach_host}:{port}"));
}

fn auto_port_enabled() -> bool {
    std::env::var(AUTO_PORT_ENV)
        .ok()
        .map(|item| item.trim() != "0")
        .unwrap_or(true)
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
    let state = shared.lock().unwrap();
    ManagerSnapshot {
        running: state.bot.is_some(),
        pid: state.bot.as_ref().map(|child| child.id()),
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
    let note = {
        let mut state = shared.lock().unwrap();
        let Some(child) = state.bot.as_mut() else {
            return;
        };

        match child.try_wait() {
            Ok(Some(status)) => {
                state.bot = None;
                let code = status.code().map(|item| item.to_string()).unwrap_or_else(|| "signal".into());
                Some(format!("OpenCorvus exited ({code})"))
            }
            Ok(None) => None,
            Err(error) => {
                state.bot = None;
                Some(format!("failed to check OpenCorvus status: {error}"))
            }
        }
    };

    if let Some(line) = note {
        push_log(shared, app, line);
        emit_state(shared, app);
    }
}

pub fn init(shared: &Shared, app: &AppHandle) {
    if let Ok(path) = log_path(app) {
        shared.lock().unwrap().log_path = path.to_string_lossy().to_string();
    }
    if let Ok(config) = load_config(app) {
        shared.lock().unwrap().config = config;
    }
    push_log(shared, app, "OpenCorvus manager ready");
    emit_state(shared, app);
}

pub fn start_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    probe(shared, app);

    let mut config = {
        let state = shared.lock().unwrap();
        if state.bot.is_some() {
            push_log(shared, app, "OpenCorvus is already running");
            return Ok(());
        }
        state.config.clone()
    };

    if auto_port_enabled() {
        let host = serve_host(&config.serve_args);
        if let Some(current) = serve_port(&config.serve_args) {
            if !port_available(&host, current) {
                if let Some(next) = next_port(&host) {
                    set_flag(&mut config.serve_args, "--port", next.to_string());
                    align_attach(&mut config.run_args, &host, next);
                    push_log(
                        shared,
                        app,
                        format!("Port {current} is occupied, auto-switched to {next} for this session"),
                    );
                } else {
                    push_log(
                        shared,
                        app,
                        format!("Port {current} is occupied and no free replacement port was found"),
                    );
                }
            }
        }
    }

    let args = if config.serve_args.is_empty() {
        DEFAULT_SERVE_ARGS.iter().map(|item| (*item).to_string()).collect::<Vec<_>>()
    } else {
        config.serve_args.clone()
    };
    let mut cmd = build_command(&config, &args);
    cmd.stdin(Stdio::null());
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());

    let mut child = cmd
        .spawn()
        .map_err(|error| format!("failed to start OpenCorvus ({}): {error}", config.command))?;

    let pid = child.id();
    if let Some(stdout) = child.stdout.take() {
        watch_pipe(shared.clone(), app.clone(), stdout, "bot");
    }
    if let Some(stderr) = child.stderr.take() {
        watch_pipe(shared.clone(), app.clone(), stderr, "err");
    }

    {
        let mut state = shared.lock().unwrap();
        state.config = config.clone();
        state.bot = Some(child);
    }

    push_log(
        shared,
        app,
        format!("OpenCorvus started (pid {pid}) with: {} {}", config.command, args.join(" ")),
    );
    emit_state(shared, app);
    Ok(())
}

pub fn stop_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    let mut child = {
        let mut state = shared.lock().unwrap();
        state.bot.take()
    };

    if let Some(proc) = child.as_mut() {
        proc.kill().map_err(|error| format!("failed to stop OpenCorvus: {error}"))?;
        let _ = proc.wait();
        push_log(shared, app, "OpenCorvus stopped");
    } else {
        push_log(shared, app, "OpenCorvus is already stopped");
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

pub fn send(shared: &Shared, app: &AppHandle, prompt: String) -> Result<SendResult, String> {
    let prompt = prompt.trim().to_string();
    if prompt.is_empty() {
        return Err("prompt is empty".into());
    }
    Ok(run_prompt(shared, app, prompt))
}
