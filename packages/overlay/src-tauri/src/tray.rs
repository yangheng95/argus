use tauri::image::Image;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::manager::{self, Shared};

const MENU_OPEN: &str = "open-console";
const MENU_MCP: &str = "open-mcp-config";
const MENU_SKILL: &str = "open-skill-dir";
const MENU_START: &str = "start-bot";
const MENU_STOP: &str = "stop-bot";
const MENU_QUIT: &str = "quit-app";

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open OpenCorvus Console", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let mcp = MenuItem::with_id(app, MENU_MCP, "Open MCP Config", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let skill = MenuItem::with_id(app, MENU_SKILL, "Open Skills Folder", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let start = MenuItem::with_id(app, MENU_START, "Start OpenCorvus", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let stop = MenuItem::with_id(app, MENU_STOP, "Stop OpenCorvus", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>).map_err(|error| error.to_string())?;

    let menu =
        Menu::with_items(app, &[&open, &mcp, &skill, &start, &stop, &quit]).map_err(|error| error.to_string())?;

    let icon = Image::from_bytes(include_bytes!("../icons/icon.ico"))
        .map_err(|error| error.to_string())?;

    let _tray = TrayIconBuilder::new()
        .icon(icon)
        .tooltip("OpenCorvus")
        .menu(&menu)
        .on_menu_event(|app, event| {
            let state = app.state::<Shared>();
            match event.id.as_ref() {
                MENU_OPEN => manager::show_console(app),
                MENU_MCP => {
                    let _ = manager::open_mcp_config(state.inner(), app);
                }
                MENU_SKILL => {
                    let _ = manager::open_skill_dir(state.inner(), app);
                }
                MENU_START => {
                    let _ = manager::start_bot(state.inner(), app);
                }
                MENU_STOP => {
                    let _ = manager::stop_bot(state.inner(), app);
                }
                MENU_QUIT => app.exit(0),
                _ => {}
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                manager::show_console(&tray.app_handle());
            }
        })
        .build(app)
        .map_err(|error| error.to_string())?;

    Ok(())
}
