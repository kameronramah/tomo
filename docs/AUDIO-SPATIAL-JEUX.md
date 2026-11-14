# Audio spatial : les jeux qu'on peut viser sans mod

> État des lieux du 14 novembre 2026.
>
> Méthode : j'ai parcouru le classement Steam des jeux les plus joués (steamcharts.com, joueurs
> connectés à ce moment-là) jusqu'à la **800e place**, et gardé seulement les jeux qui sont à la fois :
> - **vraiment intéressants pour l'audio spatial** : on se déplace à pied dans un monde partagé, et
>   être près ou loin de ses potes change quelque chose (survie, exploration, horreur, bac à sable,
>   jeux de traîtres). Les jeux de course, d'avion, de camion, de stratégie, les MOBA et les jeux de
>   tir où l'équipe reste collée ont été retirés ;
> - **faisables** : le jeu donne lui-même la position, ou il n'a pas d'anti-triche connu.
>
> Cela donne **60 jeux** (plus Minecraft, hors Steam). L'absence d'anti-triche vient de ce que je sais
> de ces jeux, pas d'une vérification jeu par jeu : **à reconfirmer pour chaque jeu avant de coder
> son connecteur** (« à confirmer » = doute plus fort).

## Comment lire le tableau

| Colonne | Valeurs |
|---|---|
| **Intérêt** | **Fort** : les joueurs se dispersent, s'entendre selon la distance change le jeu. **Moyen** : ça marche, mais l'apport est plus léger (vue de dessus, groupe souvent ensemble, monde plus calme). |
| **Méthode** | **Officiel** : le jeu donne lui-même la position par Mumble Link, déjà pris en charge par Tomo (5 jeux, à tester). **Mémoire** : Tomo lit la position dans la mémoire du jeu ; un travail à part pour chaque jeu, qui peut casser à une mise à jour, et il faut le jeu installé pour le mettre au point (55 jeux). |

Sur les 55 jeux « Mémoire », la grande majorité sont faits avec Unity ou Unreal : une partie du
travail se réutilise d'un jeu à l'autre du même moteur.

## Les 60 jeux

« Rang » = place dans le classement Steam complet. 36 jeux d'intérêt fort, 24 d'intérêt moyen.

| # | Rang | Jeu | Intérêt | Méthode | Détail |
|---|---|---|---|---|---|
| 1 | 10 | Team Fortress 2 | Moyen | Officiel | Mumble Link intégré : devrait déjà marcher, à tester. Gratuit. |
| 2 | 24 | Stardew Valley | Moyen | Mémoire | Vue de dessus. |
| 3 | 29 | Valheim | Fort | Mémoire | Unity. Bon premier candidat. |
| 4 | 30 | Project Zomboid | Fort | Mémoire | Jeu en Java : difficile (même souci que Minecraft). |
| 5 | 32 | Left 4 Dead 2 | Fort | Officiel | Moteur Source : Mumble Link probablement intégré, à tester. |
| 6 | 36 | Enshrouded | Fort | Mémoire | À confirmer. |
| 7 | 39 | R.E.P.O. | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 8 | 45 | Palworld | Fort | Mémoire | Unreal. À confirmer. |
| 9 | 47 | Don't Starve Together | Fort | Mémoire | |
| 10 | 49 | Terraria | Moyen | Mémoire | En 2D. Vaut aussi pour tModLoader. |
| 11 | 57 | Garry's Mod | Fort | Officiel | Moteur Source : Mumble Link probablement intégré, à tester. |
| 12 | 63 | PEAK | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 13 | 67 | 7 Days to Die | Fort | Mémoire | Unity. Seulement sur les serveurs sans Easy Anti-Cheat. |
| 14 | 90 | Satisfactory | Moyen | Mémoire | Unreal. |
| 15 | 104 | No Man's Sky | Moyen | Mémoire | |
| 16 | 112 | Phasmophobia | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 17 | 119 | Schedule I | Fort | Mémoire | Unity. |
| 18 | 143 | RuneScape: Dragonwilds | Fort | Mémoire | Unreal. À confirmer. |
| 19 | 150 | Sons Of The Forest | Fort | Mémoire | Unity. |
| 20 | 153 | Among Us | Fort | Mémoire | Unity. Déjà fait par d'autres outils (CrewLink) : très bon candidat. |
| 21 | 161 | Dying Light | Moyen | Mémoire | |
| 22 | 164 | Deep Rock Galactic: Rogue Core | Fort | Mémoire | Unreal. |
| 23 | 177 | Ready or Not | Fort | Mémoire | Unreal. |
| 24 | 184 | Lethal Company | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 25 | 192 | Raft | Moyen | Mémoire | Unity. |
| 26 | 203 | Deep Rock Galactic | Fort | Mémoire | Unreal. |
| 27 | 233 | Core Keeper | Moyen | Mémoire | Unity. Vue de dessus. |
| 28 | 241 | The Forest | Fort | Mémoire | Unity. |
| 29 | 242 | Escape the Backrooms | Fort | Mémoire | Unreal. A déjà son vocal de proximité. |
| 30 | 247 | RV There Yet? | Moyen | Mémoire | À confirmer. |
| 31 | 249 | Supermarket Together | Moyen | Mémoire | Unity. |
| 32 | 256 | Grounded 2 | Fort | Mémoire | Unreal. |
| 33 | 262 | theHunter: Call of the Wild | Fort | Mémoire | |
| 34 | 269 | Dying Light 2 | Moyen | Mémoire | |
| 35 | 279 | Guild Wars 2 | Moyen | Officiel | Mumble Link intégré : marche déjà avec Tomo. |
| 36 | 282 | Icarus | Fort | Mémoire | Unreal. |
| 37 | 283 | Abiotic Factor | Fort | Mémoire | Unreal. |
| 38 | 294 | Green Hell | Fort | Mémoire | Unity. |
| 39 | 312 | Subnautica 2 | Fort | Mémoire | Unreal. À confirmer. |
| 40 | 323 | Space Engineers | Fort | Mémoire | |
| 41 | 324 | The Planet Crafter | Moyen | Mémoire | Unity. |
| 42 | 329 | V Rising | Moyen | Mémoire | Unity. Vue de dessus. |
| 43 | 352 | Barotrauma | Fort | Mémoire | A déjà son vocal de proximité. |
| 44 | 410 | Dying Light: The Beast | Moyen | Mémoire | |
| 45 | 432 | Counter-Strike: Source | Moyen | Officiel | Mumble Link intégré, à tester. |
| 46 | 470 | Grounded | Fort | Mémoire | Unreal. |
| 47 | 472 | Windrose | Fort | Mémoire | À confirmer. |
| 48 | 513 | Medieval Dynasty | Moyen | Mémoire | Unreal. |
| 49 | 522 | Human Fall Flat | Moyen | Mémoire | Unity. |
| 50 | 582 | State of Decay 2 | Moyen | Mémoire | Unreal. |
| 51 | 602 | HumanitZ | Fort | Mémoire | Unreal. |
| 52 | 609 | Scrap Mechanic | Moyen | Mémoire | |
| 53 | 636 | Bellwright | Moyen | Mémoire | Unreal. |
| 54 | 639 | Astroneer | Moyen | Mémoire | Unreal. |
| 55 | 650 | Crab Game | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 56 | 652 | VEIN | Fort | Mémoire | Unreal. |
| 57 | 714 | Barony | Moyen | Mémoire | |
| 58 | 744 | Dinkum | Moyen | Mémoire | Unity. |
| 59 | 774 | Content Warning | Fort | Mémoire | Unity. A déjà son vocal de proximité. |
| 60 | 783 | Backrooms: Escape Together | Fort | Mémoire | Unreal. |

