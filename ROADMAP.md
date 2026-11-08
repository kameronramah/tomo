# 🗺️ Roadmap

Les versions sont classées par ordre de priorité. Chaque case cochée = fonctionnalité livrée.

---

## V0.1 — Fondations ✅
- [x] Serveur de dev local (`server/docker-compose.dev.yml`)
- [x] Client Tauri : rejoindre un salon vocal et entendre les autres
- [x] Choix du micro et de la sortie audio, volume par personne, indicateur « qui parle »
- [x] Test avec un vrai micro

## V0.2 — Tomo : comptes, serveurs, nouvelle interface ✅
- [x] Nouveau nom (**Tomo**), logo et charte, interface selon les maquettes validées
- [x] Comptes sécurisés : scrypt, sessions 15 min + renouvellement à rotation, blocage après 5 échecs, limitation par IP
- [x] « Rester connecté » via le coffre-fort de Windows
- [x] Serveurs créés par les utilisateurs (créateur = admin), aucun serveur par défaut
- [x] Gestion par l'admin : salons, membres (admin / exclure), invitations, renommer, supprimer
- [x] Codes membres + **codes invités d'un soir sans compte**
- [x] Changement de serveur/salon en un clic, Ctrl + 1…9, parcourir un serveur sans quitter son vocal
- [x] Couper micro / son, test du micro avant d'entrer
- [x] Interrupteur d'audio spatial par salon (état synchronisé ; rendu 3D en V2)
- [ ] Serveur déployé sur le VPS (LiveKit + Caddy + API)
- [ ] Test à plusieurs, chacun chez soi

## V0.3 — Messagerie, appels, paramètres ✅
- [x] Temps réel (WebSocket) : messages, présence, appels
- [x] Salons textuels par serveur (créer / renommer / supprimer par les admins)
- [x] Chat de chaque salon vocal (panneau à droite de la scène)
- [x] Amis : demande par pseudo, accepter / refuser, en ligne / hors ligne
- [x] Messages privés entre amis, non-lus et notifications
- [x] Appels privés entre amis : sonnerie, accepter / refuser, raccrocher
- [x] Sons d'interface (rejoindre, quitter, arrivées, micro, messages, sonnerie), réglables
- [x] Ping et qualité réseau visibles (bloc « En vocal », scène, Paramètres > Réseau)
- [x] Espace Paramètres : compte (mot de passe, appareils), audio, sons, apparence (zoom, compact, animations), raccourcis, réseau
- [x] Raccourcis Ctrl+Maj+M (micro), Ctrl+Maj+D (son), Ctrl+, (paramètres)
- [x] Compte de test et outils de test (serveur de dev uniquement)

## V1 — MVP « on lâche Discord »
> Objectif : utilisable tous les soirs par le groupe.

- [x] Changer son mot de passe, voir ses appareils connectés
- [ ] Changer son pseudo, photo de profil
- [ ] Modifier un message, réactions, mentions @pseudo, envoi d'images
- [ ] Réordonner les salons par glisser-déposer
- [ ] **Volume normalisé automatiquement** (compresseur / AGC sur chaque voix reçue)
- [ ] Suppression de bruit (RNNoise ou celle du navigateur)
- [x] **Clip audio après coup** : tampon de 60 s en mémoire, bouton du dock ou Ctrl+Maj+C → fichier `.wav` dans Musique\Tomo Clips, liste et écoute dans Paramètres > Clips, icône visible par les autres quand les clips sont activés
- [x] Chat texte par salon (salons textuels + chat des salons vocaux)
- [ ] Mise à jour automatique du client via GitHub Releases

## V2 — Pensé pour le jeu
- [ ] **Détection du jeu lancé** (liste des processus) + statut « joue à … »
- [ ] Rejoindre automatiquement le salon du jeu (optionnel)
- [ ] **Mode focus / ranked** : notifications coupées, whitelist de coéquipiers
- [ ] **Callouts rapides** : touches → phrases en synthèse vocale (Piper, local)
- [ ] **Mode radio** : connecté à plusieurs salons, un push-to-talk par salon, volume par salon
- [ ] **Audio spatial activable**
  - [x] Interrupteur ON/OFF **par salon**, synchronisé pour tout le monde
  - [x] Rendu 3D des voix (PannerNode HRTF), volume selon la distance, portée réglable
  - [x] **Carte du salon** : chacun déplace son avatar (marche avec tous les jeux)
  - [x] **Connecteur Mumble Link** : position lue dans le jeu (Minecraft avec mod, GW2, Arma…), prioritaire sur la carte
  - [x] Repli automatique en audio normal si pas de position récente ou jeux / serveurs différents
  - [x] Simulateur Mumble Link (`cargo run --example mumble_sim`) et bots de test qui se déplacent
  - [ ] Tester avec un vrai jeu (Minecraft + mod MumbleLink)
  - [ ] Raccourci clavier pour basculer + son de confirmation
  - [ ] Profils par jeu (ON/OFF par défaut selon le jeu détecté), surchargés par l'interrupteur
  - [ ] Occlusion (murs) et réverbération selon l'environnement du jeu
- [ ] Overlay en jeu (qui parle, sous-titres)

