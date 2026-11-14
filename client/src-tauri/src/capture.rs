//! Capture d'écran maison — ESSAI TECHNIQUE (pas encore branché sur le partage d'écran).
//!
//! But : remplacer la fenêtre « Choisir les éléments à partager » de WebView2 par notre propre
//! sélecteur. Pour ça il faut capturer nous-mêmes : la capture intégrée à Windows (Windows
//! Graphics Capture) donne les images, qu'on recopie dans une **mémoire partagée** avec la page
//! (`CreateSharedBuffer` de WebView2) : rien ne passe par le réseau ni par du JSON.
//!
//! Mémoire partagée : 64 octets d'en-tête (entiers 32 bits) puis les pixels BGRA sans marge.
//!   [0] numéro de l'image écrite (Rust)   [1] numéro de la dernière image lue (page)
//!   [2] largeur   [3] hauteur
//! Rust n'écrit une nouvelle image que si la page a lu la précédente ([0] == [1]) : jamais
//! d'image à moitié écrite, et si la page rame on saute des images au lieu d'empiler.

use serde::Serialize;

#[derive(Serialize, Clone, Default)]
pub struct CaptureStats {
    /// Images données par Windows
    captured: u64,
    /// Images recopiées et signalées à la page
    sent: u64,
    /// Images sautées parce que la page n'avait pas fini de lire la précédente
    dropped_busy: u64,
    /// Images sautées pour tenir le rythme demandé (écran plus rapide que le partage)
    skipped_pace: u64,
    /// Temps moyen pour récupérer + recopier une image (microsecondes)
    copy_us_avg: u64,
    width: u32,
    height: u32,
}

#[cfg(windows)]
#[path = "capture_sources.rs"]
mod sources;

