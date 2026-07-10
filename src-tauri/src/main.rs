// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "tauri")]
fn main() {
    seaquel_lib::run()
}

#[cfg(not(feature = "tauri"))]
fn main() {
    panic!("This binary requires the 'tauri' feature. Use seaquel-server for the web server.");
}
