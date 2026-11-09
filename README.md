# tomo

> Le vocal pensé pour jouer entre potes. Gratuit, auto-hébergé, léger.
> *(anciennement Talk2Mates / T2M)*

**tomo** (« ami » en japonais) est une application de chat vocal pour les groupes d'amis qui jouent ensemble. Une alternative à Discord, avec des choses en plus : audio spatial (y compris la position lue dans le jeu), invités d'un soir sans compte, clips des dernières secondes, sous-titres et traduction calculés sur le PC, overlay en jeu, mode coach, mur des légendes…

Le projet est **100 % gratuit** : pas d'abonnement, pas de service payant, tout tourne sur votre propre serveur.

---

## ⬇️ Installer tomo

👉 **[Télécharger la dernière version](https://github.com/kameronramah/tomo/releases/latest)**

- **Windows** : `tomo_…_x64-setup.exe`, double-clic (pas besoin d'être administrateur).
- **Mac** (Intel et Apple) : `tomo_…_universal.dmg`, glisser tomo dans Applications. Premier lancement : clic droit › Ouvrir (l'app n'est pas signée par Apple).

Ensuite, tomo **se met à jour tout seul** (Paramètres › À propos). Au premier lancement, indique l'adresse de ton instance tomo (le serveur de ton groupe).

---

## ✨ Ce que fait tomo (v0.9)

**Vocal**
- Pièces vocales : qui parle (mesuré en direct), volume par personne, couper micro / son, choix du micro et de la sortie.
- **Appuyer pour parler** (touche ou bouton de souris) ou **seuil de voix** réglable, et en option **« baisser les autres quand je parle »**.
- **Raccourcis clavier configurables** qui marchent **en jeu** sans bloquer la touche (micro, son, clip, overlay, sous-titres…).
- **Volume uniformisé** : tout le monde au même niveau, sans rien régler.
- **Suppression de bruit avancée** (RNNoise, calculée sur ton PC) + porte de bruit, avec test « s'écouter » avant / après.
- **Audio spatial** : carte de la pièce ou **position lue dans le jeu** (Mumble Link : Minecraft avec mod, Guild Wars 2, Arma… ; Valheim devrait marcher avec le mod PositionalAudio, pas encore testé).
- **Clips** des 30 s / 1 min / 2 min passées, en un clic (Ctrl+Maj+C).
- **Partage d'écran** jusqu'en 4K, son du PC, plein écran, et **mode coach** : un pote demande à annoter, tu acceptes, et ses traits (crayon, flèche, ping) apparaissent directement sur ton écran ; capture envoyée dans le chat.
- **Sous-titres en direct + traduction** français ⇄ anglais, calculés sur ton PC (Whisper, Opus-MT).
- **Overlay en jeu** : qui parle, chat de la pièce et sous-titres par-dessus ton jeu (les clics le traversent).

**Jeux**
- **Jeu détecté** : « joue à … » sur ton profil, dans la liste des membres et sur la carte des pièces (désactivable).
- Paramètres par jeu : audio spatial, overlay, **pièce automatique**, **mode focus** (notifications coupées sauf coéquipiers), masquer.
- Proposition de rejoindre tes potes quand tu lances le même jeu qu'eux.
- **Stats** : Steam (heures jouées) et League of Legends (rang, dernières parties) sur la fiche profil.

**Social**
- Serveurs créés par les utilisateurs, rangés en **dossiers**, invitations membre ou **invité d'un soir sans compte**. Pièces et fils **rangés par glisser-déposer**.
- Fils de discussion, chat de chaque pièce, amis, messages privés (et demandes de message hors amis), **appels privés**.
- Messages : pièces jointes, messages vocaux, GIF (Klipy), **modifier**, **réactions**, **mentions** @pseudo / @vocal / @tous, « X est en train d'écrire… ».
- **Mur des légendes** : citations cultes, captures et clips épinglés.
- **Défis à points** : on se lance un défi, les participants valident le gagnant, classement du mois (pas d'argent, pas de mise).
- Comptes protégés : adresse e-mail vérifiée, **mot de passe oublié** par code envoyé par mail.
- Profils (photo, bannière, phrase, couleur), statuts (en ligne, inactif, ne pas déranger, invisible + statut perso), confidentialité, blocage.

**Appli**
- Notifications Windows / Mac, pastilles de non-lus, heures calmes, lancement avec l'ordinateur.
- **Français ou anglais** (Paramètres › Apparence).
- Mise à jour automatique, installateurs Windows et Mac.

👉 La suite est dans la [ROADMAP](ROADMAP.md).

---

## 🛠️ Stack technique

| Partie | Technologie |
|---|---|
| Client de bureau | [Tauri 2](https://tauri.app) (Rust) + React 19 + TypeScript + Vite |
| Audio / vidéo temps réel | [LiveKit](https://livekit.io), auto-hébergé (WebRTC, SFU) |
| API | Node.js 24 + TypeScript ([Fastify](https://fastify.dev)) + SQLite intégré (`node:sqlite`) |
| Traitement local | RNNoise (bruit), Whisper + Opus-MT via [Transformers.js](https://huggingface.co/docs/transformers.js) (sous-titres, traduction) |
| Sécurité | scrypt, JWT 15 min + renouvellement à rotation, limitation des tentatives |
| HTTPS | [Caddy](https://caddyserver.com) (Let's Encrypt automatique) |
| Distribution | GitHub Actions + Releases (installateurs signés pour la mise à jour automatique) |

Plus de détails dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## 📁 Structure du dépôt

```
tomo/
├── client/                     # Application de bureau tomo (Tauri + React)
├── server/
│   ├── api/                    # API Node/TypeScript (+ tests dans api/tests)
│   ├── docker-compose.yml      # Production (VPS)
│   ├── docker-compose.dev.yml  # Développement local
│   ├── livekit.yaml, Caddyfile, .env.example
├── .github/workflows/          # Installateurs Windows + Mac à chaque version
└── docs/
    ├── ARCHITECTURE.md
    ├── HEBERGEMENT.md          # Déployer sur un VPS
    └── PUBLIER-UNE-VERSION.md  # Sortir une version (installateurs + mise à jour auto)
```

---

## 🚀 Démarrage rapide (développeurs)

**En local** (Docker requis) :
```bash
cd server
docker compose -f docker-compose.dev.yml up --build
```
Puis lancer le client (voir [client/README.md](client/README.md)), créer un compte, puis un serveur.

**Sur un VPS :** voir [docs/HEBERGEMENT.md](docs/HEBERGEMENT.md).

---

## 💸 Coût

**0 €.** Uniquement des outils open source auto-hébergés et des offres gratuites (clés Klipy, Steam et Riot gratuites, modèles d'IA ouverts calculés sur le PC). Les fonctionnalités qui demanderaient de payer sont listées à part dans la [ROADMAP](ROADMAP.md#️-mis-de-côté).

## 📄 Licence

[MIT](LICENSE)