#[cfg(windows)]
mod win {
    use super::CaptureStats;
    use std::sync::atomic::{AtomicU32, Ordering};
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter, WebviewWindow};
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2Environment12, ICoreWebView2SharedBuffer, ICoreWebView2_17,
        COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
    };
    use windows_capture::capture::{CaptureControl, Context, GraphicsCaptureApiHandler};
    use windows_capture::frame::Frame;
    use windows_capture::graphics_capture_api::InternalCaptureControl;
    use windows_capture::monitor::Monitor;
    use windows_capture::window::Window;
    use windows_capture::settings::{
        ColorFormat, CursorCaptureSettings, DirtyRegionSettings, DrawBorderSettings,
        MinimumUpdateIntervalSettings, SecondaryWindowSettings, Settings,
    };
    use windows_core::{Interface, HSTRING};

    const HEADER: usize = 64;
    /// Assez pour un écran 4K (3840 × 2160 × 4 octets)
    const CAP: usize = HEADER + 3840 * 2160 * 4;

    type AnyError = Box<dyn std::error::Error + Send + Sync>;

    /// La mémoire partagée est créée une fois et gardée jusqu'à la fermeture de l'appli.
    struct SharedBuf(ICoreWebView2SharedBuffer);
    // Objet WebView2 : créé et utilisé seulement sur le fil principal (dans `with_webview`).
    unsafe impl Send for SharedBuf {}
    static BUF: Mutex<Option<SharedBuf>> = Mutex::new(None);

    struct Session {
        control: CaptureControl<Handler, AnyError>,
        stats: Arc<Mutex<CaptureStats>>,
    }
    static SESSION: Mutex<Option<Session>> = Mutex::new(None);

    struct Flags {
        ptr: usize,
        fps: u32,
        app: AppHandle,
        stats: Arc<Mutex<CaptureStats>>,
    }

    struct Handler {
        f: Flags,
        next_due: Instant,
        copy_us: u64,
        local: CaptureStats,
    }

    impl GraphicsCaptureApiHandler for Handler {
        type Flags = Flags;
        type Error = AnyError;

        fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
            Ok(Self { f: ctx.flags, next_due: Instant::now(), copy_us: 0, local: CaptureStats::default() })
        }

        fn on_frame_arrived(&mut self, frame: &mut Frame, _c: InternalCaptureControl) -> Result<(), Self::Error> {
            let now = Instant::now();
            self.local.captured += 1;

            // Rythme : un écran 144 Hz donne 144 images/s, on n'en garde que `fps`.
            let interval = Duration::from_micros(1_000_000 / self.f.fps.max(1) as u64);
            if now + Duration::from_millis(3) < self.next_due {
                self.local.skipped_pace += 1;
                return self.publish();
            }
            self.next_due += interval;
            if self.next_due + interval < now {
                self.next_due = now;
            }

            let hdr = self.f.ptr as *const AtomicU32;
            // SAFETY : `ptr` pointe sur la mémoire partagée (CAP octets), vivante jusqu'à la fin de l'appli.
            let (seq, ack) = unsafe { ((*hdr).load(Ordering::Acquire), (*hdr.add(1)).load(Ordering::Acquire)) };
            if seq != ack {
                self.local.dropped_busy += 1;
                return self.publish();
            }

            let mut buf = frame.buffer()?;
            let (w, h, pitch) = (buf.width() as usize, buf.height() as usize, buf.row_pitch() as usize);
            let len = w * h * 4;
            if HEADER + len > CAP {
                return self.publish();
            }
            let src = buf.as_raw_buffer();
            // SAFETY : même mémoire ; la page ne lit pas tant que [0] n'a pas changé.
            let dst = unsafe { std::slice::from_raw_parts_mut((self.f.ptr + HEADER) as *mut u8, len) };
            if pitch == w * 4 {
                dst.copy_from_slice(&src[..len]);
            } else {
                for y in 0..h {
                    dst[y * w * 4..(y + 1) * w * 4].copy_from_slice(&src[y * pitch..y * pitch + w * 4]);
                }
            }
            unsafe {
                (*hdr.add(2)).store(w as u32, Ordering::Release);
                (*hdr.add(3)).store(h as u32, Ordering::Release);
                (*hdr).store(seq.wrapping_add(1), Ordering::Release);
            }
            let _ = self.f.app.emit_to("main", "capture:frame", seq.wrapping_add(1));

            self.local.sent += 1;
            self.local.width = w as u32;
            self.local.height = h as u32;
            self.copy_us += now.elapsed().as_micros() as u64;
            self.local.copy_us_avg = self.copy_us / self.local.sent;
            self.publish()
        }

        /// La fenêtre partagée a été fermée : la page arrête le partage.
        fn on_closed(&mut self) -> Result<(), Self::Error> {
            let _ = self.f.app.emit_to("main", "capture:closed", ());
            Ok(())
        }
    }

    impl Handler {
        fn publish(&self) -> Result<(), AnyError> {
            if let Ok(mut s) = self.f.stats.lock() {
                *s = self.local.clone();
            }
            Ok(())
        }
    }

    /// Crée la mémoire partagée (une fois) et la donne à la page. Renvoie son adresse.
    fn post_buffer(window: &WebviewWindow) -> Result<usize, String> {
        let (tx, rx) = mpsc::channel();
        window
            .with_webview(move |wv| {
                let r = (|| -> windows_core::Result<usize> {
                    unsafe {
                        let mut guard = BUF.lock().unwrap();
                        if guard.is_none() {
                            let env: ICoreWebView2Environment12 = wv.environment().cast()?;
                            *guard = Some(SharedBuf(env.CreateSharedBuffer(CAP as u64)?));
                        }
                        let b = &guard.as_ref().unwrap().0;
                        let mut p = std::ptr::null_mut();
                        b.Buffer(&mut p)?;
                        // Nouvelle capture : on repart de zéro (la page a pu être rechargée entre-temps)
                        let hdr = p as *const AtomicU32;
                        (*hdr).store(0, Ordering::Release);
                        (*hdr.add(1)).store(0, Ordering::Release);
                        let core: ICoreWebView2_17 = wv.controller().CoreWebView2()?.cast()?;
                        core.PostSharedBufferToScript(
                            b,
                            COREWEBVIEW2_SHARED_BUFFER_ACCESS_READ_WRITE,
                            &HSTRING::from("{\"tomo\":\"capture\"}"),
                        )?;
                        Ok(p as usize)
                    }
                })();
                let _ = tx.send(r.map_err(|e| e.to_string()));
            })
            .map_err(|e| e.to_string())?;
        rx.recv_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?
    }

    fn settings<T: TryInto<windows_capture::settings::GraphicsCaptureItemType>>(item: T, flags: Flags) -> Settings<Flags, T> {
        Settings::new(
            item,
            CursorCaptureSettings::Default,
            DrawBorderSettings::Default,
            SecondaryWindowSettings::Default,
            MinimumUpdateIntervalSettings::Default,
            DirtyRegionSettings::Default,
            ColorFormat::Bgra8,
            flags,
        )
    }

    pub fn start(window: WebviewWindow, app: AppHandle, source: String, fps: u32) -> Result<(), String> {
        stop();
        // On ne capture que ce qui figure dans la liste proposée (pas une adresse inventée)
        let known = super::sources::list(false);
        if !known.iter().any(|s| s.id == source) {
            return Err("source introuvable".into());
        }
        let ptr = post_buffer(&window)?;
        let stats = Arc::new(Mutex::new(CaptureStats::default()));
        let flags = Flags { ptr, fps: fps.clamp(1, 240), app, stats: stats.clone() };
        let (kind, raw) = source.split_once(':').ok_or("source invalide")?;
        let handle = raw.parse::<usize>().map_err(|_| "source invalide")?;
        let control = match kind {
            "s" => Handler::start_free_threaded(settings(Monitor::from_raw_hmonitor(handle as _), flags)),
            "w" => Handler::start_free_threaded(settings(Window::from_raw_hwnd(handle as _), flags)),
            _ => return Err("source invalide".into()),
        }
        .map_err(|e| e.to_string())?;
        *SESSION.lock().unwrap() = Some(Session { control, stats });
        Ok(())
    }

    pub fn stop() -> CaptureStats {
        let Some(s) = SESSION.lock().unwrap().take() else { return CaptureStats::default() };
        let stats = s.stats.lock().map(|g| g.clone()).unwrap_or_default();
        let _ = s.control.stop();
        stats
    }

    pub fn stats() -> CaptureStats {
        SESSION.lock().unwrap().as_ref().and_then(|s| s.stats.lock().ok().map(|g| g.clone())).unwrap_or_default()
    }
}

