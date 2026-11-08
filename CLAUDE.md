# CLAUDE.md — Contexte du projet Tomo (dépôt T2M)

> Fichier lu automatiquement par Claude Code. Il résume tout ce qu'il faut savoir pour reprendre le projet.
> Dépôt : https://github.com/kameronramah/T2M — branche `main`. Version actuelle : **0.5.0**.

---

## 1. Le projet en bref

**Tomo** (« ami » en japonais ; anciennement *Talk2Mates / T2M*) est une appli de **chat vocal pour jouer entre amis**, alternative à Discord avec des fonctionnalités en plus. **100 % gratuite et auto-hébergée** : aucun service payant, tout tourne sur un VPS (celui d'un ami du propriétaire).

Ce qui existe déjà (v0.5) :
- Comptes sécurisés, serveurs créés par les utilisateurs (créateur = admin), salons vocaux et textuels, invitations (code membre + **code invité d'un soir sans compte**).
- Messagerie temps réel : salons textuels, chat de chaque salon vocal, amis, messages privés, **appels privés** avec sonnerie.
- **Audio spatial** : carte du salon (chacun déplace son avatar) + position lue dans le jeu via **Mumble Link**.
- **Clip des 60 dernières secondes** (fichier .wav dans Musique\Tomo Clips).
- **Partage d'écran haute qualité** (1080p60 H.264, 1440p/4K VP9, son du PC, plein écran).
- Sons d'interface, ping et qualité réseau visibles, espace **Paramètres** complet, barre de titre intégrée, interface adaptative (720 px → 4K).
- **Compte de test + outils de test** (bots qui parlent/bougent/partagent un écran, coupures réseau simulées…) — uniquement en dev.

La feuille de route complète est dans [ROADMAP.md](ROADMAP.md) (avec une section **« Petites améliorations »** à compléter au fil de l'eau).

---

## 2. Comment travailler avec le propriétaire (important)

- **Toujours répondre en français**, en tutoyant, avec un ton simple et concret. Il n'est pas forcément technique : expliquer le « pourquoi » sans jargon.
- **Gratuit avant tout** : ne jamais proposer de service payant ; s'il en faut un, le mettre dans « Mis de côté » de la ROADMAP.
- **Maquettes d'abord** pour les gros changements d'interface (il les valide avant le code). La charte graphique est validée (voir §6).
- **Ne pas copier le style de Discord** : il veut une identité propre à Tomo, moderne et sobre.
- **Noter les petites améliorations repérées** dans la section « Petites améliorations » de la ROADMAP (il l'a demandé explicitement). Les raccourcis globaux et le push-to-talk y sont rangés volontairement.
- **Il aime qu'on pousse sur GitHub** une fois une étape testée (`git push origin main`).
- **Git** : l'identité des commits doit être l'adresse anonyme GitHub `72966920+kameronramah@users.noreply.github.com` (nom `kameronramah`). **Ne jamais utiliser son adresse e-mail professionnelle** (projet personnel).
- Tester avant d'annoncer : dire clairement ce qui a été vérifié et ce qui ne l'a pas été (ex. son réel, micro, jeu réel).

---

## 3. Architecture

```
T2M/
├── client/                 Appli de bureau Tauri 2 (Rust) + React 19 + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx         Chef d'orchestre : session, serveurs, vocal, appels, messagerie, fenêtres
│   │   ├── App.css         Toute la charte (variables CSS en haut, sections par version en bas)
│   │   ├── main.tsx        Fenêtre + barre de titre intégrée
│   │   ├── components/     AuthScreen, Sidebar, Stage (scène vocale + dock), MapView (carte spatiale),
│   │   │                   ScreenView (partage d'écran), ChatView, FriendsView, Settings, Dialogs,
│   │   │                   IncomingCall, DevPanel (outils de test), Home, TitleBar, Brand (logo, icônes)
│   │   └── lib/            api.ts (client REST + renouvellement de session), realtime.ts (WebSocket),
│   │                       voice.ts (LiveKit, volumes, extras), spatial.ts (moteur 3D), gameLink.ts
│   │                       (Mumble Link), clips.ts, screen.ts, sounds.ts (sons synthétisés), prefs.ts
│   │                       (réglages locaux), secure.ts (coffre-fort), dev.ts (bots), ui.ts
│   ├── src-tauri/src/      lib.rs (commandes), clips.rs (fichiers de clips), mumble.rs (lecture Mumble Link)
│   ├── src-tauri/examples/mumble_sim.rs   Simulateur de jeu Mumble Link
│   └── scripts/            dev.cmd / dev.ps1 (lancer en dev), mumble-sim.cmd / .ps1
├── server/
│   ├── api/                API Node 24 + TypeScript + Fastify 5 + SQLite intégré (node:sqlite)
│   │   ├── src/            index.ts, config.ts, db.ts (schéma + migrations), security.ts (scrypt, JWT),
│   │   │                   access.ts (droits), realtime.ts (WebSocket), livekit.ts, routes-auth.ts,
│   │   │                   routes-servers.ts, routes-chat.ts, routes-social.ts, routes-dev.ts
│   │   └── tests/          test-api.ps1 (34 tests), test-social.ps1 (20 tests)
│   ├── docker-compose.yml      Production (VPS) : LiveKit + API + Caddy (HTTPS)
│   ├── docker-compose.dev.yml  Développement local (avec DEV_TOOLS et compte de test)
│   ├── livekit.yaml, Caddyfile, .env.example
└── docs/ARCHITECTURE.md, docs/HEBERGEMENT.md (déploiement VPS pas à pas)
```

**Flux** : le client parle à l'API en REST (jeton d'accès JWT 15 min + jeton de renouvellement à rotation) et reçoit les événements en **WebSocket** (`/ws?token=`). Pour entrer dans un salon ou un appel, l'API signe un **jeton LiveKit** ; l'audio/vidéo passe par **LiveKit** (SFU WebRTC auto-hébergé).

**Modèle** : une *instance* (= un VPS) héberge des comptes et des serveurs. Rôles par serveur : `owner` (créateur) / `admin` / `member` ; les **invités** ont un jeton limité à un serveur. Aucun serveur par défaut.

Points techniques notables :
- Toutes les voix passent par un **AudioContext** (`webAudioMix` de LiveKit) → c'est ce qui permet l'audio spatial (`PannerNode` HRTF via `setWebAudioPlugins`). Seul le **micro** est spatialisé, jamais le son d'un partage d'écran.
- Positions spatiales échangées sur le **canal de données LiveKit**, sujet `pos` (~10/s). Sources `map` et `game` ne se mélangent jamais (repli : voix au centre, plein volume).
- Clips : `AudioWorklet` → tampon circulaire 60 s en mémoire → WAV ; envoi binaire à Rust (`invoke` avec `Uint8Array`). Attribut LiveKit `clips=1` visible par les autres.
- « Rester connecté » : jeton de renouvellement dans le **Gestionnaire d'identification Windows** (crate `keyring`).

---

## 4. Lancer le projet en local (Windows)

Prérequis : Docker Desktop, Node.js LTS, Rust (rustup), Visual Studio Build Tools (C++). Ils sont installés sur le PC du propriétaire.

```bash
cd server
docker compose -f docker-compose.dev.yml up -d --build
```
```bash
client\scripts\dev.cmd
```
- L'API de dev écoute sur `http://localhost:3000`, LiveKit sur `ws://localhost:7880`.
- `client\scripts\dev.cmd` lance `npm run tauri dev` (rechargement à chaud). Version web seule : `npm run dev` dans `client/` → http://localhost:1420 (une session par onglet, pratique pour simuler plusieurs joueurs).
- **Compte de test** : identifiants dans `server/docker-compose.dev.yml` (`DEV_USERNAME` / `DEV_PASSWORD`). Il donne accès au panneau 🧪 Outils de test.
- Simulateur de jeu : `client\scripts\mumble-sim.cmd`.

Vérifications :
```bash
cd client && npx tsc --noEmit -p .
```
```bash
cd server/api && npx tsc --noEmit
```
```bash
powershell -ExecutionPolicy Bypass -File server\api\tests\test-api.ps1
```
```bash
powershell -ExecutionPolicy Bypass -File server\api\tests\test-social.ps1
```
```bash
cd client/src-tauri && cargo test --lib mumble
```
Après une modification de l'API : `docker compose -f docker-compose.dev.yml up -d --build api` (dans `server/`).

Build de l'exécutable : `npm run tauri build` dans `client/` (installateur dans `src-tauri/target/release/bundle/`).

---

## 5. Pièges déjà rencontrés (à connaître)

- **Windows PowerShell 5.1** : pas de `&&` (utiliser `;` ou des commandes séparées) ; l'**exécution de scripts .ps1 est bloquée** sur le PC → passer par les `.cmd` (`powershell -ExecutionPolicy Bypass -File …`), ne pas modifier la politique système.
- **Chemin du projet trop long** → erreur `LNK1104` à l'édition de liens Rust : définir `CARGO_TARGET_DIR` vers un chemin court (les scripts le font). Mieux : cloner le dépôt dans un dossier court (`C:\dev\T2M`).
- **PowerShell** : les noms de variables sont **insensibles à la casse** (`$a` = `$A`) ; dans `@( 'a' + "b", 'c' )` la **virgule passe avant le `+`** ; dans une chaîne `"…"`, `${…}` et `` ` `` sont interprétés (casse les template literals TypeScript) → pour éditer du code, préférer l'outil d'édition de fichiers aux remplacements PowerShell.
- **CORS** : `@fastify/cors` n'autorise que GET/HEAD/POST par défaut → `methods` est explicitement configuré (PATCH/DELETE).
- **Requêtes POST sans corps** envoyées par PowerShell : l'API a un parseur « * » qui les accepte.
- **Limitation anti-force brute** : 10 essais/min/IP sur `/auth/*` → lancer les tests à la suite peut donner des 429 (les scripts attendent et réessaient).
- **Même compte = même identité LiveKit** : se connecter en vocal au même salon avec le même compte depuis deux endroits éjecte l'autre. Pour tester dans le navigateur pendant que le propriétaire utilise l'appli, prendre un autre salon ou un autre compte.
- L'**overlay de performances NVIDIA** (Alt + R) peut s'afficher sur la fenêtre : ce n'est pas Tomo.
- Le navigateur intégré de Claude bloque le micro et la capture d'écran : tester ces parties dans l'appli de bureau (le propriétaire teste lui-même).

---

## 6. Charte graphique (validée)

- Fond graphite `#0E1014`, panneaux `#13161C`, cartes `#161920`, texte `#ECEEF3`.
- **Turquoise signal `#2DD4BF`** (actions, « qui parle »), **ambre écho `#FFB020`** (accents, statuts), rouge `#E5484D` (quitter, erreurs).
- Polices : **Space Grotesk** (titres), **Inter** (texte). Icônes en traits fins (composant `Icon` dans `Brand.tsx`), jamais d'emoji dans l'interface.
- Logo : deux bulles qui se répondent (turquoise avec onde sonore, ambre) — composant `Logo`, icônes générées depuis `client/app-icon.svg` (`npx tauri icon app-icon.svg`).
- Maquettes de référence (privées) : https://claude.ai/artifact/ULPkHanxgN7nAbgsNQRk1X (les écrans Connexion / Créer un compte y montrent encore l'ancien parcours : l'appli fait foi).

---

## 7. Sécurité (règles à respecter)

- Mots de passe : scrypt (N=32768), 12 caractères min, comparaison à temps constant, hash factice si le pseudo n'existe pas.
- Jetons de renouvellement stockés **hachés** (SHA-256), rotation à chaque usage ; changement de mot de passe = toutes les sessions révoquées.
- Droits vérifiés **côté serveur** à chaque route (`access.ts`).
- **`DEV_TOOLS=1` uniquement en dev** : sans lui, les routes `/dev` n'existent pas et le compte de test n'est pas créé. Ne jamais le mettre dans le `.env` du VPS.
- Ne jamais committer `.env` ni de secret. Les identifiants de test ne sont que dans `docker-compose.dev.yml`.
- Clips : rien n'est enregistré sans action de l'utilisateur, fichiers en local, icône visible par les autres.

---

## 8. Où en est-on / suite logique

Prochaines étapes possibles (à valider avec le propriétaire) :
1. **Déployer sur le VPS** de son ami (guide `docs/HEBERGEMENT.md`) pour tester à plusieurs, chacun chez soi — pas encore fait.
2. Grosses fonctionnalités restantes (ROADMAP V2/V3) : détection du jeu lancé + statut « joue à… », mode focus/ranked, mode radio (plusieurs salons), callouts vocaux (Piper), overlay en jeu, annotation sur partage d'écran (mode coach), « qui est dispo ce soir », stats Steam/Riot, sous-titres/traduction locaux.
3. Petites améliorations listées dans la ROADMAP (raccourcis globaux + push-to-talk, notifications Windows, profil/pseudo, édition de messages, etc.).
4. Mettre en place GitHub Actions (tests + build de l'installateur) et l'auto-update via GitHub Releases.
