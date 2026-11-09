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
│     lancés, clips, overlay,  │
│     touches des raccourcis   │
└──────────────────────────────┘          GitHub Releases : installateurs +
                                          latest.json (mise à jour automatique)
```

1. L'utilisateur se connecte (pseudo + mot de passe) : l'API renvoie un **jeton d'accès** (15 min) et un **jeton de renouvellement**.
2. Le client ouvre un **WebSocket** (`/ws?token=`) : messages, présence, « joue à … », appels, réactions… arrivent en direct.
3. Pour entrer dans une pièce vocale, l'API vérifie les droits et signe un **jeton LiveKit** limité à cette pièce. L'audio/vidéo passe par LiveKit (SFU), qui relaie chaque flux sans le décoder.

## Modèle de données (SQLite)

| Table | Contenu |
|---|---|
| `users` | pseudo, hash scrypt, adresse e-mail (privée, vérifiée ou non), nom affiché, photo/bannière, phrase, couleur, statut, confidentialité (`dm_policy`, `call_policy`, `friend_policy`, `show_game`, `show_last_seen`) |
| `sessions` | hash SHA-256 du jeton de renouvellement, expiration |
| `email_codes` | codes à 6 chiffres hachés : vérification d'adresse, mot de passe oublié, code de secours (5 essais, durée limitée) |
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
- **« Qui parle »** : mesuré localement toutes les 40 ms (`speaking.ts`) ; pour mon micro, sur ce qui part vraiment (après suppression de bruit, seuil, push-to-talk).
- **Appuyer pour parler** (`ptt.ts`) : la piste micro brute est désactivée (`enabled = false`) tant que la touche n'est pas tenue ; ce qui part est du silence. La coupure LiveKit (« micro coupé ») reste prioritaire. Délai de relâche réglable.
- **Baisser les autres quand je parle** (option) : quand « qui parle » me détecte, le volume de chaque voix reçue est multiplié par (1 − réglage), avec la montée douce de `setVolume`. Le son des partages d'écran n'est pas touché.
- **Changement de micro, de sortie, d'écho ou de gain auto** : appliqué tout de suite en vocal (`switchActiveDevice`, `restartTrack`).

### Audio spatial
Positions échangées sur le canal de données LiveKit (sujet `pos`, ~10/s). Source « carte » (chacun déplace son avatar) ou « jeu » (**Mumble Link**, lu par la partie Rust). Repli au centre si pas de position récente ou jeux différents. Réglable par jeu (Paramètres › Jeux).

### Jeux lancés
La partie Rust (`games.rs`, crate `sysinfo`) lit **uniquement les noms des programmes ouverts**, toutes les 10 s. `games.ts` les compare à une liste de jeux connus + ceux ajoutés à la main. Le jeu en cours sert au « joue à … », à la pièce automatique, au mode focus (notifications coupées sauf coéquipiers), à l'audio spatial et à l'overlay par jeu.

### Raccourcis (`hotkeys.ts` + `input.rs`)
La partie Rust lit l'**état** des touches toutes les 8 ms (Windows : `GetAsyncKeyState` ; Mac : `CGEventSourceKeyState`, avec l'autorisation « Surveillance de l'entrée »), sans crochet clavier : la touche n'est jamais bloquée, le jeu la reçoit. Elle ne surveille **que les touches des raccourcis** de la personne (liste envoyée par l'interface) ; seul l'enregistrement d'un nouveau raccourci, lancé par un clic, regarde toutes les touches pendant 15 s au plus. Les touches tenues sont envoyées à la fenêtre principale (`input:keys`), qui déclenche les actions. Dans le navigateur (ou sur Mac sans autorisation), repli sur le clavier de la fenêtre.

### Ranger les pièces et les fils
`PUT /servers/:id/rooms/order` et `/channels/order` (admins) avec la liste complète des identifiants dans le nouvel ordre ; refusée si elle ne correspond plus (quelqu'un vient d'en ajouter). Les membres connectés sont prévenus par l'événement `channels` et rechargent le serveur. Côté interface : `sortable.ts` (poignée, déplacement en direct, flèches du clavier).

### « En train d'écrire »
Le client envoie `{type:"typing", scope, target}` sur le WebSocket (au plus toutes les 3 s) ; le serveur (`typing.ts`) vérifie l'accès et relaie à ceux qui voient la conversation. Rien n'est enregistré.

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

### Mot de passe oublié
L'adresse e-mail est obligatoire et vérifiée par un code. « Mot de passe oublié » : on tape son pseudo ou son adresse, le serveur envoie un code à 6 chiffres (30 min, 5 essais) **seulement si l'adresse est vérifiée**, avec la même réponse dans tous les cas (on ne révèle pas si un compte existe). Avec le code, on choisit un nouveau mot de passe : toutes les sessions sont coupées. Envoi par SMTP (Brevo, gratuit). Sans e-mail, l'admin peut générer un code de secours sur le serveur (`node dist/cli-secours.js <pseudo>`, 1 h).

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
- **Anti force brute** : 10 tentatives/min/IP sur `/auth` ; après 5 échecs, l'**adresse + pseudo** est bloquée 1, 2, 4, 8 puis 15 min (quelqu'un qui rate exprès ne bloque pas le vrai propriétaire) ; 50 échecs en 1 h sur un pseudo depuis plusieurs adresses le bloquent 5 min.
- **Envoi de messages** : 10 messages par 10 s **par compte** (et une limite large par adresse, pour les potes derrière la même box).
- **Droits vérifiés côté serveur** à chaque route (`access.ts`).
- **Pièces jointes** : type déduit des octets, adresses signées, pas de SVG affiché, fichiers orphelins effacés.
- **Jetons LiveKit** limités à une pièce ; la clé secrète ne quitte jamais le serveur.
- **Liaison Steam** : réponse d'OpenID revérifiée auprès de Steam, état à usage unique (10 min).
- **Mises à jour** : refusées si la signature ne correspond pas à la clé publique intégrée à l'appli.
- **Vie privée** : jeux détectés, sous-titres, suppression de bruit et traduction calculés sur le PC ; le « joue à … » et les stats ne sont visibles que si on l'autorise. Raccourcis : seules les touches choisies sont surveillées, rien n'est enregistré ni envoyé.
