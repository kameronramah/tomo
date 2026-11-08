//! Partie native de Tomo.
//!
//! Le jeton de session « rester connecté » est rangé dans le coffre-fort du système
//! (Gestionnaire d'identification Windows, Trousseau macOS, Secret Service Linux),
//! jamais dans un fichier lisible par d'autres programmes.

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![secret_get, secret_set, secret_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
