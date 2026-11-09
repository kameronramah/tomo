// Tests : adresse e-mail obligatoire, vérification par code, mot de passe oublié.
// Serveur de dev lancé (DEV_TOOLS=1, sans SMTP : les codes sont lus dans /dev/mailbox), puis :
//   node server/api/tests/test-email.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, token, retried) {
  const r = await call0(method, path, body, token);
  // Limitation anti-force brute (10 essais/min sur les routes sensibles) : pause d'une minute.
  if (r.status === 429 && r.data?.statusCode === 429 && !retried) {
    console.log("(limitation de l'API : pause d'une minute)");
    await sleep(61_000);
    return call(method, path, body, token, true);
  }
  return r;
}
async function call0(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}
const mailbox = async (to) => (await call0("GET", `/dev/mailbox?to=${encodeURIComponent(to)}`)).data;

const pw = "une-phrase-de-passe-solide";
const mailA = `Ea${s}@Exemple.test`;

// ---- Inscription ----
let r = await call("POST", "/auth/register", { username: `Ea${s}`, password: pw });
check("inscription sans e-mail refusée (400)", r.status === 400);
r = await call("POST", "/auth/register", { username: `Ea${s}`, password: pw, email: "pas-une-adresse" });
check("adresse invalide refusée (400)", r.status === 400);
r = await call("POST", "/auth/register", { username: `Ea${s}`, password: pw, email: mailA });
check("inscription avec e-mail", r.status === 200 && !!r.data?.accessToken);
let A = r.data;
r = await call("POST", "/auth/register", { username: `Eb${s}`, password: pw, email: mailA.toUpperCase() });
check("même adresse (majuscules différentes) refusée (409)", r.status === 409);
r = await call("POST", "/auth/register", { username: `Eb${s}`, password: pw, email: `eb${s}@exemple.test` });
const B = r.data;

let me = (await call("GET", "/me", null, A.accessToken)).data;
check("/me : adresse en minuscules, pas encore vérifiée", me.email === mailA.toLowerCase() && me.emailVerified === false);
const other = (await call("POST", "/users/batch", { ids: [A.user.id] }, B.accessToken)).data;
check("l'adresse n'apparaît jamais dans le profil vu par les autres", !JSON.stringify(other).toLowerCase().includes(mailA.toLowerCase()));

// ---- Vérification ----
let mail = await mailbox(mailA);
check("code de vérification « envoyé » à l'inscription", /^\d{6}$/.test(mail?.code ?? ""));
r = await call("POST", "/me/email/verify", { code: "000000" === mail.code ? "111111" : "000000" }, A.accessToken);
check("mauvais code refusé", r.status === 400);
r = await call("POST", "/me/email/verify", { code: mail.code }, A.accessToken);
check("bon code : adresse vérifiée", r.status === 200 && r.data?.emailVerified === true);
r = await call("POST", "/me/email/verify", { code: mail.code }, A.accessToken);
check("le code ne sert qu'une fois", r.status === 400);
me = (await call("GET", "/me", null, A.accessToken)).data;
check("/me : vérifiée", me.emailVerified === true);

// ---- Changer d'adresse ----
r = await call("POST", "/me/email", { email: `eb${s}@exemple.test`, password: pw }, A.accessToken);
check("adresse d'un autre compte refusée (409)", r.status === 409);
r = await call("POST", "/me/email", { email: `nouvelle${s}@exemple.test`, password: "mauvais-mot-de-passe" }, A.accessToken);
check("changer d'adresse demande le bon mot de passe (403)", r.status === 403);
r = await call("POST", "/me/email", { email: `nouvelle${s}@exemple.test`, password: pw }, A.accessToken);
check("adresse changée, à revérifier", r.status === 200 && r.data?.emailVerified === false);
r = await call("POST", "/me/email/resend", null, A.accessToken);
check("renvoi trop rapide refusé (429)", r.status === 429);
mail = await mailbox(`nouvelle${s}@exemple.test`);
await call("POST", "/me/email/verify", { code: mail.code }, A.accessToken);

// ---- Mot de passe oublié ----
r = await call("POST", "/auth/forgot", { login: `inconnu${s}` });
check("compte inconnu : même réponse (pas de fuite)", r.status === 200 && r.data?.ok === true);
r = await call("POST", "/auth/forgot", { login: `Eb${s}` });
await sleep(200);
check("adresse non vérifiée : aucun code envoyé", (await mailbox(`eb${s}@exemple.test`))?.subject?.includes("code") && !(await call0("POST", "/auth/reset", { login: `Eb${s}`, code: "123456", password: "nouveau-mot-de-passe-123" })).data?.accessToken);
r = await call("POST", "/auth/forgot", { login: `NOUVELLE${s}@exemple.test` });
await sleep(200);
mail = await mailbox(`nouvelle${s}@exemple.test`);
check("code de réinitialisation envoyé (connexion par e-mail)", /^\d{6}$/.test(mail?.code ?? "") && /Ton code/.test(mail.subject));
r = await call("POST", "/auth/reset", { login: `Ea${s}`, code: mail.code, password: "court" });
check("nouveau mot de passe trop court refusé", r.status === 400);
r = await call("POST", "/auth/reset", { login: `Ea${s}`, code: "999999" === mail.code ? "888888" : "999999", password: "nouveau-mot-de-passe-123" });
check("mauvais code refusé", r.status === 400);
r = await call("POST", "/auth/reset", { login: `Ea${s}`, code: mail.code, password: "nouveau-mot-de-passe-123" });
check("bon code : mot de passe changé et connecté", r.status === 200 && !!r.data?.accessToken);
r = await call("GET", "/me", null, A.accessToken);
const oldRefresh = await call0("POST", "/auth/refresh", { refreshToken: A.refreshToken });
check("les anciennes sessions sont coupées", oldRefresh.status === 401);
r = await call("POST", "/auth/login", { username: `Ea${s}`, password: "nouveau-mot-de-passe-123" });
check("connexion avec le nouveau mot de passe", r.status === 200);
r = await call0("POST", "/auth/login", { username: `Ea${s}`, password: pw });
check("l'ancien mot de passe ne marche plus", r.status === 401);

// ---- Trop d'essais ----
await call("POST", "/auth/forgot", { login: `Ea${s}` }); // trop tôt (1 min) : pas de nouveau code
console.log("(attente d'une minute pour pouvoir redemander un code)");
await sleep(61_000);
await call("POST", "/auth/forgot", { login: `Ea${s}` });
await sleep(200);
mail = await mailbox(`nouvelle${s}@exemple.test`);
for (let i = 0; i < 5; i++) await call0("POST", "/auth/reset", { login: `Ea${s}`, code: String((Number(mail.code) + 1 + i) % 1_000_000).padStart(6, "0"), password: "encore-un-mot-de-passe" });
r = await call0("POST", "/auth/reset", { login: `Ea${s}`, code: mail.code, password: "encore-un-mot-de-passe" });
check("après 5 mauvais essais, même le bon code ne marche plus", r.status === 400 || r.status === 429);

console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
