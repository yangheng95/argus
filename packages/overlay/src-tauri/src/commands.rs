use tauri::{AppHandle, State, WebviewWindow};

use crate::manager::{self, ManagerConfig, ManagerSnapshot, McpQuickConfig, SendAck, Shared};
use crate::overlay;

#[tauri::command]
pub fn position_window(window: WebviewWindow, x: i32, y: i32) {
    overlay::position_window(window, x, y);
}

#[tauri::command]
pub fn hide_window(window: WebviewWindow) {
    overlay::hide_window(window);
}

#[tauri::command]
pub fn confirm_reply(window: WebviewWindow, id: String, answer: String) {
    overlay::confirm_reply(window, id, answer);
}

#[tauri::command]
pub fn manager_open(app: AppHandle) {
    manager::show_console(&app);
}

#[tauri::command]
pub fn manager_get(state: State<'_, Shared>, app: AppHandle) -> ManagerSnapshot {
    manager::probe(state.inner(), &app);
    manager::snapshot(state.inner())
}

#[tauri::command]
pub fn manager_start(state: State<'_, Shared>, app: AppHandle) -> Result<ManagerSnapshot, String> {
    manager::start_bot(state.inner(), &app)?;
    Ok(manager::snapshot(state.inner()))
}

#[tauri::command]
pub fn manager_stop(state: State<'_, Shared>, app: AppHandle) -> Result<ManagerSnapshot, String> {
    manager::stop_bot(state.inner(), &app)?;
    Ok(manager::snapshot(state.inner()))
}

#[tauri::command]
pub fn manager_clear_logs(state: State<'_, Shared>, app: AppHandle) -> ManagerSnapshot {
    manager::clear_logs(state.inner(), &app)
}

#[tauri::command]
pub fn manager_save(
    state: State<'_, Shared>,
    app: AppHandle,
    config: ManagerConfig,
) -> Result<ManagerSnapshot, String> {
    manager::save(state.inner(), &app, config)
}

#[tauri::command]
pub fn manager_send(state: State<'_, Shared>, app: AppHandle, prompt: String) -> Result<SendAck, String> {
    manager::send(state.inner(), &app, prompt)
}

#[tauri::command]
pub fn manager_open_mcp_config(state: State<'_, Shared>, app: AppHandle) -> Result<String, String> {
    manager::open_mcp_config(state.inner(), &app)
}

#[tauri::command]
pub fn manager_open_skill_dir(state: State<'_, Shared>, app: AppHandle) -> Result<String, String> {
    manager::open_skill_dir(state.inner(), &app)
}

#[tauri::command]
pub fn manager_add_mcp(
    state: State<'_, Shared>,
    app: AppHandle,
    name: String,
    config: McpQuickConfig,
) -> Result<String, String> {
    manager::add_mcp(state.inner(), &app, name, config)
}

#[tauri::command]
pub fn manager_create_skill(
    state: State<'_, Shared>,
    app: AppHandle,
    name: String,
    description: String,
) -> Result<String, String> {
    manager::create_skill(state.inner(), &app, name, description)
}
