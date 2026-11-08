# Client Tomo (Tauri + React)

Application de bureau Tomo :
- **connexion / création de compte / entrée comme invité** avec un code ;
- **sélecteur de serveur** (menu + accès rapide + Ctrl 1…9), création d'un serveur, rejoindre avec un code ;
- **salons en cartes** avec qui est dedans, passage d'un salon à l'autre en un clic ;
- **scène du salon vocal** : tuiles des participants, qui parle, volume par personne, dock (micro, son, périphériques, quitter), interrupteur d'audio spatial ;
- **gestion du serveur** pour les admins : salons, membres, invitations.

## Prérequis (Windows)
- [Node.js LTS](https://nodejs.org)
- [Rust](https://rustup.rs)
- « Visual Studio Build Tools » avec la charge de travail **C++** (voir https://tauri.app/start/prerequisites/)

En une fois avec winget :
```powershell
winget install OpenJS.NodeJS.LTS Rustlang.Rustup
winget install Microsoft.VisualStudio.2022.BuildTools --override "--wait --passive --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Développer en local

1. Lancer le serveur de dev (LiveKit + API) avec Docker :
   ```bash
   cd server
   docker compose -f docker-compose.dev.yml up --build
   ```
2. Lancer le client (Windows) :
   ```bash
   client\scripts\dev.cmd
   ```
   Le script recharge le PATH, vérifie que l'API de dev répond, installe les dépendances si besoin, puis lance `npm run tauri dev`. Il passe par un `.cmd` pour ne pas dépendre de la politique d'exécution des scripts PowerShell. Sur un autre système : `cd client && npm install && npm run tauri dev`.
3. L'appli pointe par défaut sur l'instance `http://localhost:3000` : crée un compte, puis un serveur.

> Astuce : `npm run dev` lance seulement la partie web sur http://localhost:1420. Chaque onglet a sa propre session : pratique pour simuler plusieurs joueurs.

### Compte de test et outils de test

Le serveur de dev crée automatiquement un **compte de test** : son pseudo et son mot de passe sont `DEV_USERNAME` / `DEV_PASSWORD` dans [`server/docker-compose.dev.yml`](../server/docker-compose.dev.yml). Connecté avec ce compte, une icône 🧪 en bas à gauche ouvre le panneau **Outils de test** :

| Outil | À quoi ça sert |
|---|---|
| Infos | instance, identité LiveKit, état et qualité de connexion, ping, version de LiveKit |
| Faux joueurs (+1 / +3 bots) | remplir un salon quand on teste seul ; ils « parlent » (bip doux) pour tester l'indicateur et les volumes |
| Retour micro | s'entendre soi-même pour régler son micro |
| Coupure courte / reconnexion complète | vérifier que l'appli se reconnecte toute seule |
| Jeton expiré / session perdue | vérifier le renouvellement automatique de session et le retour à l'écran de connexion |
| Faux membres | remplir la liste des membres d'un serveur (et les supprimer d'un clic) |
| Journal | les événements du salon en direct |

**Sécurité :** ces outils n'existent que si l'API tourne avec `DEV_TOOLS=1` (serveur de dev). En production (`docker-compose.yml`), les routes `/dev` n'existent pas et le compte de test n'est pas créé. **Ne mets jamais `DEV_TOOLS` dans le `.env` du VPS.**

### Tester l'audio spatial sans jeu

- **Carte** : active « Audio spatial » dans un salon, puis ajoute des bots (outils de test) : ils tournent autour de toi, et leur bip se déplace dans ton casque.
- **Connecteur de jeu** : lance le simulateur Mumble Link, qui fait croire à Tomo qu'un jeu compatible tourne :
  ```bash
  cd client/src-tauri
  cargo run --example mumble_sim
  ```
  La carte passe en « Position du jeu : Simulateur Tomo » et suit le joueur simulé. Ctrl+C pour arrêter : Tomo repasse sur la carte au bout de 2 s.
- Test automatique de la lecture Mumble Link : `cargo test --lib mumble`.

L'adresse de l'instance par défaut peut être fixée à la compilation : `VITE_TOMO_INSTANCE=https://tomo-api.duckdns.org npm run tauri build`.

## Construire l'exécutable
```bash
npm run tauri build
```
L'installateur se trouve ensuite dans `src-tauri/target/release/bundle/`.

> Si l'édition de liens échoue avec `LNK1104` : le chemin du projet est trop long pour Windows. Place le projet dans un dossier court (ex. `C:\dev\T2M`) ou définis `CARGO_TARGET_DIR` vers un chemin court.

## Structure
```
src/
├── App.tsx                  # état global : session, serveurs, vocal, fenêtres
├── App.css                  # charte Tomo (graphite, turquoise, ambre)
├── components/
│   ├── AuthScreen.tsx       # connexion, inscription, invité
│   ├── Sidebar.tsx          # sélecteur de serveur, salons, profil
│   ├── Home.tsx             # bienvenue, accueil d'un serveur, test du micro
│   ├── Stage.tsx            # salon vocal (tuiles + dock)
│   ├── Dialogs.tsx          # créer/rejoindre, inviter, gérer le serveur
│   └── Brand.tsx            # logo, icônes, avatars
└── lib/
    ├── api.ts               # client API + renouvellement de session
    ├── secure.ts            # coffre-fort (Gestionnaire d'identification Windows)
    ├── voice.ts             # connexion LiveKit, volumes, couper le son
    ├── prefs.ts             # préférences locales (instance, périphériques)
    └── ui.ts                # couleurs d'avatar, dates
src-tauri/                   # partie Rust : fenêtre, coffre-fort (keyring)
```
