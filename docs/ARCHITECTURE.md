# 🏗️ Architecture

## Vue d'ensemble

```
        PC des joueurs                                   VPS
┌──────────────────────────────┐          ┌────────────────────────────────┐
│  Client tomo (Tauri 2)       │  HTTPS   │  Caddy (443)                   │
│  ├─ UI React (+ overlay)     │ ───────▶ │   ├─ api.<domaine>  → API :3000│
│  ├─ livekit-client (JS)      │  WS      │   └─ rtc.<domaine>  → LiveKit  │
│  ├─ Web Audio : volume       │          │                       :7880    │
│  │  uniformisé, spatial,     │  WebRTC  │  LiveKit (SFU)                 │
│  │  clips, RNNoise           │ ◀══════▶ │   ├─ UDP 50000-60000 (média)   │
│  ├─ Fil de calcul : Whisper  │          │   ├─ TCP 7881 (repli)          │
│  │  + Opus-MT (sous-titres)  │          │   └─ TURN UDP 3478             │
│  └─ Rust : coffre-fort,      │          │  API (Node 24 + SQLite)        │
│     Mumble Link, jeux        │          └────────────────────────────────┘
│     lancés, clips, overlay   │
└──────────────────────────────┘          GitHub Releases : installateurs +
                                          latest.json (mise à jour automatique)
```

1. L'utilisateur se connecte (pseudo + mot de passe) : l'API renvoie un **jeton d'accès** (15 min) et un **jeton de renouvellement**.
2. Le client ouvre un **WebSocket** (`/ws?token=`) : messages, présence, « joue à … », appels, réactions… arrivent en direct.
3. Pour entrer dans une pièce vocale, l'API vérifie les droits et signe un **jeton LiveKit** limité à cette pièce. L'audio/vidéo passe par LiveKit (SFU), qui relaie chaque flux sans le décoder.

## Modèle de données (SQLite)

| Table | Contenu |
|---|---|
| `users` | pseudo, hash scrypt, nom affiché, photo/bannière, phrase, couleur, statut, confidentialité (`dm_policy`, `call_policy`, `friend_policy`, `show_game`, `show_last_seen`) |
| `sessions` | hash SHA-256 du jeton de renouvellement, expiration |
| `servers`, `members` | serveurs et rôles (`owner`, `admin`, `member`) |
| `rooms`, `channels` | pièces vocales (audio spatial ON/OFF) et fils de discussion |
| `invites` | codes membre ou invité d'un soir |
| `messages`, `message_reactions` | messages (modifiables, `edited_at`), réactions emoji |
| `attachments` | pièces jointes (fichier dans `DATA_DIR/uploads`) ; `message_id` = message, `profile:<id>` ou `legend:<id>` |
| `friendships`, `blocks`, `dm_state` | amis, blocages, demandes de message acceptées / ignorées |
| `legends`, `legend_reactions` | mur des légendes (citations, images, clips) |
| `challenges`, `challenge_players`, `challenge_votes`, `points` | défis à points et classement du mois |
| `game_accounts` | Steam (SteamID), Riot (PUUID, Riot ID, région), qui voit mes stats |

Le « joue à … » n'est pas en base : chaque connexion WebSocket annonce son jeu, le serveur le garde en mémoire et ne le montre que si `show_game` est activé.

| Action | Membre | Admin | Créateur |
|---|---|---|---|
| Pièces, fils, code membre, épingler au mur, lancer un défi | ✅ | ✅ | ✅ |
| Créer / renommer / supprimer pièces et fils, codes invités, exclure, @tous, retirer une légende ou annuler un défi des autres | | ✅ | ✅ |
| Nommer / retirer des admins, supprimer le serveur | | | ✅ |

Un **invité** (code invité, sans compte) a un jeton limité à **un seul serveur**, qui expire avec le code.

## Comment marchent les fonctionnalités

### Audio
- **Chaîne par voix reçue** (`setWebAudioPlugins`, en ligne droite) : **volume uniformisé** (`leveler.ts`) puis **audio spatial** (`PannerNode` HRTF) si la pièce l'a activé. Le son d'un partage d'écran n'est jamais traité.
- **Micro** : suppression de bruit « légère » (filtre du navigateur) ou « avancée » (**RNNoise** en AudioWorklet, `denoise.ts`), plus une **porte de bruit** réglable. Branché sur la piste LiveKit avec `setProcessor` : ce qui part est le son nettoyé.
- **« Qui parle »** : mesuré localement toutes les 40 ms (`speaking.ts`).

### Audio spatial
Positions échangées sur le canal de données LiveKit (sujet `pos`, ~10/s). Source « carte » (chacun déplace son avatar) ou « jeu » (**Mumble Link**, lu par la partie Rust). Repli au centre si pas de position récente ou jeux différents. Réglable par jeu (Paramètres › Jeux).

### Jeux lancés
La partie Rust (`games.rs`, crate `sysinfo`) lit **uniquement les noms des programmes ouverts**, toutes les 10 s. `games.ts` les compare à une liste de jeux connus + ceux ajoutés à la main. Le jeu en cours sert au « joue à … », à la pièce automatique, au mode focus (notifications coupées sauf coéquipiers), à l'audio spatial et à l'overlay par jeu.

