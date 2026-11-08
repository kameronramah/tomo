# 🏗️ Architecture

## Vue d'ensemble

```
        PC des joueurs                                   VPS
┌──────────────────────────┐              ┌────────────────────────────────┐
│  Client Talk2Mates (Tauri)  │   HTTPS      │  Caddy (443)                   │
│  ├─ UI React             │ ───────────▶ │   ├─ api.<domaine>  → API :3000│
│  ├─ livekit-client (JS)  │              │   └─ rtc.<domaine>  → LiveKit  │
│  ├─ Web Audio (volume,   │   WebRTC     │                       :7880    │
│  │  spatial, clips)      │ ◀══════════▶ │  LiveKit (SFU)                 │
│  └─ Rust (raccourcis     │  UDP/TCP     │   ├─ UDP 50000-60000 (média)   │
│     globaux, détection   │              │   ├─ TCP 7881 (repli)          │
│     du jeu, overlay)     │              │   └─ TURN UDP 3478             │
└──────────────────────────┘              │  API (Node + SQLite)           │
                                          └────────────────────────────────┘
```

1. Le client demande un **token** à l'API (pseudo + code d'invitation + salon).
2. L'API vérifie le code et signe un token LiveKit (JWT) valable pour ce salon.
3. Le client se connecte à LiveKit avec ce token. L'audio transite par le SFU, qui relaie chaque voix aux autres sans la décoder.

## Pourquoi ces choix

- **LiveKit** : serveur WebRTC open source (Apache 2.0) qui gère salons, audio, vidéo, partage d'écran et canaux de données. On n'a pas à écrire de serveur média.
- **SFU plutôt que pair-à-pair** : chaque joueur n'envoie son audio qu'une fois, ce qui marche bien au-delà de 4 personnes.
- **Tauri** : application de bureau bien plus légère qu'Electron (utilise le WebView du système). La partie Rust gère ce que le web ne sait pas faire : raccourcis globaux, liste des processus, overlay.
- **SQLite** : zéro administration, un seul fichier, largement suffisant pour un groupe d'amis.
- **Caddy** : HTTPS automatique avec Let's Encrypt, configuration en quelques lignes.

## Comment les fonctionnalités clés seront réalisées

### Volume normalisé
Côté client : chaque piste audio reçue passe dans un `DynamicsCompressorNode` (Web Audio) puis un gain, avant la sortie. Aucun traitement serveur.

### Clip audio après coup
Le client mixe toutes les voix (et le micro) dans un `MediaStreamAudioDestinationNode`, enregistré en continu dans un **tampon circulaire** de 60 s. Sur le raccourci, le tampon est exporté en `.ogg` (Opus).

### Mode radio (plusieurs salons)
Le client ouvre **plusieurs connexions `Room` LiveKit** en parallèle. Chaque salon a son volume, et le micro n'est publié que dans le salon dont la touche de push-to-talk est enfoncée.

### Audio spatial activable
- **État** : stocké dans les **métadonnées du salon** LiveKit (`{"spatial": true}`), modifiées via l'API. Tous les participants, y compris ceux qui arrivent plus tard, voient le même état.
- **Positions** : chaque client envoie sa position en jeu (x, y, z, orientation) environ 10 fois par seconde via les **data channels** LiveKit (mode `lossy`).
- **Rendu** : chaque voix reçue passe dans un `PannerNode` (HRTF) positionné relativement au joueur local.
- **Bascule** : si `spatial = false`, ou si un participant n'envoie pas de position depuis plus de 2 s, son panner est contourné et on revient à l'audio normal.
- **Profils par jeu** : à la détection d'un jeu, le client propose (ou applique, selon les réglages) le mode par défaut du profil. L'interrupteur manuel garde toujours le dernier mot.
- **Sources de positions** : un connecteur par jeu (mod Minecraft, API de jeu, mémoire partagée façon « Mumble Link »).

### Callouts rapides
Phrases pré-générées avec **Piper** au premier lancement (cache local), puis publiées comme une piste audio courte dans le salon.

### Détection du jeu
La partie Rust de Tauri liste les processus (crate `sysinfo`) et les compare à une table `processus → jeu` versionnée dans le dépôt.

## Sécurité
- Accès au serveur par **code d'invitation**, à remplacer en V1 par de vrais comptes.
- Tokens LiveKit à durée courte, signés par l'API. La clé secrète LiveKit ne quitte jamais le serveur.
- Tout passe en HTTPS / DTLS-SRTP (WebRTC chiffre toujours le média en transit).
