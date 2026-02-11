mod scoreboard;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scoreboard::fetch_global_scores,
            scoreboard::submit_global_score
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
