// Tests : comptes de jeu (Steam OpenID, Riot ID) — sans vraies clés, on vérifie les garde-fous.
//   node server/api/tests/test-stats.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));
async function call(method, path, body, token, raw, retried) {
  // Limitation anti-force brute (10 essais/min sur /auth) : on attend une minute et on réessaie.
  const r = await call0(method, path, body, token, raw);
  if (r.status === 429 && !retried) { console.log("(limitation de l'API : pause d'une minute)"); await new Promise((x) => setTimeout(x, 61_000)); return call(method, path, body, token, raw, true); }
  return r;
}
async function call0(method, path, body, token) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch {}
  return { status: res.status, data };
}
const pw = "une-phrase-de-passe-solide";
const A = (await call("POST", "/auth/register", { username: `Sa${s}`, password: pw, email: `Sa${s}@exemple.test` })).data;
const B = (await call("POST", "/auth/register", { username: `Sb${s}`, password: pw, email: `Sb${s}@exemple.test` })).data;

let r = await call("GET", "/me/links", null, A.accessToken);
check("mes comptes : rien de lié au départ", r.data.steam === null && r.data.riot === null && r.data.visibility === "servers");
r = await call("POST", "/me/links/steam/start", null, A.accessToken);
const url = new URL(r.data.url);
check("Steam : lien vers la connexion officielle", url.host === "steamcommunity.com" && url.searchParams.get("openid.mode") === "checkid_setup");
const state = new URL(url.searchParams.get("openid.return_to")).searchParams.get("state");
r = await call("GET", `/links/steam/callback?state=mauvais`);
check("retour Steam avec un mauvais état refusé", r.status === 200 && String(r.data).includes("Liaison impossible"));
r = await call("GET", `/links/steam/callback?state=${state}&openid.return_to=${encodeURIComponent("http://pirate/x")}`);
check("retour Steam falsifié refusé", String(r.data).includes("Liaison impossible"));
r = await call("GET", "/me/links", null, A.accessToken);
check("toujours rien de lié", r.data.steam === null);
r = await call("PATCH", "/me/links", { visibility: "partout" }, A.accessToken);
check("visibilité invalide refusée", r.status === 400);
r = await call("PATCH", "/me/links", { visibility: "nobody", showRank: false }, A.accessToken);
check("visibilité « personne » enregistrée", r.status === 200);
r = await call("GET", `/users/${A.user.id}/stats`, null, B.accessToken);
check("stats d'un compte sans liaison : vide", r.data.steam === null && r.data.riot === null);
r = await call("POST", "/me/links/riot", { riotId: "pasdetag", region: "euw1" }, A.accessToken);
check("Riot : refusé sans clé, ou Riot ID mal écrit", r.status === 400);
console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
