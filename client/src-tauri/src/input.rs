//! Raccourcis qui marchent en jeu (push-to-talk, couper le micro, clip…).
//!
//! On lit l'état des touches (enfoncée ou non) à intervalle régulier, sans « crochet » clavier :
//! la touche n'est jamais bloquée, le jeu la reçoit normalement.
//!
//! Vie privée : on ne surveille QUE les touches utilisées par les raccourcis de la personne
//! (liste envoyée par l'interface). La seule exception est l'enregistrement d'un nouveau
//! raccourci dans les Paramètres, demandé par un clic, qui s'arrête tout seul après 15 s.
//! Rien n'est écrit ni envoyé ailleurs : l'état sert seulement à déclencher les actions.

use std::collections::BTreeSet;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// Une touche : son nom côté interface (« Ctrl », « M », « Souris 4 » = "Mouse4") et son code système.
#[derive(Clone)]
struct Key {
    name: String,
    code: u32,
    mouse: bool,
}

struct State {
    watched: Vec<Key>,
    record_until: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State { watched: Vec::new(), record_until: None });
static GENERATION: AtomicU64 = AtomicU64::new(0);

fn table() -> &'static Vec<Key> {
    static TABLE: OnceLock<Vec<Key>> = OnceLock::new();
    TABLE.get_or_init(platform::keys)
}

/// Touches à surveiller (noms des raccourcis). Liste vide = on ne surveille plus rien.
#[tauri::command]
pub fn input_set_keys(keys: Vec<String>) {
    let wanted: BTreeSet<String> = keys.into_iter().collect();
    let watched = table().iter().filter(|k| wanted.contains(&k.name)).cloned().collect();
    let mut s = STATE.lock().unwrap_or_else(|e| e.into_inner());
    s.watched = watched;
    GENERATION.fetch_add(1, Ordering::Relaxed);
}

/// Enregistrement d'un raccourci (Paramètres) : toutes les touches, 15 s au maximum.
#[tauri::command]
pub fn input_record(on: bool) {
    let mut s = STATE.lock().unwrap_or_else(|e| e.into_inner());
    s.record_until = if on { Some(Instant::now() + Duration::from_secs(15)) } else { None };
    GENERATION.fetch_add(1, Ordering::Relaxed);
}

/// macOS : autorisation « Surveillance de l'entrée » (demandée une fois). Ailleurs : toujours vrai.
#[tauri::command]
pub fn input_permission(ask: bool) -> bool {
    platform::permission(ask)
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Vec<String> = Vec::new();
        let mut last_gen = u64::MAX;
        loop {
            let (keys, idle) = {
                let mut s = STATE.lock().unwrap_or_else(|e| e.into_inner());
                if s.record_until.is_some_and(|t| Instant::now() > t) {
                    s.record_until = None;
                }
                if s.record_until.is_some() {
                    (table().clone(), false)
                } else {
                    let idle = s.watched.is_empty();
                    (s.watched.clone(), idle)
                }
            };
            let generation = GENERATION.load(Ordering::Relaxed);
            if idle {
                if !last.is_empty() {
                    last.clear();
                    let _ = app.emit_to("main", "input:keys", &last);
                }
                last_gen = generation;
                std::thread::sleep(Duration::from_millis(100));
                continue;
            }
            let mut pressed: Vec<String> = keys.iter().filter(|k| platform::is_down(k)).map(|k| k.name.clone()).collect();
            pressed.sort();
            pressed.dedup();
            if pressed != last || generation != last_gen {
                let _ = app.emit_to("main", "input:keys", &pressed);
                last = pressed;
                last_gen = generation;
            }
            std::thread::sleep(Duration::from_millis(8));
        }
    });
}

fn key(name: &str, code: u32) -> Key {
    Key { name: name.to_string(), code, mouse: false }
}
fn mouse(name: &str, code: u32) -> Key {
    Key { name: name.to_string(), code, mouse: true }
}

