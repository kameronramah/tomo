# 🎮 Talk2Mates (T2M)

> Le vocal pensé pour jouer entre potes. Gratuit, auto-hébergé, léger.

**Talk2Mates** est une application de chat vocal pour les groupes d'amis qui jouent ensemble, une alternative à Discord avec des fonctionnalités que Discord ne propose pas : écoute de plusieurs canaux à la fois, audio spatial activable, clip audio après coup, callouts vocaux, mode focus…

Le projet est **100 % gratuit** : pas d'abonnement, pas de service payant, tout tourne sur votre propre serveur.

---

## ✨ Fonctionnalités

### 🎧 Vocal
- **Salons vocaux** avec push-to-talk ou détection de voix
- **Mode radio** : écouter plusieurs salons à la fois, avec une touche de push-to-talk par salon
- **Volume normalisé automatiquement** : tout le monde au même niveau
- **Audio spatial activable** : un interrupteur par salon, un raccourci clavier et des profils par jeu (ex. ON pour Minecraft, OFF pour Valorant)
- **Haute qualité pour tous** (Opus), sans abonnement

### 🎬 Garder les bons moments
- **Clip audio après coup** : un raccourci enregistre les 30 à 60 dernières secondes du vocal
- **Mur des légendes** : épingler les citations cultes
- **Sous-titres en direct** et **traduction** (en local, optionnels)

### 🎮 Pensé pour le jeu
- **Détection du jeu lancé** : rejoindre le bon salon automatiquement et voir qui joue à quoi
- **Callouts rapides** : « Ennemi à gauche ! » en synthèse vocale, sur une touche
- **Mode focus / ranked** : seuls tes coéquipiers peuvent te parler, et plus aucune notification
- **Stats de jeu** (Steam, Riot) sur le profil
- **Partage d'écran avec annotation** (mode coach)

### 👥 Entre amis
- **« Qui est dispo ce soir ? »** : créneaux habituels et suggestion du meilleur moment
- **Défis et paris amicaux** avec points virtuels et classement

### 🔒 Vie privée
- **Auto-hébergé** : vos données restent sur votre serveur
- **Client léger** (Tauri), bien moins gourmand qu'une application Electron

👉 Le détail et l'ordre de développement sont dans la [ROADMAP](ROADMAP.md).

---

## 🛠️ Stack technique

| Partie | Technologie |
|---|---|
| Client de bureau | [Tauri 2](https://tauri.app) (Rust) + React + TypeScript |
| Audio / vidéo temps réel | [LiveKit](https://livekit.io), auto-hébergé (WebRTC, SFU) |
| API (comptes, salons, tokens) | Node.js + TypeScript ([Fastify](https://fastify.dev)) + SQLite |
| HTTPS / reverse proxy | [Caddy](https://caddyserver.com) (certificats Let's Encrypt automatiques) |
| Nom de domaine | [DuckDNS](https://www.duckdns.org) (gratuit) ou domaine existant |
| Synthèse vocale (callouts) | [Piper](https://github.com/rhasspy/piper), en local |
| Transcription | [whisper.cpp](https://github.com/ggerganov/whisper.cpp), en local |
| Distribution | GitHub Releases + GitHub Actions |

Plus de détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📁 Structure du dépôt

```
T2M/
├── client/          # Application de bureau (Tauri + React) — à initialiser
├── server/
│   ├── api/         # API Node/TypeScript : génération des tokens LiveKit
│   ├── docker-compose.yml
│   ├── livekit.yaml
│   ├── Caddyfile
│   └── .env.example
└── docs/
    ├── ARCHITECTURE.md
    └── HEBERGEMENT.md   # Déployer sur un VPS
```

---

## 🚀 Démarrage rapide (serveur)

Prérequis : un VPS Linux avec Docker, et un nom de domaine (DuckDNS suffit).

```bash
git clone https://github.com/<toi>/T2M.git
cd T2M/server
cp .env.example .env      # puis remplir les valeurs
docker compose up -d
```

Le guide complet, avec les ports à ouvrir et le pare-feu, est dans [docs/HEBERGEMENT.md](docs/HEBERGEMENT.md).

---

## 💸 Coût

**0 €.** Le projet n'utilise que des outils open source auto-hébergés et des offres gratuites. Les fonctionnalités qui demanderaient de payer sont listées à part dans la [ROADMAP](ROADMAP.md#-mis-de-côté).

---

## 📄 Licence

[MIT](LICENSE)
