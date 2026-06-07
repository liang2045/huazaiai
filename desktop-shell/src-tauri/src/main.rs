#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use tauri::{Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const LOCAL_PORT: u16 = 18766;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct LocalProcess(Mutex<Option<Child>>);

#[tauri::command]
fn local_port() -> u16 {
    LOCAL_PORT
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(LocalProcess(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![local_port])
        .setup(|app| {
            set_window_icons(app);
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let state = app_handle.state::<LocalProcess>();
                if start_local_process(&app_handle, &state).is_ok() {
                    show_main_windows(&app_handle);
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                if window.app_handle().webview_windows().is_empty() {
                    let state = window.state::<LocalProcess>();
                    stop_local_process(&state);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("application runtime failed");
}

fn show_main_windows(app: &tauri::AppHandle) {
    let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1:{LOCAL_PORT}/")) else {
        return;
    };

    for window in app.webview_windows().values() {
        let _ = window.navigate(url.clone());
        let _ = window.center();
        let _ = window.maximize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn set_window_icons(app: &tauri::App) {
    let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/window-icon.png")) else {
        return;
    };

    for window in app.webview_windows().values() {
        let _ = window.set_icon(icon.clone());
    }
}

fn start_local_process(app: &tauri::AppHandle, state: &State<LocalProcess>) -> Result<(), String> {
    if is_service_ready(LOCAL_PORT) {
        return Ok(());
    }

    let service = resolve_service_path(app)?;
    let user_data = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?;
    std::fs::create_dir_all(&user_data).map_err(|err| err.to_string())?;

    let mut command = Command::new(&service);
    command
        .env("PORT", LOCAL_PORT.to_string())
        .env("HOST", "127.0.0.1")
        .env("APP_PACKAGED", "1")
        .env("APP_DATA_DIR", user_data)
        .env("APP_FRONTEND_DIR", resolve_frontend_dist(app)?)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let child = command
        .spawn()
        .map_err(|err| format!("local process start failed: {err}"))?;

    *state.0.lock().map_err(|_| "process lock poisoned")? = Some(child);

    for _ in 0..120 {
        if is_service_ready(LOCAL_PORT) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    Err("local process did not become ready".to_owned())
}

fn stop_local_process(state: &State<LocalProcess>) {
    if let Ok(mut guard) = state.0.lock() {
        if let Some(mut child) = guard.take() {
            let _ = child.kill();
        }
    }
}

fn resolve_service_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("APP_SERVICE_EXE") {
        return Ok(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let adjacent = dir.join("bin").join("service.exe");
            if adjacent.exists() {
                return Ok(adjacent);
            }
        }
    }
    if let Ok(resource) = app
        .path()
        .resolve("bin/service.exe", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return Ok(resource);
        }
    }
    let dev = PathBuf::from("../../service/target/release/service.exe");
    if dev.exists() {
        return Ok(dev);
    }
    Err("local process not found".to_owned())
}

fn resolve_frontend_dist(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("APP_FRONTEND_DIR") {
        return Ok(PathBuf::from(path));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let adjacent = dir.join("frontend");
            if adjacent.exists() {
                return Ok(adjacent);
            }
        }
    }
    if let Ok(resource) = app
        .path()
        .resolve("frontend", tauri::path::BaseDirectory::Resource)
    {
        if resource.exists() {
            return Ok(resource);
        }
    }
    Ok(PathBuf::from("../../frontend/dist"))
}

fn is_service_ready(port: u16) -> bool {
    let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
    let request = b"GET /api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request).is_err() {
        return false;
    }

    let mut buf = String::new();
    if stream.read_to_string(&mut buf).is_err() {
        return false;
    }
    buf.contains("200 OK") && buf.contains("\"runtime\":\"rust-service\"")
}