## Hors Steam

| Jeu | Intérêt | Détail |
|---|---|---|
| Minecraft (Java) | Fort | Pas d'anti-triche, mais mémoire très difficile à lire (Java). Pistes : lire les coordonnées de l'écran F3, ou un petit plugin côté serveur (seul celui qui héberge l'installe). Avec le mod Mumble Link, ça marche déjà. |

## Ce qui a été écarté

- **Les jeux avec anti-triche** (ou dont l'éditeur bannit la lecture de mémoire) : Counter-Strike 2, PUBG,
  Call of Duty, Apex Legends, Marvel Rivals, Rainbow Six Siege, Rust, Overwatch, GTA V, Dead by Daylight,
  Helldivers 2, Battlefield 6, DayZ, Destiny 2, Elden Ring, Escape from Tarkov, Rocket League, ARK,
  The Finals, Sea of Thieves, Fortnite, Valorant, League of Legends, Roblox… On n'y touche pas : risque de ban.
  Pour eux, il reste la carte manuelle de Tomo.
- **Les jeux faisables mais sans réel intérêt pour l'audio spatial** :
  - course, avion, camion, engins : Forza Horizon, BeamNG.drive, F1, Assetto Corsa, Flight Simulator,
    X-Plane, DCS World, Euro / American Truck Simulator, SnowRunner, RoadCraft, Farming Simulator… ;
  - vue stratégique ou distances énormes : Dota 2, War Thunder, Factorio ;
  - jeux de tir ou d'action où l'équipe reste collée : Payday 2, Borderlands, Monster Hunter, Remnant II,
    Risk of Rain 2, Gunfire Reborn, Chained Together…
- **Solo, stratégie, gestion, cartes**, et les programmes qui ne sont pas des jeux.

## État du code

- **Mumble Link** : en place depuis longtemps. Couvre les 5 jeux « Officiel » (à tester un par un).
- **Connecteurs officiels** pour Dota 2, War Thunder, Forza Horizon, BeamNG.drive et F1 : codés puis
  retirés le 14 novembre 2026, ces jeux n'ayant pas d'intérêt réel pour l'audio spatial.
- **Lecture mémoire** : rien de codé.

## Ordre proposé

1. **Tester ce qui marche peut-être déjà** : Team Fortress 2 (gratuit), Left 4 Dead 2, Garry's Mod.
2. **Minecraft Java** : choisir entre lecture de l'écran F3 et plugin côté serveur.
3. **Lecture mémoire, jeu par jeu**, en commençant par les jeux d'intérêt fort auxquels le groupe joue
   vraiment, et en regroupant par moteur (Unity d'abord : Valheim, Among Us, Lethal Company, R.E.P.O., PEAK…).

## Limites à garder en tête

- Chacun n'envoie que **sa propre** position : il faut donc que **chaque joueur ait Tomo** avec le connecteur du jeu.
- Il faut savoir que deux joueurs sont **dans la même partie** (même serveur, même monde), sinon deux personnes dans deux parties différentes s'entendraient comme si elles étaient côte à côte. Mumble Link le donne ; pour la lecture mémoire, il faudra le trouver jeu par jeu ou le demander au joueur.
- Un connecteur par lecture mémoire **peut casser à chaque mise à jour du jeu**. Il faudra que Tomo le détecte et repasse sur la carte manuelle sans rien casser.
- Tenir des dizaines de connecteurs à jour est un gros travail d'entretien : mieux vaut en avoir 10 qui marchent que 50 à moitié cassés.
- Plusieurs jeux d'intérêt fort **ont déjà leur vocal de proximité** : Tomo n'y apporte que le fait de rester dans son salon habituel.

## Sources

- Classement : https://steamcharts.com/top
- Jeux compatibles Mumble Link : https://www.mumble.info/documentation/user/positional-audio/supported-games/
