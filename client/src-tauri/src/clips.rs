//! Clips audio : enregistrés dans le dossier Musique\tomo Clips de l'utilisateur.

use serde::Serialize;
use std::fs;
use std::path::PathBuf;
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};
use tauri_plugin_opener::OpenerExt;

const MAX_CLIP_BYTES: usize = 64 * 1024 * 1024;

fn clips_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .audio_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| e.to_string())?;
    let dir = base.join("tomo Clips");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

/// Nom de fichier sûr : lettres, chiffres, espace, - _ . et extension .wav (pas de chemin).
fn safe_name(name: &str) -> Result<String, String> {
    let ok = !name.is_empty()
        && name.len() <= 120
        && name.ends_with(".wav")
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || " -_.".contains(c));
    if ok {
        Ok(name.to_string())
    } else {
        Err("nom de clip invalide".into())
    }
}

#[tauri::command]
pub fn save_clip(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(data) = request.body() else {
        return Err("données attendues en binaire".into());
    };
    if data.len() > MAX_CLIP_BYTES || data.len() < 44 || &data[0..4] != b"RIFF" {
        return Err("fichier audio invalide".into());
    }
    let name = request
        .headers()
        .get("x-clip-name")
        .and_then(|v| v.to_str().ok())
        .ok_or("nom manquant")?;
    let path = clips_dir(&app)?.join(safe_name(name)?);
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[derive(Serialize)]
pub struct ClipFile {
    name: String,
    size: u64,
    modified: u64,
}

#[tauri::command]
pub fn list_clips(app: AppHandle) -> Result<Vec<ClipFile>, String> {
    let mut clips: Vec<ClipFile> = fs::read_dir(clips_dir(&app)?)
        .map_err(|e| e.to_string())?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            if !name.ends_with(".wav") {
                return None;
            }
            let meta = e.metadata().ok()?;
            let modified = meta
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_millis() as u64;
            Some(ClipFile { name, size: meta.len(), modified })
        })
        .collect();
    clips.sort_by(|a, b| b.modified.cmp(&a.modified));
    Ok(clips)
}

#[tauri::command]
pub fn read_clip(app: AppHandle, name: String) -> Result<Response, String> {
    let bytes = fs::read(clips_dir(&app)?.join(safe_name(&name)?)).map_err(|e| e.to_string())?;
    Ok(Response::new(bytes))
}

#[tauri::command]
pub fn delete_clip(app: AppHandle, name: String) -> Result<(), String> {
    fs::remove_file(clips_dir(&app)?.join(safe_name(&name)?)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_clips_folder(app: AppHandle) -> Result<(), String> {
    let dir = clips_dir(&app)?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}
