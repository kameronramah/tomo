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

## V1 — MVP « on lâche Discord »
> Objectif : utilisable tous les soirs par le groupe.

- [ ] Changer son mot de passe, voir et révoquer ses appareils connectés
- [ ] **Push-to-talk** avec raccourci global (qui marche quand le jeu est au premier plan)
- [ ] Réordonner les salons par glisser-déposer
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
  - [x] Interrupteur ON/OFF **par salon**, synchronisé pour tout le monde
  - [ ] Rendu 3D des voix (PannerNode HRTF) à partir des positions en jeu
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
