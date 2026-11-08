//! Partie native de tomo.
//!
//! Le jeton de session « rester connecté » est rangé dans le coffre-fort du système
//! (Gestionnaire d'identification Windows, Trousseau macOS, Secret Service Linux),
//! jamais dans un fichier lisible par d'autres programmes.

mod clips;
mod mumble;

const SERVICE: &str = "com.tomo.app";

/// Seules ces clés peuvent être lues/écrites depuis l'interface.
fn check_key(key: &str) -> Result<(), String> {
    if key.starts_with("session:") && key.len() <= 200 {
        Ok(())
    } else {
        Err("clé non autorisée".into())
    }
}

#[tauri::command]
fn secret_get(key: String) -> Result<Option<String>, String> {
    check_key(&key)?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    check_key(&key)?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    entry.set_password(&value).map_err(|e| e.to_string())
}

#[tauri::command]
fn secret_delete(key: String) -> Result<(), String> {
    check_key(&key)?;
    let entry = keyring::Entry::new(SERVICE, &key).map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// tomo a-t-il été lancé automatiquement au démarrage de l'ordinateur ?
/// (l'appli peut alors se réduire toute seule si l'option « Démarrer réduit » est cochée)
#[tauri::command]
fn launched_at_login() -> bool {
    std::env::args().any(|a| a == "--autostart")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        // Mise à jour automatique depuis les Releases GitHub (fichiers signés)
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--autostart"]),
        ))
        .setup(|app| {
            // Position du joueur dans son jeu (Mumble Link) pour l'audio spatial
            mumble::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            launched_at_login,
            secret_get,
            secret_set,
            secret_delete,
            clips::save_clip,
            clips::list_clips,
            clips::read_clip,
            clips::delete_clip,
            clips::open_clips_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
