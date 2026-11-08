# Client Tomo (Tauri + React)

Application de bureau Tomo :
- **connexion / création de compte / entrée comme invité** avec un code ;
- **sélecteur de serveur** (menu + accès rapide + Ctrl 1…9), création d'un serveur, rejoindre avec un code ;
- **salons en cartes** avec qui est dedans, passage d'un salon à l'autre en un clic ;
- **scène du salon vocal** : tuiles des participants, qui parle, volume par personne, dock (micro, son, périphériques, quitter), interrupteur d'audio spatial ;
- **gestion du serveur** pour les admins : salons, membres, invitations.

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
3. L'appli pointe par défaut sur l'instance `http://localhost:3000` : crée un compte, puis un serveur.

> Astuce : `npm run dev` lance seulement la partie web sur http://localhost:1420. Chaque onglet a sa propre session : pratique pour simuler plusieurs joueurs.

L'adresse de l'instance par défaut peut être fixée à la compilation : `VITE_TOMO_INSTANCE=https://tomo-api.duckdns.org npm run tauri build`.

## Construire l'exécutable
```bash
npm run tauri build
```
L'installateur se trouve ensuite dans `src-tauri/target/release/bundle/`.

> Si l'édition de liens échoue avec `LNK1104` : le chemin du projet est trop long pour Windows. Place le projet dans un dossier court (ex. `C:\dev\T2M`) ou définis `CARGO_TARGET_DIR` vers un chemin court.

## Structure
```
src/
├── App.tsx                  # état global : session, serveurs, vocal, fenêtres
├── App.css                  # charte Tomo (graphite, turquoise, ambre)
├── components/
│   ├── AuthScreen.tsx       # connexion, inscription, invité
│   ├── Sidebar.tsx          # sélecteur de serveur, salons, profil
│   ├── Home.tsx             # bienvenue, accueil d'un serveur, test du micro
│   ├── Stage.tsx            # salon vocal (tuiles + dock)
│   ├── Dialogs.tsx          # créer/rejoindre, inviter, gérer le serveur
│   └── Brand.tsx            # logo, icônes, avatars
└── lib/
    ├── api.ts               # client API + renouvellement de session
    ├── secure.ts            # coffre-fort (Gestionnaire d'identification Windows)
    ├── voice.ts             # connexion LiveKit, volumes, couper le son
    ├── prefs.ts             # préférences locales (instance, périphériques)
    └── ui.ts                # couleurs d'avatar, dates
src-tauri/                   # partie Rust : fenêtre, coffre-fort (keyring)
```