### Overlay en jeu
Une seconde fenêtre Tauri (`label: overlay`), transparente, toujours au-dessus, **traversée par les clics** (`setIgnoreCursorEvents`). La fenêtre principale lui envoie son état (qui parle, chat, sous-titres) par événement Tauri toutes les 200 ms. Elle n'a aucune autre permission. Marche avec les jeux en plein écran fenêtré / sans bordure.

### Sous-titres et traduction
Un fil de calcul (`captions.worker.ts`) charge **Whisper** (reconnaissance) et **Opus-MT** (traduction FR ⇄ EN) avec Transformers.js, sur la carte graphique (WebGPU) ou le processeur. Les modèles sont téléchargés une fois depuis Hugging Face puis gardés en cache. Chaque voix reçue est découpée en phrases (silence de 0,7 s) puis transcrite dans la langue de la personne (attribut LiveKit `lang`). Rien ne sort du PC.

### Mode coach
Annotations (crayon, flèche, ping) sur un partage d'écran, échangées sur le canal de données LiveKit (sujet `coach`) en coordonnées 0..1 de l'image. Un pote **demande** à annoter (message `ask`), celui qui partage **accepte ou refuse** ; les personnes autorisées sont dans son attribut `coach` (`all` ou liste d'identités) et les traits des autres sont ignorés par tout le monde. Chez celui qui partage, les traits s'affichent **sur son écran réel** : fenêtre Tauri `coach-screen` plein écran, transparente, traversée par les clics, posée sur l'écran partagé (reconnu à sa taille ; pour un partage de fenêtre, seulement dans tomo). « Capturer » envoie l'image annotée dans le chat de la pièce.

### Clips
`AudioWorklet` → tampon circulaire en mémoire (30 s à 2 min) → WAV écrit par Rust dans Musique\tomo Clips. Un clip peut être mis au **mur des légendes** (envoyé comme pièce jointe).

### Mise à jour automatique
Plugin `updater` de Tauri. GitHub Actions construit les installateurs à chaque tag `v*`, les **signe** (clé privée dans les secrets du dépôt) et publie `latest.json` dans la Release. L'appli vérifie au démarrage puis toutes les 6 h, télécharge en arrière-plan et propose de redémarrer. Pas de canal bêta.

### Stats de jeu
- **Steam** : liaison par la connexion officielle Steam (OpenID 2.0, vérifiée par l'API) ; heures jouées sur 2 semaines via l'API Web Steam (`STEAM_API_KEY`).
- **Riot** : liaison par Riot ID (la connexion officielle RSO est réservée aux applis validées) ; rang et dernières parties de League of Legends (`RIOT_API_KEY`). Réponses gardées 10 min en mémoire.

### Langues
`i18n.ts` : le texte est écrit en français dans le code (`t("Paramètres")`), `i18n-en.ts` le traduit. Un texte absent du dictionnaire reste en français.

## Pourquoi ces choix
- **LiveKit** : serveur WebRTC open source (Apache 2.0) : salons, audio, vidéo, partage d'écran, canaux de données.
- **SFU plutôt que pair-à-pair** : chacun n'envoie son flux qu'une fois.
- **Tauri** : bien plus léger qu'Electron ; la partie Rust fait ce que le web ne sait pas faire (coffre-fort, mémoire partagée Mumble Link, liste des programmes, fenêtres transparentes).
- **SQLite** : zéro administration, un seul fichier.
- **Caddy** : HTTPS automatique.
- **Transformers.js plutôt que whisper.cpp natif** : même modèle Whisper, mais rien à compiler pour Windows et Mac, et utilisation de la carte graphique via WebGPU.

## Sécurité
- **Mots de passe** : 12 caractères minimum, **scrypt** (N=32768), comparaison à temps constant, hash factice si le pseudo n'existe pas.
- **Sessions** : JWT de 15 min en mémoire + jeton de renouvellement **haché** côté serveur et **remplacé à chaque usage**.
- **« Rester connecté »** : jeton rangé dans le coffre-fort du système (crate `keyring`).
- **Anti force brute** : 10 tentatives/min/IP sur `/auth`, pseudo bloqué 15 min après 5 échecs.
- **Droits vérifiés côté serveur** à chaque route (`access.ts`).
- **Pièces jointes** : type déduit des octets, adresses signées, pas de SVG affiché, fichiers orphelins effacés.
- **Jetons LiveKit** limités à une pièce ; la clé secrète ne quitte jamais le serveur.
- **Liaison Steam** : réponse d'OpenID revérifiée auprès de Steam, état à usage unique (10 min).
- **Mises à jour** : refusées si la signature ne correspond pas à la clé publique intégrée à l'appli.
- **Vie privée** : jeux détectés, sous-titres, suppression de bruit et traduction calculés sur le PC ; le « joue à … » et les stats ne sont visibles que si on l'autorise.
