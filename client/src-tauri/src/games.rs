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

/// Nom du programme dont la fenêtre est au premier plan (en minuscules), pour n'afficher
/// l'overlay que par-dessus le jeu. `None` si on ne sait pas le dire (hors Windows).
#[tauri::command]
pub fn foreground_program() -> Option<String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        let mut pid: u32 = 0;
        // SAFETY : appels Windows sans effet de bord ; pid est une variable locale valide.
        unsafe {
            let hwnd = GetForegroundWindow();
            if hwnd.is_null() {
                return Some(String::new());
            }
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if pid == 0 {
            return Some(String::new());
        }
        let pid = sysinfo::Pid::from_u32(pid);
        let mut guard = SYS.lock().unwrap_or_else(|e| e.into_inner());
        let sys = guard.get_or_insert_with(|| {
            System::new_with_specifics(RefreshKind::nothing().with_processes(ProcessRefreshKind::nothing()))
        });
        sys.refresh_processes_specifics(ProcessesToUpdate::Some(&[pid]), true, ProcessRefreshKind::nothing());
        Some(sys.process(pid).map(|p| p.name().to_string_lossy().to_lowercase()).unwrap_or_default())
    }
    #[cfg(not(windows))]
    {
        None
    }
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

    #[test]
    fn lit_la_fenetre_au_premier_plan_sans_planter() {
        let fg = super::foreground_program();
        if let Some(name) = fg {
            assert_eq!(name, name.to_lowercase());
        }
    }
}
