use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};

use crate::manager::{self, Shared};

const MENU_OPEN: &str = "open-console";
const MENU_START: &str = "start-bot";
const MENU_STOP: &str = "stop-bot";
const MENU_QUIT: &str = "quit-app";

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let open = MenuItem::with_id(app, MENU_OPEN, "Open Argus Console", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let start = MenuItem::with_id(app, MENU_START, "Start Argus", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let stop = MenuItem::with_id(app, MENU_STOP, "Stop Argus", true, None::<&str>)
        .map_err(|error| error.to_string())?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "Quit", true, None::<&str>).map_err(|error| error.to_string())?;

    let menu = Menu::with_items(app, &[&open, &start, &stop, &quit]).map_err(|error| error.to_string())?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| {
            let state = app.state::<Shared>();
            match event.id.as_ref() {
                MENU_OPEN => manager::show_console(app),
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
