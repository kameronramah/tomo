/**
 * Code de secours pour quelqu'un qui a oublié son mot de passe ET n'a plus accès à son e-mail.
 * À lancer sur le serveur par l'admin de l'instance (pas de route web : il faut accès au serveur).
 *
 *   node dist/cli-secours.js <pseudo>
 *
 * Affiche un code à 6 chiffres valable 1 heure, à usage unique. La personne le tape dans
 * « Mot de passe oublié » › « J'ai déjà un code », avec son pseudo et un nouveau mot de passe.
 */
import { db } from "./db.js";
import { newCode } from "./codes.js";

const name = process.argv.slice(2).join(" ").trim();
if (!name) {
  console.error("Utilisation : node dist/cli-secours.js <pseudo>");
  process.exit(1);
}
const row = db.prepare("SELECT id, username, email FROM users WHERE username = ?").get(name) as
  | { id: string; username: string; email: string | null }
  | undefined;
if (!row) {
  console.error(`Aucun compte avec le pseudo « ${name} ».`);
  process.exit(1);
}
const code = newCode(row.id, "rescue", 60 * 60_000);
console.log(`Code de secours pour « ${row.username} » : ${code.slice(0, 3)} ${code.slice(3)}`);
console.log("Valable 1 heure, une seule fois. À taper dans tomo › Mot de passe oublié › J'ai déjà un code.");