/// Démarre la capture d'un écran ou d'une fenêtre de la liste (`capture_sources`).
#[tauri::command]
pub async fn capture_start(window: tauri::WebviewWindow, app: tauri::AppHandle, source: String, fps: u32) -> Result<(), String> {
    #[cfg(windows)]
    {
        win::start(window, app, source, fps)
    }
    #[cfg(not(windows))]
    {
        let _ = (window, app, source, fps);
        Err("capture maison : Windows seulement".into())
    }
}

/// Ce qu'on peut partager : écrans et fenêtres, avec une miniature de chacun.
#[cfg(windows)]
#[tauri::command]
pub async fn capture_sources() -> Vec<sources::CaptureSource> {
    sources::list(true)
}

#[cfg(not(windows))]
#[tauri::command]
pub async fn capture_sources() -> Vec<()> {
    Vec::new()
}

#[tauri::command]
pub async fn capture_stop() -> CaptureStats {
    #[cfg(windows)]
    {
        win::stop()
    }
    #[cfg(not(windows))]
    {
        CaptureStats::default()
    }
}

#[tauri::command]
pub fn capture_stats() -> CaptureStats {
    #[cfg(windows)]
    {
        win::stats()
    }
    #[cfg(not(windows))]
    {
        CaptureStats::default()
    }
}

// ---------- Banc d'essai (dev seulement) ----------

/// Temps processeur cumulé (ms) de Tomo et de ses processus WebView2, pour mesurer le coût.
#[tauri::command]
pub fn capture_cpu_ms() -> u64 {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cpu().with_cmd(UpdateKind::Always),
    );
    let me = std::process::id();
    sys.processes()
        .values()
        .filter(|p| {
            p.pid().as_u32() == me
                || p.cmd().iter().any(|a| a.to_string_lossy().contains("--webview-exe-name=tomo.exe"))
        })
        .map(|p| p.accumulated_cpu_time())
        .sum()
}

fn spike_file(ext: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("tomo-capture-spike.{ext}"))
}

/// Y a-t-il une demande d'essai ? (fichier déposé à la main ; lu une seule fois)
#[tauri::command]
pub fn capture_spike_poll() -> Option<String> {
    if !cfg!(debug_assertions) {
        return None;
    }
    let path = spike_file("go");
    let text = std::fs::read_to_string(&path).ok()?;
    let _ = std::fs::remove_file(&path);
    Some(text)
}

#[tauri::command]
pub fn capture_spike_report(json: String) {
    if cfg!(debug_assertions) {
        let _ = std::fs::write(spike_file("json"), json);
    }
}
