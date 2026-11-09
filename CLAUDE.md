# CLAUDE.md — Contexte du projet tomo

> Fichier lu automatiquement par Claude Code. Il résume tout ce qu'il faut savoir pour reprendre le projet.
> Dépôt : https://github.com/kameronramah/tomo (anciennement `T2M`, renommé le 8 novembre 2026) — branche `main`. Version actuelle : **0.11.0**.
> Copie locale du propriétaire : `C:\Users\Kameron\Documents\tomo`.
> Installer la dernière version : https://github.com/kameronramah/tomo/releases/latest

---

## 1. Le projet en bref

**tomo** (« ami » en japonais ; anciennement *Talk2Mates / T2M*) est une appli de **chat vocal pour jouer entre amis**, alternative à Discord avec des fonctionnalités en plus. **100 % gratuite et auto-hébergée** : aucun service payant, tout tourne sur un VPS (celui d'un ami du propriétaire). La marque s'écrit **« tomo » en minuscules, partout**.

Ce qui existe (v0.11) :
- **Comptes, serveurs** (créateur = admin, dossiers de serveurs), pièces vocales et fils (**rangés par glisser-déposer**), invitations (membre + **invité d'un soir sans compte**).
- **Messagerie** temps réel : fils, chat de chaque pièce, amis, messages privés (demandes hors amis), **appels privés** ; pièces jointes, messages vocaux, GIF (Klipy), **modifier, réactions, mentions** @pseudo / @vocal / @tous, « en train d'écrire… ».
- **Profils, statuts, confidentialité, blocage**, membres du serveur, notifications système, pastilles de non-lus.
- **Adresse e-mail obligatoire** (vérifiée par un code) et **mot de passe oublié** par code à 6 chiffres envoyé par mail (Gmail SMTP), ou **code de secours** donné par l'admin (`cli-secours.js`).
- **Micro** : **appuyer pour parler** (touche ou bouton de souris) ou **seuil de voix**, option **« baisser les autres quand je parle »** ; **raccourcis configurables qui marchent en jeu** (Paramètres › Raccourcis clavier).
- **Vocal** : volume uniformisé, **suppression de bruit RNNoise** + porte de bruit, **audio spatial** (carte ou Mumble Link), **clips**, **partage d'écran** HD + **mode coach** (annotations sur demande, affichées sur l'écran de celui qui partage), **sous-titres + traduction** FR ⇄ EN locaux, **overlay en jeu**.
- **Jeux** : détection du jeu lancé (« joue à … »), réglages par jeu (pièce auto, mode focus, spatial, overlay, masquer), proposition de rejoindre les potes, **stats Steam / League of Legends**.
- **Social** : **mur des légendes** (citations, images, clips), **défis à points** (sans paris), classement du mois.
- **Appli** : français / anglais, **mises à jour imposées** (GitHub Releases signées : installée d'office au lancement, pop-up après le vocal pendant l'utilisation), installateurs Windows + Mac, **version navigateur** (https://app-tomo.grylix.dev), Paramètres complets.
- **Compte de test + outils de test** (bots qui parlent, bougent, partagent un écran…) — uniquement en dev.

Les **paris** sont volontairement en attente (le propriétaire veut d'abord décider à quoi servent les points). Pas de canal bêta pour les mises à jour (demande explicite).

La feuille de route complète est dans [ROADMAP.md](ROADMAP.md) (avec une section **« Petites améliorations »** à compléter au fil de l'eau).

---

## 2. Comment travailler avec le propriétaire (important)

- **Toujours répondre en français**, en tutoyant, avec un ton simple et concret. Il n'est pas forcément technique : expliquer le « pourquoi » sans jargon.
- **Gratuit avant tout** : ne jamais proposer de service payant ; s'il en faut un, le mettre dans « Mis de côté » de la ROADMAP.
- **Maquettes d'abord** pour les gros changements d'interface (il les valide avant le code). La charte graphique est validée (voir §6). Maquettes v0.7/v0.8 : https://claude.ai/artifact/HVWgLBMvzvko38Gyi7npGU
- **Ne pas copier le style de Discord** : il veut une identité propre à tomo, moderne et sobre.
- **Noter les petites améliorations repérées** dans la section « Petites améliorations » de la ROADMAP (il l'a demandé explicitement). Les raccourcis globaux et le push-to-talk y sont rangés volontairement.
- **Il aime qu'on pousse sur GitHub** une fois une étape testée (`git push origin main`).
- **Git** : l'identité des commits doit être l'adresse anonyme GitHub `72966920+kameronramah@users.noreply.github.com` (nom `kameronramah`). **Ne jamais utiliser son adresse e-mail professionnelle** (projet personnel).
- Tester avant d'annoncer : dire clairement ce qui a été vérifié et ce qui ne l'a pas été (ex. son réel, micro, jeu réel, overlay par-dessus un vrai jeu).
- **Tout nouveau texte d'interface** passe par `t("…")` (français dans le code) **et** reçoit sa traduction dans `client/src/lib/i18n-en.ts`.

---

## 3. Architecture

```
tomo/
├── client/                 Appli de bureau Tauri 2 (Rust) + React 19 + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx         Chef d'orchestre : session, serveurs, vocal, appels, messagerie, jeux, overlay
│   │   ├── App.css         Toute la charte (variables CSS en haut, sections par version en bas)
│   │   ├── main.tsx        Fenêtre principale + barre de titre, ou overlay (?overlay=1)
│   │   ├── components/     AuthScreen, ServerRail (serveurs + dossiers), Home (accueil d'un serveur),
│   │   │                   ServerPlan, Stage (scène vocale + dock), VoiceIsland, ChatView + MessageParts
│   │   │                   (réactions, mentions, édition), Attachments, GifPicker, MessagesView, DmPanel,
│   │   │                   FriendsView, ProfileCard, MemberList, ScreenView + CoachLayer, MapView,
│   │   │                   CaptionsBar, LegendsView, ChallengesView, GameCard, GameStats, UpdateCard,
│   │   │                   Overlay, Settings (+ SettingsProfile, SettingsGames, SettingsOverlay, SettingsVoice),
│   │   │                   Dialogs, IncomingCall, DevPanel, TitleBar, Brand (logo, icônes, avatars)
│   │   └── lib/            api.ts, realtime.ts, voice.ts, leveler.ts (volume uniformisé), spatial.ts,
│   │                       speaking.ts, denoise.ts (RNNoise), clips.ts, screen.ts, coach.ts + coachScreen.ts,
│   │                       captions.ts + captions.worker.ts (Whisper / Opus-MT), games.ts (jeux lancés),
│   │                       gameLink.ts (Mumble Link), overlay.ts, updater.ts, i18n.ts + i18n-en.ts,
│   │                       hotkeys.ts (raccourcis), ptt.ts (push-to-talk), sortable.ts (glisser-déposer),
│   │                       people.ts (annuaire), desktop.ts (notifications, démarrage), badge.ts,
│   │                       folders.ts, prefs.ts (réglages locaux), secure.ts, sounds.ts, ui.ts, dev.ts
│   ├── src-tauri/src/      lib.rs (commandes, plugins), clips.rs, mumble.rs, games.rs (programmes ouverts),
│   │                       input.rs (état des touches des raccourcis, sans bloquer le jeu)
│   ├── src-tauri/capabilities/  default.json (fenêtre principale), overlay.json (overlay : écoute seulement)
│   ├── src-tauri/examples/mumble_sim.rs   Simulateur de jeu Mumble Link
│   └── scripts/            dev.cmd / dev.ps1 (lancer en dev), mumble-sim.cmd / .ps1
├── server/
│   ├── api/                API Node 24 + TypeScript + Fastify 5 + SQLite intégré (node:sqlite)
│   │   ├── src/            index.ts, config.ts, db.ts, security.ts, access.ts, realtime.ts (WebSocket,
│   │   │                   présence, « joue à »), livekit.ts, routes-auth.ts, routes-servers.ts,
│   │   │                   routes-chat.ts (messages, réactions, mentions), routes-social.ts, profiles.ts,
│   │   │                   attachments.ts, gifs.ts, legends.ts, challenges.ts, gamestats.ts, typing.ts, routes-dev.ts,
│   │   │                   routes-account.ts (e-mail, mot de passe oublié), codes.ts, mail.ts (SMTP), cli-secours.ts
│   │   └── tests/          test-api/social/attachments/profiles/messages.ps1, test-games/legends/stats/v09/email.mjs
│   ├── docker-compose.yml      Production (VPS) : LiveKit + API + Caddy (HTTPS)
│   ├── docker-compose.dev.yml  Développement local (avec DEV_TOOLS et compte de test)
│   ├── livekit.yaml, Caddyfile, .env.example
├── .github/workflows/installateurs.yml   Installateurs Windows + Mac + latest.json à chaque tag v*
└── docs/ARCHITECTURE.md, HEBERGEMENT.md (déploiement VPS), PUBLIER-UNE-VERSION.md (sortir une version)
```

**Flux** : REST (jeton d'accès JWT 15 min + jeton de renouvellement à rotation) + **WebSocket** (`/ws?token=`). Pour entrer dans une pièce, l'API signe un **jeton LiveKit** (avec `canUpdateOwnMetadata` pour les attributs). L'audio/vidéo passe par **LiveKit** (SFU auto-hébergé).

**Modèle** : une *instance* (= un VPS) héberge des comptes et des serveurs. Rôles par serveur : `owner` / `admin` / `member` ; les **invités** ont un jeton limité à un serveur.

Points techniques notables :
- **Chaîne par voix reçue** (`setWebAudioPlugins`, en ligne droite) : volume uniformisé puis audio spatial. **Micro** : RNNoise + porte de bruit via `setProcessor` (`denoise.ts`), suivent les réglages en direct.
- « Qui parle » : mesuré localement toutes les 40 ms (`speaking.ts`) ; pour mon micro, sur la piste traitée (ce qui part vraiment).
- **Push-to-talk** (`ptt.ts`) : la piste micro brute est mise en `enabled = false` tant que la touche n'est pas tenue (filet de sécurité toutes les 250 ms ; un micro coupé n'est jamais rouvert). **Baisser les autres** : facteur `duck` appliqué dans `applyVolume` (`voice.ts`) quand « qui parle » me détecte.
- **Raccourcis** : `input.rs` lit l'état des touches (Windows `GetAsyncKeyState`, Mac `CGEventSourceKeyState`) toutes les 8 ms, **seulement celles des raccourcis** (`input_set_keys`), et envoie `input:keys` à la fenêtre principale ; `hotkeys.ts` déclenche les actions. Enregistrement d'une touche : `input_record` (toutes les touches, 15 s max). Repli clavier de la fenêtre dans le navigateur. Noms des touches : « Ctrl », « Shift », « M », « Mouse4 »…
- **E-mail et mot de passe oublié** : colonne `users.email` (minuscules, unique) + `email_verified` ; codes à 6 chiffres hachés dans `email_codes` (`verify` / `reset` / `rescue`, 5 essais, 30 min ou 1 h). `/auth/forgot` répond toujours pareil (pas de fuite) et n'envoie que vers une adresse **vérifiée**. Envoi par SMTP (`SMTP_USER` / `SMTP_PASS`, Gmail + mot de passe d'application) ; en dev sans SMTP, les codes vont dans `/dev/mailbox`. Côté appli : `AuthScreen` (modes forgot / reset), `EmailAccount.tsx` (fenêtre obligatoire au démarrage, Paramètres › Compte). Mauvais mot de passe actuel = **403** (un 401 déconnecterait l'appli).
- **Ranger** : `PUT /servers/:id/rooms/order` et `/channels/order` (liste complète), événement WebSocket `channels` → les clients rechargent le serveur.
- **Attributs LiveKit** du participant : `clips=1`, `cc=1` (sous-titres), `coach` (`all` ou identités autorisées à annoter mon écran, après demande acceptée), `lang` (fr/en, langue de transcription). Toujours les écrire avec `{ ...attributes, clé: valeur }`.
- **Canaux de données LiveKit** : `pos` (positions spatiales, ~10/s), `coach` (annotations).
- **Jeux** : Rust `running_programs` (crate `sysinfo`, noms des programmes seulement) → `games.ts` (liste connue + jeux ajoutés) → WebSocket `{type:"game"}` → serveur en mémoire (`gameOf`, respecte `show_game`).
- **Sous-titres** : Transformers.js 3.7 dans un Web Worker ; modèles `onnx-community/whisper-*` et `Xenova/opus-mt-fr-en` / `en-fr` téléchargés depuis Hugging Face au premier usage ; WebGPU si dispo.
- **Overlay** : fenêtre Tauri `overlay` créée depuis le JS (`overlay.ts`), transparente, `setIgnoreCursorEvents(true)`, état envoyé par `emitTo("overlay", "overlay:state")` toutes les 200 ms. `macOSPrivateApi` activé (transparence sur Mac).
- **Mise à jour** (`updater.ts`, `UpdateCard.tsx`) : plugin `updater` + `process` ; endpoint `releases/latest/download/latest.json`. Au lancement : `updateAtLaunch` (8 s max) installe d'office et relance (écran « Mise à jour en cours… »). Pendant l'utilisation : vérif toutes les 30 min, téléchargement en arrière-plan, **pop-up jamais pendant un vocal**, « Plus tard » → revient au prochain départ du vocal ; jamais de redémarrage tout seul. Version navigateur : `/version.json` (écrit par `~/maj-tomo.sh`) relu toutes les 10 min → pop-up « Recharger ». `GET /version` → `{ minClient }` (constante `MIN_CLIENT` dans `server/api/src/index.ts`) : en dessous, « Mise à jour obligatoire ».
- **Déploiement du serveur** : sur le VPS, un minuteur (`tomo-maj-auto.timer`, toutes les 5 min) lance `~/maj-tomo.sh` dès qu'il y a du nouveau sur `main` : **un `git push` met le serveur et la version web à jour tout seuls**, sans redémarrer LiveKit (le vocal continue). Donc ne pousser sur `main` que du code testé, et **garder l'API compatible avec la version précédente de l'appli** (ne pas supprimer / renommer une route ou un champ encore utilisé ; sinon monter `MIN_CLIENT`). Clé publique dans `tauri.conf.json`, **clé privée** dans `C:\Users\Kameron\.tauri\tomo-updater.key` (jamais dans le dépôt ; secret GitHub `TAURI_SIGNING_PRIVATE_KEY`).
- **Langues** : `t("texte français")` + `i18n-en.ts` ; changer de langue recharge la fenêtre ; les erreurs du serveur passent aussi par `t()` dans `errorMessage`.
- Clips : `AudioWorklet` → tampon circulaire → WAV écrit par Rust ; « Mettre au mur » l'envoie comme pièce jointe (type `audio/wav`).
- « Rester connecté » : jeton de renouvellement dans le coffre-fort du système (crate `keyring`).

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
- `client\scripts\dev.cmd` lance `npm run tauri dev`. Version web seule : `npm run dev` dans `client/` → http://localhost:1420 (une session par onglet).
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
(idem `test-social`, `test-attachments`, `test-profiles`, `test-messages`)
```bash
node server/api/tests/test-games.mjs
```
(idem `test-legends.mjs`, `test-stats.mjs`, `test-v09.mjs`, `test-email.mjs`)
```bash
cd client/src-tauri && cargo test --lib
```
Après une modification de l'API : `docker compose -f docker-compose.dev.yml up -d --build api` (dans `server/`).

**Publier une version** (installateurs + mise à jour automatique) : voir [docs/PUBLIER-UNE-VERSION.md](docs/PUBLIER-UNE-VERSION.md). En bref : même numéro dans `tauri.conf.json`, `Cargo.toml`, `package.json`, puis `git tag vX.Y.Z` et `git push origin vX.Y.Z`. La Release est **publiée directement** (plus de brouillon) avec `latest.json`. Il faut que le secret GitHub `TAURI_SIGNING_PRIVATE_KEY` existe.

**E-mails** : `SMTP_USER` / `SMTP_PASS` (Gmail + mot de passe d'application, voir `docs/HEBERGEMENT.md`).
**Clés facultatives** dans `server/.env` (dev et prod) : `KLIPY_API_KEY` (GIF), `STEAM_API_KEY` (stats Steam), `RIOT_API_KEY` (Riot / LoL ; la clé « development » expire toutes les 24 h).

---

## 5. Pièges déjà rencontrés (à connaître)

- **Windows PowerShell 5.1** : pas de `&&` ; l'**exécution de scripts .ps1 est bloquée** → passer par les `.cmd` (`powershell -ExecutionPolicy Bypass -File …`), ne pas modifier la politique système.
- **Fins de ligne mélangées** : certains fichiers sont en CRLF (`voice.ts`, `prefs.ts`, `Settings.tsx`…), d'autres en LF. Un script de remplacement doit normaliser en LF puis remettre le format d'origine.
- **Pas de Python** sur le PC : utiliser Node pour les petits scripts.
- **PowerShell et fichiers** : `[IO.File]` utilise un autre dossier courant que `cd` → toujours des chemins absolus (`"$PWD\…"`) ; les fichiers sources sont en fins de ligne LF : un remplacement de texte sur plusieurs lignes depuis PowerShell échoue → préférer l'outil d'édition. `Set-Content -Encoding utf8` ajoute un BOM (gênant dans un message de commit) → `[IO.File]::WriteAllText`.
- Message de commit avec guillemets ou accents → l'écrire dans un fichier et `git commit -F fichier`.
- **Chemin du projet trop long** → `LNK1104` : définir `CARGO_TARGET_DIR` vers un chemin court (`C:\t\tomo`).
- **PowerShell** : variables insensibles à la casse ; dans `"…"`, `${…}` et `` ` `` sont interprétés.
- **CORS** : `methods` explicitement configuré (PATCH/DELETE).
- **Limitation anti-force brute** : 10 essais/min/IP sur `/auth/*` → les tests attendent une minute et réessaient en cas de 429.
- **Même compte = même identité LiveKit** : deux connexions au même salon avec le même compte s'éjectent.
- **Attributs LiveKit** : il faut `canUpdateOwnMetadata` dans le jeton (sinon `setAttributes` échoue en silence) — y compris pour les bots de test.
- **Vite** : installer une nouvelle dépendance recharge la page en dev (pré-bundle) ; le worker des sous-titres impose `worker.format = "es"` dans `vite.config.ts`.
- **Overlay** : un jeu en **plein écran exclusif** passe par-dessus toutes les fenêtres → plein écran fenêtré / sans bordure.
- L'**overlay de performances NVIDIA** (Alt + R) peut s'afficher sur la fenêtre : ce n'est pas tomo.
- **Raccourcis sur Mac** : il faut l'autorisation « Surveillance de l'entrée » ; les lettres suivent la position QWERTY (pas la disposition AZERTY). Non testé sur Mac.
- **Échap pendant l'enregistrement d'un raccourci** : ne doit pas fermer les Paramètres (`isRecordingShortcut()`).
- Le navigateur intégré de Claude bloque le micro et la capture d'écran : tester ces parties dans l'appli de bureau (le propriétaire teste lui-même). Pour simuler, utiliser les bots (`lib/dev.ts`) depuis la console.

---

## 6. Charte graphique (validée)

- Fond graphite `#0E1014`, panneaux `#13161C`, cartes `#161920`, texte `#ECEEF3`.
- **Turquoise signal `#2DD4BF`** (actions, « qui parle »), **ambre écho `#FFB020`** (accents, statuts), rouge `#E5484D` (quitter, erreurs).
- Polices : **Space Grotesk** (titres), **Inter** (texte). Icônes en traits fins (composant `Icon` dans `Brand.tsx`), jamais d'emoji dans l'interface (sauf les réactions choisies par les gens).
- Logo : deux bulles qui se répondent (turquoise avec onde sonore, ambre) — composant `Logo`, icônes générées depuis `client/app-icon.svg` (`npx tauri icon app-icon.svg`).
- Maquettes de référence : https://claude.ai/artifact/ULPkHanxgN7nAbgsNQRk1X (v0.2–v0.6) et https://claude.ai/artifact/HVWgLBMvzvko38Gyi7npGU (v0.7–v0.8). L'appli fait foi.

---

## 7. Sécurité (règles à respecter)

- Mots de passe : scrypt (N=32768), 12 caractères min, comparaison à temps constant, hash factice si le pseudo n'existe pas.
- Connexion : après 5 échecs, blocage de l'**adresse + pseudo** (1, 2, 4, 8 puis 15 min) ; 50 échecs en 1 h sur un pseudo, toutes adresses confondues → 5 min pour tout le monde. Messages : 10 par 10 s **par compte**.
- Raccourcis : seules les touches choisies sont surveillées ; rien n'est enregistré ni envoyé.
- E-mail : visible seulement par soi (`/me`), jamais dans les profils ; changer d'adresse demande le mot de passe ; réinitialisation = toutes les sessions coupées.
- Jetons de renouvellement stockés **hachés**, rotation à chaque usage ; changement de mot de passe = toutes les sessions révoquées.
- Droits vérifiés **côté serveur** à chaque route (`access.ts`).
- **`DEV_TOOLS=1` uniquement en dev**. Ne jamais le mettre dans le `.env` du VPS.
- Ne jamais committer `.env`, ni la **clé privée de mise à jour** (`~/.tauri/tomo-updater.key`), ni aucun secret.
- Clips : rien n'est enregistré sans action de l'utilisateur, fichiers en local, icône visible par les autres.
- Jeux détectés : seuls les **noms** des programmes sont lus ; rien n'est envoyé si « Montrer à quoi je joue » est coupé ou si le jeu est masqué.
- Sous-titres, traduction, suppression de bruit : calculés sur le PC, rien n'est envoyé (seuls les modèles sont téléchargés une fois).
- Liaison Steam : réponse OpenID revérifiée auprès de Steam, état à usage unique.

---

## 8. Où en est-on / suite logique

Prochaines étapes possibles (à valider avec le propriétaire) :
1. **Déployer sur le VPS** de son ami (guide `docs/HEBERGEMENT.md`) pour tester à plusieurs : tant que ce n'est pas fait, ses potes peuvent installer tomo mais pas se connecter (le serveur ne tourne que sur son PC).
2. Tester en vrai ce qui n'a pas pu l'être ici : push-to-talk et raccourcis dans un jeu, overlay par-dessus un jeu, sous-titres à plusieurs, mode coach à plusieurs, liaison Steam, clé Riot, mise à jour d'une version à la suivante.
3. Mode radio, callouts, « qui est dispo ce soir ».
4. Paris : en attente d'une décision sur l'usage des points.
5. Petites améliorations listées dans la ROADMAP.
