// Tests : « joue à … » (jeu signalé par le WebSocket, vu par les potes, masquable).
// Serveur de dev lancé, puis : node server/api/tests/test-games.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  return { status: res.status, data: await res.json().catch(() => null) };
}

const pw = "une-phrase-de-passe-solide";
const A = (await call("POST", "/auth/register", { username: `Ga${s}`, password: pw, email: `Ga${s}@exemple.test` })).data;
const B = (await call("POST", "/auth/register", { username: `Gb${s}`, password: pw, email: `Gb${s}@exemple.test` })).data;
const srv = (await call("POST", "/servers", { name: "Jeux" }, A.accessToken)).data;
const inv = (await call("POST", `/servers/${srv.id}/invites`, { kind: "member" }, A.accessToken)).data;
await call("POST", `/invites/${inv.code}/accept`, null, B.accessToken);

// B écoute les événements
const events = [];
const wsB = new WebSocket(`ws://localhost:3000/ws?token=${B.accessToken}`);
wsB.onmessage = (m) => events.push(JSON.parse(m.data));
const wsA = new WebSocket(`ws://localhost:3000/ws?token=${A.accessToken}`);
await sleep(600);

wsA.send(JSON.stringify({ type: "game", game: { name: "Valorant", since: Date.now() - 60_000 } }));
await sleep(400);
const ev = events.find((e) => e.type === "game" && e.userId === A.user.id);
check("B est prévenu que A joue à Valorant", ev?.game?.name === "Valorant");
let people = (await call("GET", `/servers/${srv.id}/people`, null, B.accessToken)).data;
check("la liste des membres montre le jeu", people.find((p) => p.id === A.user.id)?.game?.name === "Valorant");
let batch = (await call("POST", "/users/batch", { ids: [A.user.id] }, B.accessToken)).data;
check("le profil résumé montre le jeu", batch[0]?.game?.name === "Valorant");

await call("PATCH", "/me/privacy", { showGame: false }, A.accessToken);
await sleep(300);
people = (await call("GET", `/servers/${srv.id}/people`, null, B.accessToken)).data;
check("« Montrer à quoi je joue » coupé : plus rien de visible", people.find((p) => p.id === A.user.id)?.game === null);
check("B est prévenu que le jeu disparaît", events.some((e) => e.type === "game" && e.userId === A.user.id && e.game === null));
await call("PATCH", "/me/privacy", { showGame: true }, A.accessToken);

wsA.send(JSON.stringify({ type: "game", game: { name: "x".repeat(80) + "\u0007" } }));
await sleep(300);
batch = (await call("POST", "/users/batch", { ids: [A.user.id] }, B.accessToken)).data;
check("nom du jeu nettoyé et coupé à 40 caractères", batch[0]?.game?.name?.length === 40);

wsA.send(JSON.stringify({ type: "game", game: null }));
await sleep(300);
batch = (await call("POST", "/users/batch", { ids: [A.user.id] }, B.accessToken)).data;
check("jeu quitté : plus de « joue à »", batch[0]?.game === null);

wsA.send(JSON.stringify({ type: "game", game: { name: "Minecraft" } }));
await sleep(300);
wsA.close();
await sleep(500);
batch = (await call("POST", "/users/batch", { ids: [A.user.id] }, B.accessToken)).data;
check("déconnecté : plus de jeu affiché", batch[0]?.game === null);

wsB.close();
console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
