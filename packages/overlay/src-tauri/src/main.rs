#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod events;
mod manager;
mod overlay;
mod tray;

use tauri::Manager;

fn main() {
    let shared = manager::new_shared();

    tauri::Builder::default()
        .manage(shared)
        .invoke_handler(tauri::generate_handler![
            commands::position_window,
            commands::hide_window,
            commands::confirm_reply,
            commands::manager_open,
            commands::manager_get,
            commands::manager_start,
            commands::manager_stop,
            commands::manager_clear_logs,
            commands::manager_save,
            commands::manager_send,
            commands::manager_open_mcp_config,
            commands::manager_open_skill_dir
        ])
        .setup(|app| {
            let state = app.state::<manager::Shared>();
            manager::init(state.inner(), &app.handle());
            if let Err(error) = manager::start_bot(state.inner(), &app.handle()) {
                manager::push_log(
                    state.inner(),
                    &app.handle(),
                    format!("auto-start failed: {error}"),
                );
            }
            let _ = tray::setup(&app.handle());
            overlay::apply_overlay_window_style(app);
            overlay::start_stdin_bridge(app);
            manager::show_console(&app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
