# 🖥️ Héberger tomo sur un VPS

## Ce qu'il faut demander au propriétaire du VPS

| Question | Pourquoi |
|---|---|
| Système Linux (Debian/Ubuntu) avec **Docker** installable ? | Tout tourne en conteneurs |
| Ressources libres : **1 vCPU, 1 Go de RAM** minimum | Suffisant pour ~10 personnes en audio |
| Peut-on **ouvrir les ports** listés ci-dessous ? | Indispensable pour WebRTC |
| Les ports **80 et 443** sont-ils déjà utilisés (nginx, Apache…) ? | Si oui, voir « VPS partagé » plus bas |
| Bande passante / trafic mensuel inclus ? | Voir l'estimation ci-dessous |

### Estimation de bande passante (audio uniquement)
Une voix Opus fait environ 48 kbit/s. Avec **N** personnes dans un salon, le serveur envoie N × (N−1) flux.

| Joueurs | Débit sortant du serveur | Trafic pour 4 h/soir, 30 soirs |
|---|---|---|
| 5 | ~1 Mbit/s | ~55 Go/mois |
| 10 | ~4,3 Mbit/s | ~230 Go/mois |

En pratique, c'est moins : LiveKit n'envoie rien quand quelqu'un ne parle pas (DTX). Le partage d'écran consomme beaucoup plus.

## Ports à ouvrir

| Port | Protocole | Usage |
|---|---|---|
| 80 | TCP | Caddy : validation Let's Encrypt |
| 443 | TCP | Caddy : HTTPS (API + signalisation LiveKit) |
| 7881 | TCP | LiveKit : média en repli TCP |
| 3478 | UDP | LiveKit : TURN intégré |
| 50000–60000 | UDP | LiveKit : média WebRTC |

Exemple avec `ufw` :
```bash
sudo ufw allow 80,443,7881/tcp
sudo ufw allow 3478/udp
sudo ufw allow 50000:60000/udp
```
Certains hébergeurs ont **en plus** un pare-feu dans leur interface web (OVH, Hetzner, Oracle…) : il faut y ouvrir les mêmes ports.

## Nom de domaine gratuit (DuckDNS)
1. Se connecter sur https://www.duckdns.org.
2. Créer deux sous-domaines pointant vers l'IP du VPS, par exemple `tomo-api` et `tomo-rtc`.
3. On obtient `tomo-api.duckdns.org` et `tomo-rtc.duckdns.org`.

Si le VPS a déjà un domaine, on peut aussi utiliser des sous-domaines de celui-ci (`api.tomo.mondomaine.fr`…).

## Installation

```bash
# 1. Installer Docker (si absent)
curl -fsSL https://get.docker.com | sh

# 2. Récupérer le projet
git clone https://github.com/kameronramah/tomo.git
cd tomo/server

# 3. Configurer
cp .env.example .env
nano .env   # domaines, clés LiveKit, JWT_SECRET (openssl rand -base64 48), REGISTRATION

# 4. Générer une paire de clés LiveKit et la coller dans .env
docker run --rm livekit/livekit-server generate-keys

# 5. Lancer
docker compose up -d --build
docker compose logs -f
```

### Vérifier que ça marche
- `https://<API_DOMAIN>/health` doit répondre `{"ok":true}`.
- Dans l'appli tomo : sur l'écran de connexion, « Instance : … modifier » → `https://<API_DOMAIN>`, puis crée ton compte et ton serveur.
- Une fois tes potes inscrits, tu peux fermer les inscriptions avec `REGISTRATION=closed` dans `.env` (puis `docker compose up -d`).

### Options gratuites (dans `.env`)
| Variable | À quoi ça sert | Où l'obtenir |
|---|---|---|
| `KLIPY_API_KEY` | Recherche de GIF dans les messages | https://partner.klipy.com |
| `STEAM_API_KEY` | Stats Steam sur les profils (heures jouées) | https://steamcommunity.com/dev/apikey (mettre le domaine de l'API) |
| `RIOT_API_KEY` | Liaison Riot + stats League of Legends | https://developer.riotgames.com — la clé « development » expire toutes les 24 h : demander une clé « personal » (gratuite) |

Sans ces clés, tomo marche normalement ; seules ces options sont désactivées. Après un changement : `docker compose up -d`.

> La liaison Steam renvoie le navigateur vers `https://<API_DOMAIN>/links/steam/callback` : l'API doit donc être joignable en HTTPS (c'est le cas avec Caddy).

## VPS partagé (ports 80/443 déjà pris)
Si le VPS a déjà un nginx ou un Caddy :
1. Retirer le service `caddy` de `docker-compose.yml`.
2. Ajouter dans le reverse proxy existant deux hôtes virtuels :
   - `API_DOMAIN` → `http://127.0.0.1:3000`
   - `LIVEKIT_DOMAIN` → `http://127.0.0.1:7880` (**avec le support WebSocket**)

## Mises à jour
```bash
cd tomo && git pull
cd server && docker compose up -d --build
```

Les applis des joueurs, elles, se mettent à jour toutes seules depuis GitHub (voir [PUBLIER-UNE-VERSION.md](PUBLIER-UNE-VERSION.md)). Pense à mettre à jour le serveur en même temps qu'une nouvelle version de l'appli.

## Sauvegarde
Toute la base (comptes, serveurs, messages, mur des légendes, défis…) tient dans un fichier SQLite du volume `api-data`, et les pièces jointes dans `uploads/` du même volume.
```bash
docker compose stop api
docker compose cp api:/data/. ./sauvegarde-tomo/
docker compose start api
```
