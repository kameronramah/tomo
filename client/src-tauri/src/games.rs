//! Détection des jeux lancés : on lit seulement la liste des noms de programmes ouverts
//! (rien d'autre : ni fenêtres, ni fichiers, ni mémoire des jeux). La reconnaissance
//! (quel .exe = quel jeu) se fait côté interface.

use std::sync::Mutex;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, RefreshKind, System};

static SYS: Mutex<Option<System>> = Mutex::new(None);

/// Noms des programmes en cours (en minuscules, sans doublon).
#[tauri::command]
pub fn running_programs() -> Vec<String> {
    let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
    let sys = guard.get_or_insert_with(|| {
        System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()))
    });
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    let mut names: Vec<String> = sys
        .processes()
        .values()
        .map(|p| p.name().to_string_lossy().to_lowercase())
        .collect();
    names.sort();
    names.dedup();
    names
}

#[cfg(test)]
mod tests {
    #[test]
    fn voit_les_programmes_ouverts() {
        let list = super::running_programs();
        assert!(list.len() > 5, "liste trop courte : {list:?}");
        assert!(list.iter().all(|n| *n == n.to_lowercase()));
        // le programme de test lui-même doit apparaître
        let me = std::env::current_exe().unwrap().file_name().unwrap().to_string_lossy().to_lowercase();
        assert!(list.contains(&me), "{me} absent");
    }
}
