/**
 * Index de la recherche des Paramètres : chaque réglage, sa section, et des mots en plus
 * (synonymes, en français et en anglais) pour le trouver même sans le mot exact.
 * `label` est le texte affiché dans la page (il passe par t() à l'affichage, et sert à retrouver
 * l'endroit dans la page) : garder le même texte que dans Settings*.tsx.
 */
export type SettingsEntry = { section: string; label: string; words?: string };

export const SETTINGS_INDEX: SettingsEntry[] = [
  // Mon profil
  { section: "profile", label: "Images", words: "photo avatar bannière image profil picture banner" },
  { section: "profile", label: "À propos de moi", words: "bio description nom affiché pseudo statut display name about" },
  { section: "profile", label: "Couleur de mon profil", words: "couleur teinte color" },
  { section: "profile", label: "Aperçu de mon profil", words: "aperçu preview carte" },
  // Compte et sécurité
  { section: "account", label: "Adresse e-mail", words: "mail email courriel adresse vérifier verify" },
  { section: "account", label: "Changer le mot de passe", words: "mot de passe password sécurité security" },
  { section: "account", label: "Appareils connectés", words: "sessions appareils déconnecter partout devices logout" },
  // Confidentialité
  { section: "privacy", label: "Qui peut m'envoyer un message privé ?", words: "messages privés dm demandes inconnus private messages" },
  { section: "privacy", label: "Appels, amis et visibilité", words: "appels amis visibilité jeu montrer à quoi je joue en ligne invisible calls friends" },
  // Comptes de jeu
  { section: "accounts", label: "Comptes de jeu", words: "steam riot league of legends lol lier stats statistiques link accounts" },
  { section: "accounts", label: "Qui voit mes stats", words: "stats visibilité statistiques" },
  // Audio et micro
  { section: "audio", label: "Périphériques", words: "micro microphone casque haut-parleurs sortie entrée devices headset speakers" },
  { section: "audio", label: "S'écouter", words: "tester test micro écouter loopback" },
  { section: "audio", label: "Quand mon micro s'ouvre", words: "push to talk appuyer pour parler ptt détection voix voice activity" },
  { section: "audio", label: "Seuil de voix", words: "sensibilité seuil threshold sensitivity" },
  { section: "audio", label: "Les autres pendant que je parle", words: "baisser ducking atténuer duck" },
  { section: "audio", label: "Volume", words: "volume son voix uniformisé loudness" },
  { section: "audio", label: "Traitement du micro", words: "bruit suppression rnnoise écho gain noise echo" },
  { section: "audio", label: "Sous-titres en direct", words: "sous-titres traduction transcription captions subtitles translate whisper" },
  // Audio spatial
  { section: "spatial", label: "Portée", words: "distance portée mètres carte spatial 3d range map" },
  { section: "spatial", label: "Position dans le jeu (Mumble Link)", words: "mumble link position jeu positional audio" },
  // Clips
  { section: "clips", label: "Activer les clips", words: "clip enregistrer replay durée record" },
  // Partage d'écran
  { section: "screen", label: "Qualité par défaut", words: "qualité résolution fps images par seconde 1080p hd stream quality resolution" },
  { section: "screen", label: "Son", words: "son du pc audio partage écran share sound" },
  // Jeux
  { section: "games", label: "Détection", words: "jeu détecté joue à programme ajouter un jeu masquer pièce auto focus games detection" },
  // Overlay
  { section: "overlay", label: "Quand l'afficher", words: "overlay en jeu afficher opacité in-game" },
  { section: "overlay", label: "Ce qui s'affiche", words: "overlay qui parle noms" },
  // Sons et notifications
  { section: "sounds", label: "Sons de l'interface", words: "sons bruitages volume des sons sounds" },
  { section: "sounds", label: "Quand jouer un son", words: "son arrivée départ vocal messages appels sonnerie ring" },
  { section: "sounds", label: "Notifications du système", words: "notifications alertes bureau desktop alerts" },
  { section: "sounds", label: "Heures calmes", words: "heures calmes ne pas déranger nuit silence quiet hours do not disturb" },
  // Apparence
  { section: "appearance", label: "Langue", words: "langue français anglais english language" },
  { section: "appearance", label: "Taille de l'interface", words: "zoom taille texte grand petit size scale" },
  { section: "appearance", label: "Affichage", words: "mode compact animations réduire display motion" },
  // Démarrage
  { section: "startup", label: "Au démarrage de l'ordinateur", words: "démarrage lancer windows macos réduit autostart launch startup" },
  // Raccourcis
  { section: "shortcuts", label: "Raccourcis clavier", words: "raccourcis touches clavier souris hotkeys keybinds shortcuts muet sourdine" },
  // Réseau
  { section: "network", label: "Connexion", words: "réseau ping latence connexion serveur network latency" },
  // À propos
  { section: "about", label: "Mises à jour", words: "mise à jour version update" },
  { section: "about", label: "Tomo", words: "à propos version licence about" },
];

/** Minuscules sans accents, pour comparer « écho » et « echo ». */
export const foldText = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
