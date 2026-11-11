# Client tomo (Tauri + React)

Application de bureau tomo (Windows, Mac) : connexion / compte / invité, serveurs en dossiers, pièces vocales, fils, messages privés et appels, partage d'écran et mode coach, clips, audio spatial, sous-titres, overlay en jeu, jeux détectés, mur des légendes, défis, stats, paramètres.

> Pour **installer** tomo sans rien compiler : https://github.com/kameronramah/tomo/releases/latest

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
2. Lancer le client (Windows) :
   ```bash
   client\scripts\dev.cmd
   ```
   Le script recharge le PATH, vérifie que l'API de dev répond, installe les dépendances si besoin, puis lance `npm run tauri dev`. Il passe par un `.cmd` pour ne pas dépendre de la politique d'exécution des scripts PowerShell. Sur un autre système : `cd client && npm install && npm run tauri dev`.
3. En dev, l'appli pointe sur l'instance `http://localhost:3000` (modifiable sur l'écran de connexion) ; les versions publiées utilisent d'office `https://tomo.grylix.dev`, sans choix possible : crée un compte, puis un serveur.

> Astuce : `npm run dev` lance seulement la partie web sur http://localhost:1420. Chaque onglet a sa propre session : pratique pour simuler plusieurs joueurs. Ce qui demande la partie Rust (jeux détectés, overlay, clips sur disque, mise à jour automatique, coffre-fort) ne marche que dans l'appli de bureau.

### Compte de test et outils de test

Le serveur de dev crée automatiquement un **compte de test** (`DEV_USERNAME` / `DEV_PASSWORD` dans [`server/docker-compose.dev.yml`](../server/docker-compose.dev.yml)). Connecté avec ce compte, une icône 🧪 ouvre le panneau **Outils de test** :

| Outil | À quoi ça sert |
|---|---|
| Infos | instance, identité LiveKit, état et qualité de connexion, ping |
| Faux joueurs (+1 / +3 bots) | remplir une pièce ; ils « parlent » (bip doux) et se déplacent sur la carte spatiale |
| Bot écran | un faux partage d'écran 1080p60 (annotations du mode coach ouvertes) |
| Retour micro | s'entendre soi-même pour régler son micro |
| Coupure courte / reconnexion | vérifier que l'appli se reconnecte toute seule |
| Jeton expiré / session perdue | vérifier le renouvellement de session |
| Faux membres | remplir la liste des membres d'un serveur |
| Journal | les événements de la pièce en direct |

**Sécurité :** ces outils n'existent que si l'API tourne avec `DEV_TOOLS=1`. **Ne mets jamais `DEV_TOOLS` dans le `.env` du VPS.**

### Tester sans jeu
- **Audio spatial** : active « Audio spatial » dans une pièce, ajoute des bots : ils tournent autour de toi.
- **Mumble Link** : `client\scripts\mumble-sim.cmd` fait croire à tomo qu'un jeu compatible tourne. Test automatique : `cargo test --lib mumble`.
- **Jeux détectés** : Paramètres › Jeux › « Ajouter un jeu » avec le nom d'un programme ouvert (ex. `notepad.exe`), puis ouvre ce programme. Test de la lecture des programmes : `cargo test --lib games`.
- **Sous-titres** : la première activation télécharge le modèle (40 à 250 Mo selon le réglage) ; il faut au moins un pote (ou un 2ᵉ onglet connecté avec un autre compte) qui parle.

### Ajouter un texte à l'interface
Écris-le en français entouré de `t("…")` (`import { t } from "../lib/i18n"`), et ajoute sa traduction dans `src/lib/i18n-en.ts`. Pour retrouver les textes sans traduction :
```powershell
$en=[IO.File]::ReadAllText("$PWD\src\lib\i18n-en.ts"); Get-ChildItem src -Recurse -Include *.ts,*.tsx | % { [regex]::Matches([IO.File]::ReadAllText($_.FullName), '\bt\(("(?:[^"\\]|\\.)*")') | % { $_.Groups[1].Value } } | Sort-Object -Unique | ? { -not $en.Contains("  $($_):") }
```

L'adresse de l'instance par défaut peut être fixée à la compilation : `VITE_TOMO_INSTANCE=https://autre-adresse npm run tauri build`.

## Construire l'exécutable
```bash
npm run tauri build
```
L'installateur se trouve ensuite dans `src-tauri/target/release/bundle/`. Pour une vraie version (Windows + Mac, signée pour la mise à jour automatique) : voir [docs/PUBLIER-UNE-VERSION.md](../docs/PUBLIER-UNE-VERSION.md).

> Si l'édition de liens échoue avec `LNK1104` : le chemin du projet est trop long pour Windows. Place le projet dans un dossier court (ex. `C:\dev\tomo`) ou définis `CARGO_TARGET_DIR` vers un chemin court.

## Structure
```
src/
├── App.tsx                  # chef d'orchestre : session, serveurs, vocal, appels, messages, fenêtres
├── App.css                  # charte tomo (variables en haut, sections par version en bas)
├── main.tsx                 # fenêtre principale, ou overlay (?overlay=1)
├── components/
│   ├── AuthScreen, ServerRail, Home (accueil d'un serveur), ServerPlan, Stage (scène vocale),
│   ├── VoiceIsland, ChatView + MessageParts (réactions, mentions), Attachments, GifPicker,
│   ├── MessagesView, DmPanel, FriendsView, ProfileCard, MemberList, Dialogs, IncomingCall,
│   ├── ScreenView + CoachLayer (mode coach), MapView (carte spatiale), CaptionsBar (sous-titres),
│   ├── LegendsView, ChallengesView, GameCard, GameStats, UpdateCard, Overlay,
│   └── Settings (+ SettingsProfile, SettingsGames, SettingsOverlay), DevPanel, TitleBar, Brand
└── lib/
    ├── api.ts, realtime.ts       # API REST + WebSocket
    ├── voice.ts, leveler.ts, spatial.ts, speaking.ts, denoise.ts, clips.ts, screen.ts, coach.ts
    ├── captions.ts + captions.worker.ts   # sous-titres et traduction locaux
    ├── games.ts, gameLink.ts     # jeux lancés, Mumble Link
    ├── overlay.ts, updater.ts, desktop.ts, badge.ts
    ├── i18n.ts + i18n-en.ts      # langues
    ├── people.ts, folders.ts, prefs.ts, secure.ts, sounds.ts, ui.ts, dev.ts
src-tauri/src/               # lib.rs (commandes), clips.rs, mumble.rs, games.rs
src-tauri/capabilities/      # permissions : default.json (fenêtre principale), overlay.json
```
