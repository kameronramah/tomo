# 🗺️ Roadmap

Les versions sont classées par ordre de priorité. Chaque case cochée = fonctionnalité livrée.

---

## V0.1 — Fondations ✅
- [x] Serveur de dev local (`server/docker-compose.dev.yml`)
- [x] Client Tauri : rejoindre un salon vocal et entendre les autres
- [x] Choix du micro et de la sortie audio, volume par personne, indicateur « qui parle »
- [x] Test avec un vrai micro

## V0.2 — tomo : comptes, serveurs, nouvelle interface ✅
- [x] Nouveau nom (**tomo**), logo et charte, interface selon les maquettes validées
- [x] Comptes sécurisés : scrypt, sessions 15 min + renouvellement à rotation, blocage après 5 échecs, limitation par IP
- [x] « Rester connecté » via le coffre-fort du système
- [x] Serveurs créés par les utilisateurs (créateur = admin), aucun serveur par défaut
- [x] Gestion par l'admin : salons, membres (admin / exclure), invitations, renommer, supprimer
- [x] Codes membres + **codes invités d'un soir sans compte**
- [x] Changement de serveur/salon en un clic, Ctrl + 1…9, parcourir un serveur sans quitter son vocal
- [ ] Serveur déployé sur le VPS (LiveKit + Caddy + API)
- [ ] Test à plusieurs, chacun chez soi

## V0.3 — Messagerie, appels, paramètres ✅
- [x] Temps réel (WebSocket) : messages, présence, appels
- [x] Fils de discussion par serveur, chat de chaque pièce vocale
- [x] Amis, messages privés, appels privés avec sonnerie
- [x] Sons d'interface, ping et qualité réseau visibles, espace Paramètres
- [x] Compte de test et outils de test (serveur de dev uniquement)

## V0.6 — Design « Pièces & bulles », pièces jointes ✅
- [x] Nouveau design : colonne des serveurs avec **dossiers**, pièces en cartes, scène en bulles, île vocale
- [x] **Pièces jointes**, **messages vocaux**, **GIF** (Klipy)
- [x] **Volume uniformisé** automatique
- [x] **Installateurs** Windows (.exe / .msi) et Mac (.dmg universel) par GitHub Actions

## V0.7 — Profils et vie sociale ✅
- [x] **Profils** : photo, bannière, petite phrase, couleur, nom affiché ; fiche profil des autres
- [x] **Statuts** : en ligne / inactif (auto) / ne pas déranger / invisible + statut personnalisé avec durée
- [x] **Membres du serveur** à droite, par statut, avec recherche et rôles
- [x] **Messages hors amis** (confidentialité, demandes de message, blocage)
- [x] Notifications Windows / Mac, heures calmes, lancement avec l'ordinateur, pastilles de non-lus (icône, onglet, serveurs)
- [x] Plan du serveur visible en vocal et dans un fil
- [x] **Modifier un message**, **réactions**, **mentions** @pseudo / @vocal / @tous (pastille rouge « @n »)

## V0.8 — Pensé pour le jeu ✅
- [x] **Suppression de bruit avancée** (RNNoise sur le PC) + porte de bruit + test « s'écouter » avant / après
- [x] **Mise à jour automatique** depuis GitHub Releases (signée), carte « tomo X est prête », sans canal bêta
- [x] **Langue de tomo** : français / anglais (Paramètres › Apparence)
- [x] **Jeu détecté** (liste des programmes) + « joue à … » (profil, membres, cartes des pièces)
- [x] **Paramètres › Jeux** : par jeu audio spatial, overlay, **pièce automatique**, **mode focus**, masquer ; ajout d'un jeu à la main
- [x] Proposition de rejoindre les potes qui jouent au même jeu en vocal
- [x] **Overlay en jeu** : qui parle, chat de la pièce, sous-titres (Paramètres › Overlay en jeu)
- [x] **Sous-titres en direct + traduction** FR ⇄ EN calculés sur le PC (Whisper + Opus-MT), icône CC, transcription enregistrable
- [x] **Mode coach** : annotations sur un partage d'écran (crayon, flèche, ping) **sur demande acceptée par celui qui partage** (ou ouvert à tous), affichées **directement sur son écran** (fenêtre transparente), capture envoyée dans le chat
- [x] **Mur des légendes** : citations, images, clips épinglés, réactions
- [x] **Défis à points** (sans paris) : validation par les participants, classement du mois
- [x] **Stats de jeu** : Steam (OpenID, heures jouées) et League of Legends (Riot ID : rang, dernières parties), Paramètres › Comptes de jeu
- [ ] Tester en vrai : overlay par-dessus un jeu, sous-titres à plusieurs, liaison Steam, clé Riot, mise à jour automatique d'une version à la suivante

