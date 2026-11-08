# Tomo

> Le vocal pensé pour jouer entre potes. Gratuit, auto-hébergé, léger.
> *(anciennement Talk2Mates / T2M)*

**Tomo** (« ami » en japonais) est une application de chat vocal pour les groupes d'amis qui jouent ensemble. C'est une alternative à Discord, avec des fonctionnalités en plus : audio spatial activable, invités d'un soir sans compte, clip audio des 60 dernières secondes, mode focus…

Le projet est **100 % gratuit** : pas d'abonnement, pas de service payant, tout tourne sur votre propre serveur.

---

## ✨ Ce qui marche déjà (v0.5)

- **Partage d'écran haute qualité** : jusqu'à 1080p 60 i/s (jeux) ou 4K (texte, détails), son du PC, plein écran, versions allégées automatiques pour les petites connexions.

- **Audio spatial** : carte du salon où chacun déplace son avatar, voix en 3D selon la distance et la direction, et **position lue directement dans le jeu** (Mumble Link : Minecraft avec mod, Guild Wars 2, Arma…).
- **Clip des 60 dernières secondes** : un clic ou Ctrl+Maj+C, le fichier arrive dans Musique\Tomo Clips.

- **Messagerie** : salons textuels dans chaque serveur, chat dans chaque salon vocal, **amis** et **messages privés**, en temps réel.
- **Appels privés** entre amis, avec sonnerie.
- **Sons d'interface** (rejoindre, quitter, micro coupé, message, sonnerie) et **ping / qualité réseau** toujours visibles.
- **Espace Paramètres** : compte, audio et micro, sons, apparence, raccourcis, réseau.


- **Comptes sécurisés** : pseudo + mot de passe, session gardée dans le coffre-fort de Windows (« rester connecté »).
- **Serveurs créés par les utilisateurs**. Aucun serveur n'existe au départ : celui qui crée un serveur en est l'**admin**.
- **Gestion complète par l'admin** : salons (créer, renommer, supprimer), membres (nommer admin, exclure), invitations, nom du serveur, suppression.
- **Invitations** :
  - **code membre** : un ami avec un compte rejoint le serveur ;
  - **code invité** : quelqu'un **sans compte** rejoint le temps d'une soirée (1 à 24 h), puis son accès s'arrête tout seul.
- **Salons vocaux** : qui parle, volume par personne, couper micro et son, choix micro et sortie, test du micro avant d'entrer.
- **Changement de serveur et de salon en un clic** (et Ctrl + 1…9), sans quitter son vocal pour parcourir un autre serveur.
- **Interrupteur d'audio spatial** par salon, synchronisé pour tout le monde (le rendu 3D arrive en V2).

👉 La suite est dans la [ROADMAP](ROADMAP.md).

---

## 🛠️ Stack technique

| Partie | Technologie |
|---|---|
| Client de bureau | [Tauri 2](https://tauri.app) (Rust) + React + TypeScript |
| Audio / vidéo temps réel | [LiveKit](https://livekit.io), auto-hébergé (WebRTC, SFU) |
| API (comptes, serveurs, salons, invitations) | Node.js 24 + TypeScript ([Fastify](https://fastify.dev)) + SQLite intégré (`node:sqlite`) |
| Sécurité | scrypt (mots de passe), JWT 15 min + jetons de renouvellement à rotation, limitation des tentatives |
| HTTPS / reverse proxy | [Caddy](https://caddyserver.com) (certificats Let's Encrypt automatiques) |
| Distribution | GitHub Releases |

Plus de détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📁 Structure du dépôt

```
T2M/
├── client/                  # Application de bureau Tomo (Tauri + React)
├── server/
│   ├── api/                 # API Node/TypeScript
│   ├── docker-compose.yml   # Production (VPS)
│   ├── docker-compose.dev.yml  # Développement local
│   ├── livekit.yaml
│   ├── Caddyfile
│   └── .env.example
└── docs/
    ├── ARCHITECTURE.md
    └── HEBERGEMENT.md       # Déployer sur un VPS
```

---

## 🚀 Démarrage rapide

**En local** (Docker requis) :
```bash
cd server
docker compose -f docker-compose.dev.yml up --build
```
Puis lancer le client (voir [client/README.md](client/README.md)), créer un compte, puis un serveur.

**Sur un VPS :** voir [docs/HEBERGEMENT.md](docs/HEBERGEMENT.md).

---

## 💸 Coût

**0 €.** Uniquement des outils open source auto-hébergés et des offres gratuites. Les fonctionnalités qui demanderaient de payer sont listées à part dans la [ROADMAP](ROADMAP.md#-mis-de-côté).

## 📄 Licence

[MIT](LICENSE)
