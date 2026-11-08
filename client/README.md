# Client Talk2Mates (Tauri + React)

Application de bureau, avec une interface façon Discord :
- **barre des serveurs** à gauche (mémorisés), bouton « + » pour en rejoindre un (adresse + code d'invitation) ;
- **liste des salons** du serveur avec qui est dedans, et passage d'un salon à l'autre en un clic ;
- **salon vocal** : indicateur « qui parle », micro ON/OFF, volume par personne, choix du micro et de la sortie audio.

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
3. Dans l'appli : « + » → adresse `localhost:3000`, code d'invitation `test`.

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
├── App.tsx                      # état global : serveurs, salon vocal actuel
├── components/
│   ├── ServerRail.tsx           # barre des serveurs
│   ├── ChannelSidebar.tsx       # salons + occupants, statut vocal, pseudo
│   ├── VoicePanel.tsx           # salon vocal
│   └── Dialogs.tsx              # pseudo, rejoindre un serveur
└── lib/
    ├── storage.ts               # mémoire locale (pseudo, serveurs, périphériques)
    └── voice.ts                 # appels API + connexion LiveKit + lecture audio
src-tauri/                # partie Rust (fenêtre, futurs raccourcis globaux, détection de jeu)
```
