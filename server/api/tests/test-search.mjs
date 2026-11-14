// Tests : recherche dans un serveur (texte, filtres, droits). Serveur de dev lancé, puis :
//   node server/api/tests/test-search.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));

async function call(method, path, body, token, retried) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const r = { status: res.status, data: await res.json().catch(() => null) };
  // Limitation anti-force brute (10 essais/min sur /auth) : on attend une minute et on réessaie.
  if (r.status === 429 && !retried) { console.log("(limitation de l'API : pause d'une minute)"); await new Promise((x) => setTimeout(x, 61_000)); return call(method, path, body, token, true); }
  return r;
}

const pw = "une-phrase-de-passe-solide";
const reg = async (n) => (await call("POST", "/auth/register", { username: `${n}${s}`, password: pw, email: `${n}${s}@exemple.test` })).data;
const A = await reg("Sa"), B = await reg("Sb"), C = await reg("Sc");
const srv = (await call("POST", "/servers", { name: "Recherche" }, A.accessToken)).data;
const inv = (await call("POST", `/servers/${srv.id}/invites`, { kind: "member" }, A.accessToken)).data;
await call("POST", `/invites/${inv.code}/accept`, null, B.accessToken);
const detail = (await call("GET", `/servers/${srv.id}`, null, A.accessToken)).data;
const ch = detail.channels[0].id;
const room = detail.rooms[0].id;
const other = (await call("POST", `/servers/${srv.id}/channels`, { name: "strats" }, A.accessToken)).data.id;

// Limite : 10 messages par 10 s et par compte → on espace un peu les envois
const send = async (path, content, who) => (await new Promise((x) => setTimeout(x, 600)), call("POST", path, { content }, who.accessToken));
await send(`/channels/${ch}/messages`, "On se fait une partie ce soir ?", A);
await send(`/channels/${ch}/messages`, "Été comme hiver je joue à 21 h", B);
await send(`/channels/${ch}/messages`, "regarde https://exemple.test/clip", B);
await send(`/channels/${other}/messages`, "Strat pour la PARTIE de demain", A);
await send(`/rooms/${room}/messages`, `<@${A.user.id}> la partie commence`, B);
await send(`/channels/${ch}/messages`, "100% de réussite_ok", A);

const search = (q, who = A) => call("GET", `/servers/${srv.id}/search?${new URLSearchParams(q)}`, null, who.accessToken);
let r = await search({ q: "partie" });
check("« partie » trouve 3 messages (fils + chat de pièce, sans souci de majuscules)", r.status === 200 && r.data.results.length === 3);
check("du plus récent au plus ancien, avec l'endroit", r.data.results[0].place?.kind === "room" && r.data.results[2].place?.name === "général");
r = await search({ q: "ete" });
check("« ete » trouve « Été » (sans accents)", r.data.results.length === 1 && r.data.results[0].content.startsWith("Été"));
r = await search({ q: "partie", from: B.user.id });
check("filtre auteur", r.data.results.length === 1 && r.data.results[0].authorId === B.user.id);
r = await search({ q: "partie", in: other });
check("filtre fil", r.data.results.length === 1 && r.data.results[0].target === other);
r = await search({ has: "link" });
check("filtre « liens » sans texte", r.data.results.length === 1 && r.data.results[0].content.includes("https://"));
r = await search({ mentions: "me" });
check("filtre « me mentionne »", r.data.results.length === 1 && r.data.results[0].scope === "room");
r = await search({ q: "100%" });
check("% est cherché tel quel", r.data.results.length === 1);
r = await search({ q: "_" });
check("_ est cherché tel quel", r.data.results.length === 1);
r = await search({ when: "day", q: "partie" });
check("filtre date", r.data.results.length === 3);
r = await search({ has: "nimporte" });
check("filtre inconnu refusé (400)", r.status === 400);
r = await search({ in: "pas-un-fil" });
check("fil d'un autre serveur refusé (400)", r.status === 400);
r = await search({ q: "partie" }, C);
check("pas membre : 404", r.status === 404);

// Pagination
for (let i = 0; i < 27; i++) await send(`/channels/${other}/messages`, `page ${i}`, i % 2 ? A : B);
r = await search({ q: "page" });
check("25 résultats puis « il y en a d'autres »", r.data.results.length === 25 && r.data.hasMore === true);
const last = r.data.results.at(-1).createdAt;
r = await search({ q: "page", before: String(last) });
check("page suivante", r.data.results.length === 2 && r.data.hasMore === false);

console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
