//! Connecteur de jeu « Mumble Link ».
//!
//! Beaucoup de jeux (ou leurs mods) écrivent la position du joueur dans une mémoire
//! partagée Windows nommée `MumbleLink` (format historique de Mumble). Tomo la lit
//! 20 fois par seconde et envoie l'événement `mumble-link` à l'interface.
//! Lecture seule : Tomo ne modifie jamais le jeu.

use serde::Serialize;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone, PartialEq)]
pub struct GameLink {
    active: bool,
    game: String,
    identity: String,
    context: String,
    pos: [f32; 3],
    front: [f32; 3],
}

impl GameLink {
    fn inactive() -> Self {
        GameLink { active: false, game: String::new(), identity: String::new(), context: String::new(), pos: [0.0; 3], front: [0.0; 3] }
    }
}

/// Lance la surveillance en arrière-plan.
pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_tick: Option<u32> = None;
        let mut last_change = Instant::now();
        let mut active = false;
        loop {
            std::thread::sleep(Duration::from_millis(50));
            match imp::read() {
                Some((tick, link)) => {
                    if last_tick != Some(tick) {
                        last_tick = Some(tick);
                        last_change = Instant::now();
                        active = true;
                        let _ = app.emit("mumble-link", link);
                    } else if active && last_change.elapsed() > Duration::from_secs(2) {
                        // Le jeu n'écrit plus (fermé, en pause, menu) : on repasse sur la carte.
                        active = false;
                        let _ = app.emit("mumble-link", GameLink::inactive());
                    }
                }
                None => {
                    if active {
                        active = false;
                        last_tick = None;
                        let _ = app.emit("mumble-link", GameLink::inactive());
                    }
                }
            }
        }
    });
}

#[cfg(windows)]
pub mod imp {
    use super::GameLink;
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Memory::{MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ};

    /// Structure officielle de Mumble Link (LinkedMem).
    #[repr(C)]
    pub struct LinkedMem {
        pub ui_version: u32,
        pub ui_tick: u32,
        pub avatar_position: [f32; 3],
        pub avatar_front: [f32; 3],
        pub avatar_top: [f32; 3],
        pub name: [u16; 256],
        pub camera_position: [f32; 3],
        pub camera_front: [f32; 3],
        pub camera_top: [f32; 3],
        pub identity: [u16; 256],
        pub context_len: u32,
        pub context: [u8; 256],
        pub description: [u16; 2048],
    }

    fn wide(s: &[u16]) -> String {
        let end = s.iter().position(|&c| c == 0).unwrap_or(s.len());
        String::from_utf16_lossy(&s[..end])
    }

    pub fn read() -> Option<(u32, GameLink)> {
        let name: Vec<u16> = "MumbleLink\0".encode_utf16().collect();
        unsafe {
            let handle = OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr());
            if handle.is_null() {
                return None;
            }
            let view = MapViewOfFile(handle, FILE_MAP_READ, 0, 0, std::mem::size_of::<LinkedMem>());
            if view.Value.is_null() {
                CloseHandle(handle);
                return None;
            }
            let mem = &*(view.Value as *const LinkedMem);
            let result = if mem.ui_version == 0 {
                None
            } else {
                let ctx_len = (mem.context_len as usize).min(256);
                let context: String = mem.context[..ctx_len].iter().map(|b| format!("{b:02x}")).collect();
                Some((
                    mem.ui_tick,
                    GameLink {
                        active: true,
                        game: wide(&mem.name),
                        identity: wide(&mem.identity),
                        context,
                        pos: mem.avatar_position,
                        front: mem.avatar_front,
                    },
                ))
            };
            UnmapViewOfFile(view);
            CloseHandle(handle);
            result
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::imp::{read, LinkedMem};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Memory::{CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, FILE_MAP_ALL_ACCESS, PAGE_READWRITE};

    #[test]
    fn lit_la_position_ecrite_par_un_jeu() {
        let name: Vec<u16> = "MumbleLink\0".encode_utf16().collect();
        let size = std::mem::size_of::<LinkedMem>();
        unsafe {
            // Un « jeu » crée la mémoire et écrit une position
            let h = CreateFileMappingW(INVALID_HANDLE_VALUE, std::ptr::null(), PAGE_READWRITE, 0, size as u32, name.as_ptr());
            assert!(!h.is_null());
            let view = MapViewOfFile(h, FILE_MAP_ALL_ACCESS, 0, 0, size);
            let mem = &mut *(view.Value as *mut LinkedMem);
            mem.ui_version = 2;
            mem.ui_tick = 42;
            mem.avatar_position = [12.5, 64.0, -3.25];
            mem.avatar_front = [0.0, 0.0, 1.0];
            for (i, c) in "Minecraft".encode_utf16().enumerate() {
                mem.name[i] = c;
            }
            mem.context[..3].copy_from_slice(b"abc");
            mem.context_len = 3;

            // Tomo la lit
            let (tick, link) = read().expect("Mumble Link devrait être lu");
            assert_eq!(tick, 42);
            assert!(link.active);
            assert_eq!(link.game, "Minecraft");
            assert_eq!(link.pos, [12.5, 64.0, -3.25]);
            assert_eq!(link.context, "616263");

            UnmapViewOfFile(view);
            CloseHandle(h);
        }
        // Plus aucun jeu : rien à lire
        assert!(read().is_none());
    }
}

#[cfg(not(windows))]
pub mod imp {
    use super::GameLink;
    pub fn read() -> Option<(u32, GameLink)> {
        None
    }
}
