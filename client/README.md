# Client Talk2Mates (Tauri + React)

Application de bureau : écran de connexion, salon vocal, liste des participants avec indicateur « qui parle », micro ON/OFF, volume par personne, choix du micro et de la sortie audio.

## Prérequis (Windows)
- [Node.js LTS](https://nodejs.org)
- [Rust](https://rustup.rs)
- « Visual Studio Build Tools » avec la charge de travail **C++** (voir https://tauri.app/start/prerequisites/)

En une fois avec winget :
```powershell
winget install OpenJS.NodeJS.LTS Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Développer en local

1. Lancer le serveur de dev (LiveKit + API) avec Docker :
   ```bash
   cd server
   docker compose -f docker-compose.dev.yml up --build
   ```
2. Lancer le client :
   ```bash
   cd client
   npm install
   npm run tauri dev
   ```
3. Dans l'appli : API `http://localhost:3000`, code d'invitation `test`.

> Astuce : `npm run dev` lance seulement la partie web sur http://localhost:1420, pratique pour ouvrir deux onglets et simuler deux joueurs.

## Construire l'exécutable
```bash
npm run tauri build
```
L'installateur se trouve ensuite dans `src-tauri/target/release/bundle/`.

> Si l'édition de liens échoue avec `LNK1104` : le chemin du projet est trop long pour Windows. Place le projet dans un dossier court (ex. `C:\dev\T2M`) ou définis `CARGO_TARGET_DIR` vers un chemin court.

## Structure
```
src/
├── App.tsx               # écran de connexion
├── components/RoomView.tsx  # salon vocal
└── lib/voice.ts          # token API + connexion LiveKit + lecture audio
src-tauri/                # partie Rust (fenêtre, futurs raccourcis globaux, détection de jeu)
```
