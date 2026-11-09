# 📦 Publier une nouvelle version de tomo

Une version = des installateurs Windows et Mac **toujours à jour** sur GitHub, et la **mise à jour automatique** pour ceux qui ont déjà tomo.

## Le lien à donner aux potes

👉 **https://github.com/kameronramah/tomo/releases/latest**

Ce lien pointe toujours vers la dernière version publiée :
- **Windows** : `tomo_x.y.z_x64-setup.exe` (double-clic, installation sans droits administrateur) ;
- **Mac** : `tomo_x.y.z_universal.dmg` (Intel et Apple). Premier lancement : clic droit sur tomo › Ouvrir (l'app n'est pas signée par Apple, c'est payant).

Une fois installé, tomo se met à jour **tout seul** : il vérifie au démarrage puis toutes les 6 heures, télécharge en arrière-plan et propose « Redémarrer ».

## À faire une seule fois : la clé de signature des mises à jour

Les mises à jour sont **signées** : l'appli refuse un fichier qui ne vient pas de toi. La paire de clés a été générée sur ton PC :
- clé **publique** : déjà dans `client/src-tauri/tauri.conf.json` (`plugins.updater.pubkey`) ;
- clé **privée** : `C:\Users\Kameron\.tauri\tomo-updater.key` — **à garder secrète et à sauvegarder** (si tu la perds, les applis installées ne pourront plus se mettre à jour toutes seules ; il faudrait réinstaller).

Donne la clé privée à GitHub (gratuit) :
1. Ouvre https://github.com/kameronramah/tomo/settings/secrets/actions
2. **New repository secret** → nom `TAURI_SIGNING_PRIVATE_KEY` → valeur : tout le contenu du fichier `tomo-updater.key` (ouvre-le avec le Bloc-notes, copie tout).
3. La clé n'a pas de mot de passe : pas besoin de `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

## Publier une version

1. Changer le numéro de version (même numéro aux 3 endroits) :
   - `client/src-tauri/tauri.conf.json` → `"version"`
   - `client/src-tauri/Cargo.toml` → `version`
   - `client/package.json` → `"version"`
2. Pousser, puis créer le tag :
   ```bash
   git tag v0.8.0
   ```
   ```bash
   git push origin v0.8.0
   ```
3. GitHub Actions (onglet **Actions**) fabrique les installateurs Windows et Mac (~15 min), les signe et **publie la Release** avec `latest.json`.
4. C'est tout : le lien `releases/latest` donne la nouvelle version, et les applis installées la proposent.

> Le texte de la Release (onglet Releases › Edit) s'affiche dans la carte « tomo X est prête » : mets-y 2-3 lignes « Quoi de neuf » (une par ligne, commençant par `- `).

## En cas de souci
- **Le workflow échoue sur « signing »** : le secret `TAURI_SIGNING_PRIVATE_KEY` manque ou est incomplet.
- **Les applis ne voient pas la mise à jour** : vérifier que la Release n'est pas en brouillon et qu'elle contient `latest.json`.
- **Version de test sans publier** : onglet Actions › Installateurs › *Run workflow* ; les fichiers sont dans l'onglet de l'exécution (artefacts), aucune Release n'est créée.

## Version navigateur (https://app-tomo.grylix.dev)
Rien à faire à la main : sur le VPS, `~/maj-tomo.sh` met à jour l'API **et** fabrique la version web (avec `VITE_TOMO_INSTANCE=https://tomo.grylix.dev/`), puis remplace `~/tomo-web` (servi par le nginx de Guillaume). L'ancien script est gardé dans `~/maj-tomo.sh.avant-web`.

Donc, après avoir poussé sur GitHub :
```
ssh ramah@51.75.121.23 ~/maj-tomo.sh
```

Tout ce qui est dans `tomo-web` est public : jamais de secret ni de lien symbolique dedans.

Dans le navigateur, ne marchent pas : raccourcis en jeu, overlay, jeux détectés, clips sur le disque, mise à jour automatique (pas besoin : recharger la page suffit).
