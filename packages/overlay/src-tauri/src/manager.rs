use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

use crate::events;

const CONFIG_FILE: &str = "opencorvus-manager.json";
const MAX_LOGS: usize = 800;

#[derive(Deserialize, Serialize, Clone, Default)]
pub struct EnvItem {
    pub key: String,
    pub value: String,
}

#[derive(Deserialize, Serialize, Clone)]
pub struct ManagerConfig {
    pub command: String,
    pub serve_args: Vec<String>,
    pub run_args: Vec<String>,
    pub cwd: String,
    pub env: Vec<EnvItem>,
}

#[derive(Serialize, Clone)]
pub struct ManagerSnapshot {
    pub running: bool,
    pub pid: Option<u32>,
    pub config: ManagerConfig,
    pub logs: Vec<String>,
}

#[derive(Serialize)]
pub struct SendResult {
    pub success: bool,
    pub code: i32,
    pub output: String,
}

pub struct ManagerState {
    config: ManagerConfig,
    logs: VecDeque<String>,
    bot: Option<Child>,
}

pub type Shared = Arc<Mutex<ManagerState>>;

impl Default for ManagerConfig {
    fn default() -> Self {
        Self {
            command: "opencorvus".into(),
            serve_args: vec!["serve".into()],
            run_args: vec!["run".into()],
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
            bot: None,
        }
    }
}

fn stamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|item| item.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

fn norm_list(list: Vec<String>) -> Vec<String> {
    list.into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .collect()
}

fn norm_config(config: ManagerConfig) -> ManagerConfig {
    ManagerConfig {
        command: {
            let item = config.command.trim();
            if item.is_empty() {
                "opencorvus".into()
            } else {
                item.into()
            }
        },
        serve_args: norm_list(config.serve_args),
        run_args: norm_list(config.run_args),
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

    let mut args = config.run_args.clone();
    args.push(prompt);

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
    }
}

pub fn emit_state(shared: &Shared, app: &AppHandle) {
    let _ = app.emit_to(events::WINDOW_CONSOLE, events::EVT_MANAGER_STATE, snapshot(shared));
}

pub fn push_log(shared: &Shared, app: &AppHandle, line: impl Into<String>) {
    let item = format!("[{}] {}", stamp(), line.into());
    {
        let mut state = shared.lock().unwrap();
        state.logs.push_back(item.clone());
        while state.logs.len() > MAX_LOGS {
            state.logs.pop_front();
        }
    }
    let _ = app.emit_to(events::WINDOW_CONSOLE, events::EVT_MANAGER_LOG, item);
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
    if let Ok(config) = load_config(app) {
        shared.lock().unwrap().config = config;
    }
    push_log(shared, app, "OpenCorvus manager ready");
    emit_state(shared, app);
}

pub fn start_bot(shared: &Shared, app: &AppHandle) -> Result<(), String> {
    probe(shared, app);

    let config = {
        let state = shared.lock().unwrap();
        if state.bot.is_some() {
            push_log(shared, app, "OpenCorvus is already running");
            return Ok(());
        }
        state.config.clone()
    };

    let mut cmd = build_command(&config, &config.serve_args);
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
        state.bot = Some(child);
    }

    push_log(
        shared,
        app,
        format!("OpenCorvus started (pid {pid}) with: {} {}", config.command, config.serve_args.join(" ")),
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