#[cfg(windows)]
mod platform {
    use super::{Key, key, mouse};
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, MAPVK_VK_TO_CHAR, MapVirtualKeyW};

    pub fn keys() -> Vec<Key> {
        let mut v = vec![
            mouse("Mouse3", 0x04),
            mouse("Mouse4", 0x05),
            mouse("Mouse5", 0x06),
            key("Ctrl", 0x11),
            key("Shift", 0x10),
            key("Alt", 0x12),
            key("Meta", 0x5B),
            key("Meta", 0x5C),
            key("Space", 0x20),
            key("Enter", 0x0D),
            key("Tab", 0x09),
            key("Escape", 0x1B),
            key("Backspace", 0x08),
            key("CapsLock", 0x14),
            key("Left", 0x25),
            key("Up", 0x26),
            key("Right", 0x27),
            key("Down", 0x28),
            key("Insert", 0x2D),
            key("Delete", 0x2E),
            key("Home", 0x24),
            key("End", 0x23),
            key("PageUp", 0x21),
            key("PageDown", 0x22),
            key("Num*", 0x6A),
            key("Num+", 0x6B),
            key("Num-", 0x6D),
            key("Num.", 0x6E),
            key("Num/", 0x6F),
        ];
        for d in 0..10u32 {
            v.push(key(&d.to_string(), 0x30 + d));
            v.push(key(&format!("Num{d}"), 0x60 + d));
        }
        for c in b'A'..=b'Z' {
            v.push(key(&(c as char).to_string(), c as u32));
        }
        for f in 1..=24u32 {
            v.push(key(&format!("F{f}"), 0x6F + f));
        }
        // Touches de ponctuation : leur caractère dépend de la disposition du clavier (AZERTY…)
        for vk in [0xBA, 0xBB, 0xBC, 0xBD, 0xBE, 0xBF, 0xC0, 0xDB, 0xDC, 0xDD, 0xDE, 0xDF, 0xE2u32] {
            let ch = unsafe { MapVirtualKeyW(vk, MAPVK_VK_TO_CHAR) } & 0xFFFF;
            if let Some(c) = char::from_u32(ch).filter(|c| !c.is_control()) {
                v.push(key(&c.to_uppercase().to_string(), vk));
            }
        }
        v
    }

    pub fn is_down(k: &Key) -> bool {
        let _ = k.mouse;
        (unsafe { GetAsyncKeyState(k.code as i32) } as u16 & 0x8000) != 0
    }

    pub fn permission(_ask: bool) -> bool {
        true
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{Key, key, mouse};

    // CoreGraphics (framework ApplicationServices) : état des touches tel que vu par le système.
    #[link(name = "ApplicationServices", kind = "framework")]
    unsafe extern "C" {
        fn CGEventSourceKeyState(state: i32, key: u16) -> bool;
        fn CGEventSourceButtonState(state: i32, button: u32) -> bool;
        fn CGPreflightListenEventAccess() -> bool;
        fn CGRequestListenEventAccess() -> bool;
    }
    const HID: i32 = 1; // kCGEventSourceStateHIDSystemState

    pub fn keys() -> Vec<Key> {
        // Codes physiques (position des touches sur un clavier QWERTY américain)
        let named: &[(&str, u32)] = &[
            ("A", 0), ("S", 1), ("D", 2), ("F", 3), ("H", 4), ("G", 5), ("Z", 6), ("X", 7), ("C", 8), ("V", 9),
            ("B", 11), ("Q", 12), ("W", 13), ("E", 14), ("R", 15), ("Y", 16), ("T", 17), ("1", 18), ("2", 19),
            ("3", 20), ("4", 21), ("6", 22), ("5", 23), ("=", 24), ("9", 25), ("7", 26), ("-", 27), ("8", 28),
            ("0", 29), ("]", 30), ("O", 31), ("U", 32), ("[", 33), ("I", 34), ("P", 35), ("Enter", 36), ("L", 37),
            ("J", 38), ("'", 39), ("K", 40), (";", 41), ("\\", 42), (",", 43), ("/", 44), ("N", 45), ("M", 46),
            (".", 47), ("Tab", 48), ("Space", 49), ("`", 50), ("Backspace", 51), ("Escape", 53),
            ("Meta", 55), ("Meta", 54), ("Shift", 56), ("Shift", 60), ("CapsLock", 57), ("Alt", 58), ("Alt", 61),
            ("Ctrl", 59), ("Ctrl", 62), ("F1", 122), ("F2", 120), ("F3", 99), ("F4", 118), ("F5", 96), ("F6", 97),
            ("F7", 98), ("F8", 100), ("F9", 101), ("F10", 109), ("F11", 103), ("F12", 111), ("Left", 123),
            ("Right", 124), ("Down", 125), ("Up", 126), ("Home", 115), ("End", 119), ("PageUp", 116),
            ("PageDown", 121), ("Delete", 117), ("Num0", 82), ("Num1", 83), ("Num2", 84), ("Num3", 85),
            ("Num4", 86), ("Num5", 87), ("Num6", 88), ("Num7", 89), ("Num8", 91), ("Num9", 92),
        ];
        let mut v: Vec<Key> = named.iter().map(|(n, c)| key(n, *c)).collect();
        v.push(mouse("Mouse3", 2));
        v.push(mouse("Mouse4", 3));
        v.push(mouse("Mouse5", 4));
        v
    }

    pub fn is_down(k: &Key) -> bool {
        unsafe {
            if k.mouse {
                CGEventSourceButtonState(HID, k.code)
            } else {
                CGEventSourceKeyState(HID, k.code as u16)
            }
        }
    }

    pub fn permission(ask: bool) -> bool {
        unsafe {
            if CGPreflightListenEventAccess() {
                return true;
            }
            if ask {
                CGRequestListenEventAccess()
            } else {
                false
            }
        }
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
mod platform {
    use super::Key;
    pub fn keys() -> Vec<Key> {
        Vec::new()
    }
    pub fn is_down(_k: &Key) -> bool {
        false
    }
    pub fn permission(_ask: bool) -> bool {
        false
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn table_des_touches() {
        let t = super::table();
        #[cfg(any(windows, target_os = "macos"))]
        for name in ["Ctrl", "Shift", "Alt", "M", "C", "1", "F1", "Space", "Mouse4", "Mouse5"] {
            assert!(t.iter().any(|k| k.name == name), "{name} absent");
        }
        let _ = t;
    }

    #[test]
    fn surveillance_limitee() {
        super::input_set_keys(vec!["Ctrl".into(), "M".into(), "inconnue".into()]);
        let s = super::STATE.lock().unwrap();
        assert!(s.watched.iter().all(|k| k.name == "Ctrl" || k.name == "M"));
        drop(s);
        super::input_set_keys(vec![]);
        assert!(super::STATE.lock().unwrap().watched.is_empty());
    }
}
