//! Liste de ce qu'on peut partager (écrans et fenêtres) avec une petite image de chacun,
//! pour le sélecteur de partage d'écran de Tomo. Rien n'est gardé ni envoyé : les miniatures
//! partent seulement vers la fenêtre de Tomo, le temps de choisir.

use base64::Engine;
use serde::Serialize;
use windows_capture::monitor::Monitor;
use windows_capture::window::Window;
use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Dwm::DwmGetWindowAttribute;
use windows_sys::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits, GetMonitorInfoW,
    ReleaseDC, SelectObject, SetStretchBltMode, StretchBlt, BITMAPINFO, MONITORINFO,
};
use windows_sys::Win32::Storage::Xps::PrintWindow;
use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic};

const SRCCOPY: u32 = 0x00CC_0020;
const HALFTONE: i32 = 4;
const DWMWA_CLOAKED: u32 = 14;
/// Rendu complet, y compris les fenêtres dessinées par la carte graphique
const PW_RENDERFULLCONTENT: u32 = 2;
const THUMB_W: i32 = 320;

#[derive(Serialize, Clone)]
pub struct CaptureSource {
    /// « s:… » pour un écran, « w:… » pour une fenêtre
    pub id: String,
    kind: &'static str,
    /// Titre de la fenêtre (vide pour un écran : l'interface écrit « Écran 1 »)
    title: String,
    /// Nom du programme (« chrome.exe »), pour reconnaître le jeu en cours
    program: String,
    /// Numéro de l'écran, à partir de 1
    index: u32,
    width: u32,
    height: u32,
    primary: bool,
    /// Miniature (image BMP en `data:`), absente si elle n'a pas pu être faite
    thumb: Option<String>,
}

enum Shot {
    Screen { x: i32, y: i32 },
    Window(HWND),
}

/// Photo réduite d'un écran ou d'une fenêtre, en BMP 24 bits encodé en base64.
unsafe fn thumbnail(shot: Shot, w: i32, h: i32) -> Option<String> {
    if w <= 0 || h <= 0 {
        return None;
    }
    unsafe {
        let screen = GetDC(std::ptr::null_mut());
        if screen.is_null() {
            return None;
        }
        let full_dc = CreateCompatibleDC(screen);
        let full_bmp = CreateCompatibleBitmap(screen, w, h);
        let old_full = SelectObject(full_dc, full_bmp);
        let ok = match shot {
            Shot::Screen { x, y } => BitBlt(full_dc, 0, 0, w, h, screen, x, y, SRCCOPY) != 0,
            Shot::Window(hwnd) => PrintWindow(hwnd, full_dc, PW_RENDERFULLCONTENT) != 0,
        };

        let tw = THUMB_W.min(w);
        let th = ((h as i64 * tw as i64) / w as i64).clamp(1, 400) as i32;
        let small_dc = CreateCompatibleDC(screen);
        let small_bmp = CreateCompatibleBitmap(screen, tw, th);
        let old_small = SelectObject(small_dc, small_bmp);
        SetStretchBltMode(small_dc, HALFTONE);
        StretchBlt(small_dc, 0, 0, tw, th, full_dc, 0, 0, w, h, SRCCOPY);
        SelectObject(small_dc, old_small);

        let row = ((tw * 3 + 3) & !3) as usize;
        let mut pixels = vec![0u8; row * th as usize];
        let mut info: BITMAPINFO = std::mem::zeroed();
        info.bmiHeader.biSize = 40;
        info.bmiHeader.biWidth = tw;
        info.bmiHeader.biHeight = th; // de bas en haut, comme dans un fichier BMP
        info.bmiHeader.biPlanes = 1;
        info.bmiHeader.biBitCount = 24;
        let lines = GetDIBits(small_dc, small_bmp, 0, th as u32, pixels.as_mut_ptr() as _, &mut info, 0);

        SelectObject(full_dc, old_full);
        DeleteObject(small_bmp);
        DeleteObject(full_bmp);
        DeleteDC(small_dc);
        DeleteDC(full_dc);
        ReleaseDC(std::ptr::null_mut(), screen);
        if !ok || lines == 0 {
            return None;
        }

        let mut file = Vec::with_capacity(54 + pixels.len());
        file.extend_from_slice(b"BM");
        file.extend_from_slice(&(54 + pixels.len() as u32).to_le_bytes());
        file.extend_from_slice(&0u32.to_le_bytes());
        file.extend_from_slice(&54u32.to_le_bytes());
        file.extend_from_slice(&40u32.to_le_bytes());
        file.extend_from_slice(&tw.to_le_bytes());
        file.extend_from_slice(&th.to_le_bytes());
        file.extend_from_slice(&1u16.to_le_bytes());
        file.extend_from_slice(&24u16.to_le_bytes());
        file.extend_from_slice(&[0u8; 24]);
        file.extend_from_slice(&pixels);
        Some(format!("data:image/bmp;base64,{}", base64::engine::general_purpose::STANDARD.encode(file)))
    }
}

/// Écrans puis fenêtres visibles (sans Tomo, sans les fenêtres réduites ou cachées par Windows).
pub fn list(thumbs: bool) -> Vec<CaptureSource> {
    let mut out = Vec::new();

    for (i, m) in Monitor::enumerate().unwrap_or_default().into_iter().enumerate() {
        let hmon = m.as_raw_hmonitor();
        let mut info: MONITORINFO = unsafe { std::mem::zeroed() };
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if unsafe { GetMonitorInfoW(hmon as _, &mut info) } == 0 {
            continue;
        }
        let r = info.rcMonitor;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        out.push(CaptureSource {
            id: format!("s:{}", hmon as usize),
            kind: "screen",
            title: String::new(),
            program: String::new(),
            index: i as u32 + 1,
            width: w.max(0) as u32,
            height: h.max(0) as u32,
            primary: info.dwFlags & 1 != 0,
            thumb: if thumbs { unsafe { thumbnail(Shot::Screen { x: r.left, y: r.top }, w, h) } } else { None },
        });
    }

    let me = std::process::id();
    // Ni cette fenêtre, ni un autre Tomo ouvert à côté (appli installée + version de dev)
    let my_exe = std::env::current_exe().ok().and_then(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()));
    for win in Window::enumerate().unwrap_or_default() {
        let hwnd = win.as_raw_hwnd() as HWND;
        if win.process_id().map(|p| p == me).unwrap_or(true) {
            continue;
        }
        let program = win.process_name().unwrap_or_default();
        if my_exe.as_deref() == Some(program.to_lowercase().as_str()) {
            continue;
        }
        let title = win.title().unwrap_or_default();
        if title.trim().is_empty() || title == "Program Manager" {
            continue;
        }
        let mut cloaked = 0u32;
        let mut rect: RECT = unsafe { std::mem::zeroed() };
        unsafe {
            DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut cloaked as *mut u32 as _, 4);
            if cloaked != 0 || IsIconic(hwnd) != 0 || GetWindowRect(hwnd, &mut rect) == 0 {
                continue;
            }
        }
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w < 40 || h < 40 {
            continue;
        }
        out.push(CaptureSource {
            id: format!("w:{}", hwnd as usize),
            kind: "window",
            title,
            program,
            index: 0,
            width: w as u32,
            height: h as u32,
            primary: false,
            thumb: if thumbs { unsafe { thumbnail(Shot::Window(hwnd), w, h) } } else { None },
        });
    }
    out
}
