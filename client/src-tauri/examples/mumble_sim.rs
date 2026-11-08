//! Simulateur Mumble Link : fait croire à Tomo qu'un jeu compatible tourne.
//! Le « joueur » marche en rond (rayon 10 m) pendant que le programme tourne.
//!
//!   cargo run --example mumble_sim            (Ctrl+C pour arrêter)
//!   cargo run --example mumble_sim -- 5 3     (centre décalé de x=5, z=3)
//!
//! Lance-le sur deux PC avec le même salon en audio spatial : chacun « voit » l'autre
//! bouger sur la carte, et la voix tourne autour de toi.

#[cfg(windows)]
fn main() {
    use std::time::{Duration, Instant};
    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Memory::{CreateFileMappingW, MapViewOfFile, FILE_MAP_ALL_ACCESS, PAGE_READWRITE};

    #[repr(C)]
    struct LinkedMem {
        ui_version: u32,
        ui_tick: u32,
        avatar_position: [f32; 3],
        avatar_front: [f32; 3],
        avatar_top: [f32; 3],
        name: [u16; 256],
        camera_position: [f32; 3],
        camera_front: [f32; 3],
        camera_top: [f32; 3],
        identity: [u16; 256],
        context_len: u32,
        context: [u8; 256],
        description: [u16; 2048],
    }

    fn put(dst: &mut [u16], s: &str) {
        for (i, c) in s.encode_utf16().take(dst.len() - 1).enumerate() {
            dst[i] = c;
        }
    }

    let args: Vec<f32> = std::env::args().skip(1).filter_map(|a| a.parse().ok()).collect();
    let (cx, cz) = (args.first().copied().unwrap_or(0.0), args.get(1).copied().unwrap_or(0.0));

    let name: Vec<u16> = "MumbleLink\0".encode_utf16().collect();
    let size = std::mem::size_of::<LinkedMem>();
    unsafe {
        let handle = CreateFileMappingW(INVALID_HANDLE_VALUE, std::ptr::null(), PAGE_READWRITE, 0, size as u32, name.as_ptr());
        if handle.is_null() {
            eprintln!("Impossible de créer la mémoire MumbleLink");
            return;
        }
        let view = MapViewOfFile(handle, FILE_MAP_ALL_ACCESS, 0, 0, size);
        let mem = &mut *(view.Value as *mut LinkedMem);
        mem.ui_version = 2;
        put(&mut mem.name, "Simulateur Tomo");
        put(&mut mem.identity, "joueur-simule");
        let ctx = b"serveur-de-test";
        mem.context[..ctx.len()].copy_from_slice(ctx);
        mem.context_len = ctx.len() as u32;
        put(&mut mem.description, "Position simulée pour tester l'audio spatial de Tomo");

        println!("Simulateur Mumble Link actif : le joueur marche en rond autour de ({cx}, {cz}). Ctrl+C pour arrêter.");
        let start = Instant::now();
        loop {
            let t = start.elapsed().as_secs_f32() * 0.4;
            let (x, z) = (cx + 10.0 * t.cos(), cz + 10.0 * t.sin());
            // Regarde dans le sens de la marche
            let (fx, fz) = (-t.sin(), t.cos());
            mem.avatar_position = [x, 1.6, z];
            mem.avatar_front = [fx, 0.0, fz];
            mem.avatar_top = [0.0, 1.0, 0.0];
            mem.camera_position = mem.avatar_position;
            mem.camera_front = mem.avatar_front;
            mem.camera_top = mem.avatar_top;
            mem.ui_tick = mem.ui_tick.wrapping_add(1);
            std::thread::sleep(Duration::from_millis(50));
        }
    }
}

#[cfg(not(windows))]
fn main() {
    eprintln!("Le simulateur Mumble Link ne fonctionne que sous Windows.");
}