## V0.9 — Micro et raccourcis ✅
- [x] **Appuyer pour parler** (push-to-talk) : touche du clavier ou bouton de souris, délai de relâche, petit son
- [x] **Seuil de voix** réglable avec le niveau du micro en direct (ou automatique)
- [x] **« Baisser les autres quand je parle »** (option, coupée au départ)
- [x] **Raccourcis clavier configurables** (Paramètres › Raccourcis) qui marchent **en jeu** sans bloquer la touche : push-to-talk, micro, son, clip, audio spatial, sous-titres, quitter, overlay
- [x] **Ranger les pièces et les fils** par glisser-déposer (admins), visible tout de suite par tout le monde
- [x] « X est en train d'écrire… »
- [ ] Tester en vrai : push-to-talk et raccourcis dans un jeu, sur Mac (autorisation « Surveillance de l'entrée »)

## V1 — MVP « on lâche Discord »
> Objectif : utilisable tous les soirs par le groupe.

- [ ] Déployer sur le VPS et tester à plusieurs (voir V0.2)
- [x] Push-to-talk / seuil de voix, « baisser les autres quand je parle » (v0.9)
- [x] Réordonner les salons par glisser-déposer (v0.9)
- [ ] Signer l'app Mac et l'app Windows (payant → voir « Mis de côté »)

## V2 — Encore plus pour le jeu
- [ ] **Callouts rapides** : touches → phrases en synthèse vocale (Piper, local)
- [ ] **Mode radio** : connecté à plusieurs salons, un push-to-talk par salon
- [ ] Audio spatial : tester avec un vrai jeu (Minecraft + mod MumbleLink, Valheim + mod PositionalAudio)
- [ ] Audio spatial : raccourci pour basculer, occlusion (murs) et réverbération
- [ ] Overlay : mini-panneau cliquable (micro, son, clip) avec un raccourci global
- [ ] Valorant dans les stats (l'API Riot demande une appli « production » validée par Riot)
- [ ] Défis : validation automatique avec les stats (« le plus de kills ce soir »)
- [ ] Défi de la semaine suivi automatiquement (temps passé en vocal)

## V3 — Social
- [ ] **« Qui est dispo ce soir ? »** : créneaux récurrents + suggestion du meilleur moment
- [ ] **Paris amicaux** sur les défis — en attente : décider d'abord à quoi servent les points
- [ ] Mur des légendes : épingler une capture du mode coach directement, épingler depuis un message privé

## V4 — Accessibilité et langues
- [x] Sous-titres et traduction locaux (voir V0.8)
- [ ] Plus de langues (interface et traduction : espagnol, allemand…)
- [ ] Sous-titres de ma propre voix (pour vérifier ce que les autres lisent)
- [ ] Choix d'exécution : sur le PC du joueur ou sur le serveur

---

## 🔧 Petites améliorations
Repérées en route. À glisser entre deux grosses fonctionnalités.

### Interface
- [x] Bloc « En vocal » : le ping passe à la ligne quand le panneau latéral est étroit
- [x] Pseudo coupé dans la carte profil en fenêtre étroite (3 boutons à côté)
- [x] Le ping affiche « — ms » pendant les 5 premières secondes d'une connexion vocale (mesuré tout de suite par WebRTC)
- [x] Indicateur « X est en train d'écrire… »
- [ ] Recherche dans les messages
- [ ] Mettre à jour les maquettes « Connexion » et « Créer un compte »
- [ ] Mode coach : barre d'outils en icônes seules quand la fenêtre est petite
- [ ] Mode coach : partage d'une seule fenêtre → retrouver sa position pour afficher aussi les traits sur l'écran (aujourd'hui : seulement dans tomo)
- [ ] Mode coach : répondre à une demande depuis l'overlay (aujourd'hui : notification + réponse dans tomo)
- [ ] Quelques textes restent en français en mode anglais (notifications système, messages d'erreur rares du serveur) : à traduire au fil de l'eau
- [ ] Le mur des légendes affiche le pseudo de l'époque (pas le nom affiché actuel)
- [ ] Ranger les pièces aussi depuis le plan du serveur (colonne visible en vocal), pas seulement depuis l'accueil
- [ ] Ranger les serveurs dans la colonne de gauche par glisser-déposer

### Raccourcis
- [x] **Raccourcis globaux** (qui marchent quand le jeu est au premier plan), configurables
- [x] **Push-to-talk** : touche au choix, petit son à l'appui et au relâchement
- [x] Raccourci global pour le clip, l'audio spatial et l'overlay (Ctrl+Maj+O)
- [ ] Mac : les lettres des raccourcis suivent la position QWERTY (sur un clavier AZERTY, « A » s'affiche « Q ») → lire la disposition du clavier
- [ ] Un push-to-talk par salon (mode radio, V2)

### Audio et vocal
- [x] Paramètres > Audio : appliquer tout de suite le changement de micro / sortie, d'écho et de gain auto
- [ ] Vérifier le « retour micro » des outils de test avec un vrai micro
- [ ] Clips : format .ogg plus léger ; les partager directement dans un fil ou un message privé
- [ ] Carte spatiale : se déplacer aux flèches du clavier ; onde autour de l'avatar qui parle
- [ ] Partage d'écran : choisir la qualité reçue, changer de profil sans arrêter, vignette « en direct », AV1
- [x] Sous-titres : ne pas recharger le modèle à chaque entrée dans une pièce

### Jeux
- [ ] Liste des jeux connus : la compléter (et « javaw.exe = Minecraft » peut se tromper avec d'autres programmes Java)
- [ ] Choisir un .exe avec l'explorateur de fichiers plutôt que taper son nom

### Messagerie et appels
- [ ] Appel manqué affiché dans la conversation privée
- [ ] Appels de groupe entre amis (plus de 2 personnes)
- [ ] Les appels en train de sonner sont perdus si l'API redémarre
- [ ] Liens d'invitation cliquables (`tomo://invite/ABCD-EFGH`)

### Compte et sécurité
- [ ] Révoquer un appareil précis (aujourd'hui : tous d'un coup)
- [x] Le blocage « 5 échecs = 15 min » peut servir à bloquer volontairement un pseudo : délai progressif par IP + pseudo
- [x] Limiter l'envoi de messages par compte (aujourd'hui : par adresse IP)
- [ ] Vérifier le blocage par adresse depuis deux adresses différentes (testé seulement depuis une seule)
- [ ] Riot : vérifier que le Riot ID appartient bien à la personne (impossible sans la connexion officielle Riot)

### Fenêtre
- [ ] Vérifier le redimensionnement par les bords et l'agrandissement
- [ ] Documenter l'overlay NVIDIA (Alt + R pour le masquer) dans l'aide

### Projet
- [ ] Transformer les scripts de test (PowerShell + Node) en vraie suite de tests (Vitest) lancée par GitHub Actions
- [x] Construire les installateurs automatiquement à chaque version (GitHub Actions + Releases, Windows + Mac)
- [x] Mise à jour automatique via GitHub Releases

---

## 🗃️ Mis de côté
Fonctionnalités qui demandent de l'argent ou du matériel dédié. On les reprendra peut-être un jour.

| Fonctionnalité | Pourquoi c'est mis de côté |
|---|---|
| Résumé de soirée par IA | API LLM payante, ou carte graphique dédiée (Ollama) |
| Signature de l'exécutable Windows | Certificat ≈ 100 €/an (sans lui : simple avertissement SmartScreen) |
| Signature de l'app Mac | Compte Apple Developer 99 $/an (sans lui : clic droit › Ouvrir au premier lancement) |
| Applications mobiles sur les stores | Apple 99 $/an, Google 25 $ |
| Hébergement managé (LiveKit Cloud…) | Inutile : on auto-héberge |
