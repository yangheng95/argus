#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod commands;
mod events;
mod manager;
mod overlay;
mod tray;

use tauri::Manager;

fn main() {
    let shared = manager::new_shared();
    let sidecar = std::env::var("OPENCORVUS_OVERLAY_MODE")
        .ok()
        .map(|item| item == "sidecar")
        .unwrap_or(false);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Another instance tried to launch — bring existing console to front
            manager::show_console(app);
        }))
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
            commands::manager_open_skill_dir,
            commands::manager_add_mcp,
            commands::manager_create_skill
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
                    manager::push_log(state.inner(), &app.handle(), format!("tray setup failed: {error}"));
                }
                manager::show_console(&app.handle());
            }
            overlay::apply_overlay_window_style(app);
            overlay::start_stdin_bridge(app);
            let forced = std::env::var("OPENCORVUS_OVERLAY_SHOW_CONSOLE")
                .ok()
                .as_deref()
                == Some("1");
            let bridge_mode = std::env::var("OPENCORVUS_OVERLAY_STDIN_EXIT")
                .ok()
                .as_deref()
                == Some("1");
            if forced || !bridge_mode {
                manager::show_console(&app.handle());
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap();
}
