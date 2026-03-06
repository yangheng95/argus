use tauri::{AppHandle, State, WebviewWindow};

use crate::manager::{
    self, ChannelEnvApply, ManagerConfig, ManagerSnapshot, McpQuickConfig, SendAck,
    SessionListItem, Shared,
};
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
pub fn manager_reveal_log_path(state: State<'_, Shared>, app: AppHandle) -> Result<String, String> {
    manager::reveal_log_path(state.inner(), &app)
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
pub fn manager_apply_channel_env(
    state: State<'_, Shared>,
    app: AppHandle,
    input: ChannelEnvApply,
) -> Result<ManagerSnapshot, String> {
    manager::apply_channel_env(state.inner(), &app, input)
}

#[tauri::command]
pub fn manager_send(
    state: State<'_, Shared>,
    app: AppHandle,
    prompt: String,
) -> Result<SendAck, String> {
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

#[tauri::command]
pub async fn manager_list_sessions(
    state: State<'_, Shared>,
    app: AppHandle,
) -> Result<Vec<SessionListItem>, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager::list_sessions(&shared, &app))
        .await
        .map_err(|error| format!("manager_list_sessions task failed: {error}"))?
}

#[tauri::command]
pub async fn manager_use_session(
    state: State<'_, Shared>,
    app: AppHandle,
    session_id: String,
) -> Result<ManagerSnapshot, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager::use_session(&shared, &app, session_id))
        .await
        .map_err(|error| format!("manager_use_session task failed: {error}"))?
}

#[tauri::command]
pub async fn manager_delete_session(
    state: State<'_, Shared>,
    app: AppHandle,
    session_id: String,
) -> Result<ManagerSnapshot, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || manager::delete_session(&shared, &app, session_id))
        .await
        .map_err(|error| format!("manager_delete_session task failed: {error}"))?
}

#[tauri::command]
pub async fn manager_export_session_html(
    state: State<'_, Shared>,
    app: AppHandle,
    session_id: String,
) -> Result<String, String> {
    let shared = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        manager::export_session_html(&shared, &app, session_id)
    })
    .await
    .map_err(|error| format!("manager_export_session_html task failed: {error}"))?
}