## V3 — Social
- [ ] **« Qui est dispo ce soir ? »** : créneaux récurrents + suggestion du meilleur moment
- [ ] **Mur des légendes** : épingler des clips et des citations
- [ ] **Défis et paris amicaux** avec points virtuels et classement
- [ ] **Stats de jeu** via les APIs gratuites Steam et Riot
- [x] **Partage d'écran haute qualité** : profils Jeu fluide (1080p 60), Netteté (1440p), Maximum (4K), Économie (720p), H.264 matériel ou VP9, son du PC, versions allégées automatiques pour les petites connexions, plein écran, plusieurs partages en même temps
- [ ] **Annotation** en direct sur un partage (mode coach)

## V4 — Accessibilité et langues
> Exécuté en local, donc gratuit, mais gourmand : tout est désactivable.

- [ ] **Sous-titres en direct** (whisper.cpp, petit modèle)
- [ ] **Traduction** des sous-titres (LibreTranslate / Argos, local)
- [ ] Choix d'exécution : sur le PC du joueur ou sur le serveur

---

## 🔧 Petites améliorations
Repérées en route. À glisser entre deux grosses fonctionnalités.

### Interface
- [ ] Bloc « En vocal » : le ping passe à la ligne quand le panneau latéral est étroit
- [ ] Pseudo coupé dans la carte profil en fenêtre étroite (3 boutons à côté)
- [ ] Le ping affiche « — ms » pendant les 5 premières secondes d'une connexion vocale (en attendant la 1ʳᵉ mesure)
- [ ] Pastille de non-lus par serveur dans le sélecteur et l'accès rapide
- [ ] Indicateur « X est en train d'écrire… »
- [ ] Recherche dans les messages
- [ ] Statuts : en ligne / absent / ne pas déranger (lié au mode focus)
- [ ] Mettre à jour les maquettes « Connexion » et « Créer un compte » (elles montrent encore l'ancien parcours)

### Raccourcis
- [ ] **Raccourcis globaux** (qui marchent quand le jeu est au premier plan), configurables dans Paramètres > Raccourcis
- [ ] **Push-to-talk** : choix détection de la voix / push-to-talk, touche au choix, petit son à l'appui et au relâchement
- [ ] Raccourci global pour le clip 60 s et pour l'audio spatial

### Audio et vocal
- [ ] Paramètres > Audio : appliquer tout de suite le changement de micro / sortie (aujourd'hui : à la prochaine connexion)
- [ ] Idem pour suppression de bruit / annulation d'écho / gain automatique
- [ ] Vérifier le « retour micro » des outils de test avec un vrai micro
- [ ] Clips : choisir la durée (30 s / 60 s / 2 min) et le format (.ogg plus léger)
- [ ] Clips : les partager directement dans un salon textuel ou un message privé
- [ ] Carte spatiale : se déplacer aussi aux flèches du clavier
- [ ] Partage d'écran : choisir la qualité reçue (auto / max) et la garder en mémoire
- [ ] Partage d'écran : changer de profil sans arrêter le partage
- [ ] Partage d'écran : vignette « en direct » dans la liste des salons
- [ ] Partage d'écran : tester AV1 (encore plus efficace) quand les cartes graphiques le permettent
- [ ] Carte spatiale : montrer qui parle avec une onde autour de l'avatar

### Messagerie et appels
- [ ] Notifications Windows (toast) pour les messages privés quand Tomo est en arrière-plan
- [ ] Appel manqué affiché dans la conversation privée
- [ ] Appels de groupe entre amis (plus de 2 personnes)
- [ ] Les appels en train de sonner sont perdus si l'API redémarre (gardés en mémoire)
- [ ] Liens d'invitation cliquables (`tomo://invite/ABCD-EFGH`)

### Compte et sécurité
- [ ] Révoquer un appareil précis (aujourd'hui : tous d'un coup)
- [ ] Le blocage « 5 échecs = 15 min » peut servir à bloquer volontairement un pseudo : passer à un délai progressif par IP + pseudo
- [ ] Limiter l'envoi de messages par compte (aujourd'hui : par adresse IP)

### Fenêtre
- [ ] Vérifier le redimensionnement par les bords et l'agrandissement (ne pas passer sous la barre des tâches)
- [ ] Documenter l'overlay NVIDIA (Alt + R pour le masquer) dans l'aide

### Projet
- [ ] Transformer les scripts de test PowerShell en vraie suite de tests (Vitest) lancée par GitHub Actions
- [ ] Construire l'installateur Windows automatiquement à chaque version (GitHub Actions + Releases)

---

## 🗃️ Mis de côté
Fonctionnalités qui demandent de l'argent ou du matériel dédié. On les reprendra peut-être un jour.

| Fonctionnalité | Pourquoi c'est mis de côté |
|---|---|
| Résumé de soirée par IA | API LLM payante, ou carte graphique dédiée (Ollama) |
| Signature de l'exécutable Windows | Certificat ≈ 100 €/an (sans lui : simple avertissement SmartScreen) |
| Applications mobiles sur les stores | Apple 99 $/an, Google 25 $ |
| Hébergement managé (LiveKit Cloud…) | Inutile : on auto-héberge |
