# 🗺️ Roadmap

Les versions sont classées par ordre de priorité. Chaque case cochée = fonctionnalité livrée.

---

## V0.1 — Fondations
> Objectif : deux amis peuvent se parler à travers le serveur.

- [ ] Serveur déployé sur le VPS (LiveKit + Caddy + API) via `docker compose`
- [x] Serveur de dev local (`server/docker-compose.dev.yml`)
- [x] API : génération d'un token LiveKit (accès protégé par un code d'invitation)
- [x] Client Tauri : écran de connexion (pseudo + code d'invitation)
- [x] Client : rejoindre un salon vocal et entendre les autres
- [x] Choix du micro et de la sortie audio
- [x] Bonus : volume par personne + indicateur « qui parle »
- [ ] Test à plusieurs avec de vrais micros

## V1 — MVP « on lâche Discord »
> Objectif : utilisable tous les soirs par le groupe.

- [ ] Liste des salons + qui est connecté où
- [ ] **Push-to-talk** avec raccourci global (qui marche quand le jeu est au premier plan)
- [ ] Indicateur « qui parle »
- [ ] Réglage du volume par personne + mute individuel
- [ ] **Volume normalisé automatiquement** (compresseur / AGC sur chaque voix reçue)
- [ ] Suppression de bruit (RNNoise ou celle du navigateur)
- [ ] **Clip audio après coup** : tampon circulaire de 60 s, raccourci → fichier `.ogg`
- [ ] Chat texte simple par salon
- [ ] Mise à jour automatique du client via GitHub Releases

## V2 — Pensé pour le jeu
- [ ] **Détection du jeu lancé** (liste des processus) + statut « joue à … »
- [ ] Rejoindre automatiquement le salon du jeu (optionnel)
- [ ] **Mode focus / ranked** : notifications coupées, whitelist de coéquipiers
- [ ] **Callouts rapides** : touches → phrases en synthèse vocale (Piper, local)
- [ ] **Mode radio** : connecté à plusieurs salons, un push-to-talk par salon, volume par salon
- [ ] **Audio spatial activable**
  - [ ] Interrupteur ON/OFF **par salon**, synchronisé pour tout le monde
  - [ ] Raccourci clavier pour basculer + son de confirmation
  - [ ] Profils par jeu (ON/OFF par défaut selon le jeu détecté), surchargés par l'interrupteur
  - [ ] Repli automatique en audio normal si le jeu n'envoie pas de positions
  - [ ] Premier connecteur de positions : mod Minecraft
- [ ] Overlay en jeu (qui parle, sous-titres)

## V3 — Social
- [ ] **« Qui est dispo ce soir ? »** : créneaux récurrents + suggestion du meilleur moment
- [ ] **Mur des légendes** : épingler des clips et des citations
- [ ] **Défis et paris amicaux** avec points virtuels et classement
- [ ] **Stats de jeu** via les APIs gratuites Steam et Riot
- [ ] **Partage d'écran** + **annotation** en direct (mode coach)

## V4 — Accessibilité et langues
> Exécuté en local, donc gratuit, mais gourmand : tout est désactivable.

- [ ] **Sous-titres en direct** (whisper.cpp, petit modèle)
- [ ] **Traduction** des sous-titres (LibreTranslate / Argos, local)
- [ ] Choix d'exécution : sur le PC du joueur ou sur le serveur

---

## 🗃️ Mis de côté
Fonctionnalités qui demandent de l'argent ou du matériel dédié. On les reprendra peut-être un jour.

| Fonctionnalité | Pourquoi c'est mis de côté |
|---|---|
| Résumé de soirée par IA | API LLM payante, ou carte graphique dédiée (Ollama) |
| Signature de l'exécutable Windows | Certificat ≈ 100 €/an (sans lui : simple avertissement SmartScreen) |
| Applications mobiles sur les stores | Apple 99 $/an, Google 25 $ |
| Hébergement managé (LiveKit Cloud…) | Inutile : on auto-héberge |
