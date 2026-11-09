// Tests v0.9 : ranger pièces et fils, « en train d'écrire », limite d'envoi par compte,
// blocage de connexion par adresse + pseudo.
// Serveur de dev lancé, puis : node server/api/tests/test-v09.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body, token, retried) {
  // Limitation anti-force brute (10 essais/min sur /auth) : on attend une minute et on réessaie.
  const r = await call0(method, path, body, token);
  if (r.status === 429 && path.startsWith("/auth") && !retried) {
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

const pw = "une-phrase-de-passe-solide";
const A = (await call("POST", "/auth/register", { username: `Va${s}`, password: pw, email: `Va${s}@exemple.test` })).data;
const B = (await call("POST", "/auth/register", { username: `Vb${s}`, password: pw, email: `Vb${s}@exemple.test` })).data;
const C = (await call("POST", "/auth/register", { username: `Vc${s}`, password: pw, email: `Vc${s}@exemple.test` })).data;
const srv = (await call("POST", "/servers", { name: "Rangement" }, A.accessToken)).data;
const inv = (await call("POST", `/servers/${srv.id}/invites`, { kind: "member" }, A.accessToken)).data;
await call("POST", `/invites/${inv.code}/accept`, null, B.accessToken);

const eventsB = [];
const eventsC = [];
const wsB = new WebSocket(`ws://localhost:3000/ws?token=${B.accessToken}`);
wsB.onmessage = (m) => eventsB.push(JSON.parse(m.data));
const wsC = new WebSocket(`ws://localhost:3000/ws?token=${C.accessToken}`);
wsC.onmessage = (m) => eventsC.push(JSON.parse(m.data));
const wsA = new WebSocket(`ws://localhost:3000/ws?token=${A.accessToken}`);
await sleep(700);

// ---- Ranger les pièces ----
const r1 = (await call("POST", `/servers/${srv.id}/rooms`, { label: "Valo" }, A.accessToken)).data;
const r2 = (await call("POST", `/servers/${srv.id}/rooms`, { label: "AFK" }, A.accessToken)).data;
await sleep(300);
check("B est prévenu quand une pièce est créée", eventsB.some((e) => e.type === "channels" && e.serverId === srv.id));
let detail = (await call("GET", `/servers/${srv.id}`, null, A.accessToken)).data;
const ids = detail.rooms.map((r) => r.id);
check("3 pièces au départ (Général, Valo, AFK)", ids.length === 3 && ids[1] === r1.id && ids[2] === r2.id);
const wanted = [r2.id, ids[0], r1.id];
eventsB.length = 0;
let r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: wanted }, A.accessToken);
check("l'admin range les pièces", r.status === 200);
detail = (await call("GET", `/servers/${srv.id}`, null, B.accessToken)).data;
check("le nouvel ordre est enregistré", detail.rooms.map((x) => x.id).join() === wanted.join());
await sleep(200);
check("B est prévenu du nouvel ordre", eventsB.some((e) => e.type === "channels"));
r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: [ids[0], r1.id, r2.id] }, B.accessToken);
check("un simple membre ne peut pas ranger (403)", r.status === 403);
r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: [r1.id, r2.id] }, A.accessToken);
check("liste incomplète refusée (409)", r.status === 409);
r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: [r1.id, r1.id, r2.id] }, A.accessToken);
check("doublon refusé (409)", r.status === 409);
r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: "n'importe quoi" }, A.accessToken);
check("mauvais format refusé", r.status === 409);
r = await call("PUT", `/servers/${srv.id}/rooms/order`, { ids: wanted }, C.accessToken);
check("quelqu'un d'extérieur ne voit même pas le serveur (404)", r.status === 404);

// ---- Ranger les fils ----
const c1 = (await call("POST", `/servers/${srv.id}/channels`, { name: "memes" }, A.accessToken)).data;
detail = (await call("GET", `/servers/${srv.id}`, null, A.accessToken)).data;
const chIds = detail.channels.map((c) => c.id);
r = await call("PUT", `/servers/${srv.id}/channels/order`, { ids: [...chIds].reverse() }, A.accessToken);
check("l'admin range les fils", r.status === 200);
detail = (await call("GET", `/servers/${srv.id}`, null, A.accessToken)).data;
check("ordre des fils enregistré", detail.channels[0].id === c1.id);
r = await call("PUT", `/servers/${srv.id}/channels/order`, { ids: chIds }, B.accessToken);
check("un membre ne peut pas ranger les fils (403)", r.status === 403);

// ---- En train d'écrire ----
eventsB.length = 0;
eventsC.length = 0;
wsA.send(JSON.stringify({ type: "typing", scope: "channel", target: c1.id }));
await sleep(300);
const typ = eventsB.find((e) => e.type === "typing");
check("B voit que A écrit dans le fil", typ?.scope === "channel" && typ?.target === c1.id && typ?.userId === A.user.id);
check("C (pas membre) ne voit rien", !eventsC.some((e) => e.type === "typing"));
eventsB.length = 0;
wsA.send(JSON.stringify({ type: "typing", scope: "channel", target: c1.id }));
await sleep(300);
check("pas de répétition en moins de 2 s", !eventsB.some((e) => e.type === "typing"));
wsC.send(JSON.stringify({ type: "typing", scope: "channel", target: c1.id }));
await sleep(300);
check("C ne peut pas écrire « en train d'écrire » dans un fil qui n'est pas à lui", !eventsB.some((e) => e.type === "typing" && e.userId === C.user.id));
wsA.send(JSON.stringify({ type: "typing", scope: "dm", target: B.user.id }));
await sleep(300);
const dm = eventsB.find((e) => e.type === "typing" && e.scope === "dm");
check("message privé : B voit que A lui écrit (conversation = A)", dm?.target === A.user.id);

// ---- Limite d'envoi par compte ----
let statuses = [];
for (let i = 0; i < 12; i++) statuses.push((await call0("POST", `/channels/${c1.id}/messages`, { content: `msg ${i}` }, A.accessToken)).status);
check("10 messages passent", statuses.slice(0, 10).every((x) => x === 200));
check("le 11e d'affilée est refusé (429)", statuses[10] === 429);
r = await call0("POST", `/channels/${c1.id}/messages`, { content: "moi aussi" }, B.accessToken);
check("B (même adresse IP) peut encore écrire", r.status === 200);

// ---- Blocage de connexion ----
for (let i = 0; i < 5; i++) await call0("POST", "/auth/login", { username: `Vc${s}`, password: "mauvais-mot-de-passe" });
r = await call0("POST", "/auth/login", { username: `Vc${s}`, password: pw });
check("5 échecs depuis cette adresse : bloqué même avec le bon mot de passe (429)", r.status === 429);
check("le message dit combien de temps attendre", /Réessaie dans 1 min/.test(r.data?.error ?? ""));

wsA.close();
wsB.close();
wsC.close();
console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
