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
nano .env   # API_DOMAIN, LIVEKIT_DOMAIN, LIVEKIT_URL (wss://<LIVEKIT_DOMAIN>), ACME_EMAIL,
            # clés LiveKit, JWT_SECRET (openssl rand -base64 48), REGISTRATION

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

### Ce que tes potes doivent faire
1. Installer tomo depuis https://github.com/kameronramah/tomo/releases/latest.
2. Au premier lancement, sur l'écran de connexion : « Instance : … modifier » → `https://<API_DOMAIN>` (l'adresse que tu leur donnes).
3. Créer leur compte, puis « Rejoindre avec un code » avec le code d'invitation que tu crées dans ton serveur (bouton « Inviter »).

Pour un invité d'un soir, pas besoin de compte : « J'ai un code invité » sur l'écran de connexion.

### Options gratuites (dans `.env`)
| Variable | À quoi ça sert | Où l'obtenir |
|---|---|---|
| `KLIPY_API_KEY` | Recherche de GIF dans les messages | https://partner.klipy.com |
| `STEAM_API_KEY` | Stats Steam sur les profils (heures jouées) | https://steamcommunity.com/dev/apikey (mettre le domaine de l'API) |
| `RIOT_API_KEY` | Liaison Riot + stats League of Legends | https://developer.riotgames.com — la clé « development » expire toutes les 24 h : demander une clé « personal » (gratuite) |

Sans ces clés, tomo marche normalement ; seules ces options sont désactivées. Après un changement : `docker compose up -d`.

> La liaison Steam renvoie le navigateur vers `https://<API_DOMAIN>/links/steam/callback` : l'API doit donc être joignable en HTTPS (c'est le cas avec Caddy).

### E-mails (mot de passe oublié) avec Brevo, gratuit
Chaque compte tomo a une adresse e-mail obligatoire. Elle sert à vérifier l'adresse et à envoyer un code quand on oublie son mot de passe. tomo envoie par SMTP : n'importe quel service marche, on utilise **Brevo** (gratuit jusqu'à 300 mails par jour).
1. Crée un compte sur https://www.brevo.com (offre gratuite).
2. **Authentifie ton domaine** : Paramètres › *Expéditeurs, domaines et IP dédiées* › *Domaines* › *Ajouter un domaine* (ex. `grylix.dev`). Brevo affiche 3 ou 4 enregistrements DNS (code Brevo, DKIM, DMARC) à ajouter chez l'hébergeur du domaine, puis *Authentifier*. Sans ça, les mails tombent en indésirables.
3. **Ajoute l'expéditeur** : *Expéditeurs* › *Ajouter un expéditeur* : nom `tomo`, adresse `noreply@<ton domaine>` (pas besoin de vraie boîte mail une fois le domaine authentifié).
4. **Crée une clé SMTP** : *SMTP et API* › onglet *SMTP* › *Générer une nouvelle clé SMTP*. Note l'**identifiant** affiché (du type `xxxxxx@smtp-brevo.com`) et la **clé** (affichée une seule fois).
5. Ajoute dans `.env` (ou `~/tomo-config/tomo.env`) :
   ```
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=xxxxxx@smtp-brevo.com
   SMTP_PASS=la-cle-smtp
   MAIL_FROM=noreply@grylix.dev
   ```
6. Redémarre l'API. `https://<API_DOMAIN>/auth/config` doit afficher `"mail":true`. Teste avec « Mot de passe oublié ».

Gmail marche aussi (`SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, un « mot de passe d'application ») mais Google bloque souvent les comptes récents.

Sans ces lignes, tomo marche, mais sans vérification d'adresse ni mot de passe oublié par e-mail (il reste le code de secours ci-dessous).

### Code de secours (mot de passe oublié sans accès à l'e-mail)
Sur le serveur, l'admin génère un code à usage unique, valable 1 h, et le donne à la personne. Elle le tape dans « Mot de passe oublié › J'ai déjà un code » :
```bash
node dist/cli-secours.js <pseudo>         # dans server/api, avec les variables de .env chargées
```
Avec Docker : `docker compose exec api node dist/cli-secours.js <pseudo>`.

## VPS partagé (ports 80/443 déjà pris)
Si le VPS a déjà un nginx ou un Caddy :
1. Retirer le service `caddy` de `docker-compose.yml`.
2. Ajouter dans le reverse proxy existant deux hôtes virtuels :
   - `API_DOMAIN` → `http://127.0.0.1:3000`
   - `LIVEKIT_DOMAIN` → `http://127.0.0.1:7880` (**avec le support WebSocket**)
3. Le reverse proxy doit transmettre la vraie adresse des joueurs (`X-Forwarded-For`, fait par défaut par Caddy ; avec nginx : `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`). Sinon, la protection contre les mots de passe devinés croit que tout le monde vient de la même adresse.

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
