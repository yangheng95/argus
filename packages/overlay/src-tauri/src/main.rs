#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod events;
mod manager;
mod overlay;
mod tray;

use tauri::Manager;
use tauri::RunEvent;

fn main() {
    let shared = manager::new_shared();
    let sidecar = std::env::var("OPENCORVUS_OVERLAY_MODE")
        .ok()
        .map(|item| item == "sidecar")
        .unwrap_or(false);

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
            commands::manager_reveal_log_path,
            commands::manager_save,
            commands::manager_send,
            commands::manager_open_mcp_config,
            commands::manager_open_skill_dir,
            commands::manager_add_mcp,
            commands::manager_create_skill,
            commands::manager_list_sessions,
            commands::manager_use_session,
            commands::manager_delete_session,
            commands::manager_export_session_html
        ])
        .setup(move |app| {
            let state = app.state::<manager::Shared>();
            manager::init(state.inner(), &app.handle());
            if !sidecar {
                if let Err(error) = manager::start_bot(state.inner(), &app.handle()) {
                    manager::push_log(
                        state.inner(),
                        &app.handle(),
                        format!("auto-start failed: {error}"),
                    );
                }
                if let Err(error) = tray::setup(&app.handle()) {
                    manager::push_log(
                        state.inner(),
                        &app.handle(),
                        format!("tray setup failed: {error}"),
                    );
                }
                manager::show_console(&app.handle());
            }
            overlay::apply_overlay_window_style(app);
            overlay::start_stdin_bridge(app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .unwrap()
        .run(move |app, event| {
            let stop_once = || {
                let state = app.state::<manager::Shared>();
                let snapshot = manager::snapshot(state.inner());
                if !snapshot.running && !snapshot.channel_running {
                    return;
                }
                if let Err(error) = manager::stop_bot(state.inner(), app) {
                    manager::push_log(state.inner(), app, format!("shutdown stop failed: {error}"));
                }
            };

            match event {
                RunEvent::WindowEvent { label, event, .. } => {
                    if sidecar || label != events::WINDOW_CONSOLE {
                        return;
                    }
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        stop_once();
                        app.exit(0);
                    }
                }
                RunEvent::ExitRequested { .. } | RunEvent::Exit => {
                    stop_once();
                }
                _ => {}
            }
        });
}
