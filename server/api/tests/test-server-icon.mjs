// Tests : image de serveur. Serveur de dev lancé, puis :
//   node server/api/tests/test-server-icon.mjs
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
async function call0(method, path, body, token, raw) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && !raw ? { "content-type": "application/json" } : {}), ...(raw ? { "content-type": "application/octet-stream" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const pw = "une-phrase-de-passe-solide";
const reg = async (n) => (await call("POST", "/auth/register", { username: `${n}${s}`, password: pw, email: `${n}${s}@exemple.test` })).data;
const A = await reg("Ia"), B = await reg("Ib");
const srv = (await call("POST", "/servers", { name: "Avec image" }, A.accessToken)).data;
const inv = (await call("POST", `/servers/${srv.id}/invites`, { kind: "member" }, A.accessToken)).data;
await call("POST", `/invites/${inv.code}/accept`, null, B.accessToken);

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082", "hex");
const up = async (who) => (await call("POST", "/attachments?name=icone.png&width=1&height=1", null, who.accessToken, png)).data;

let list = (await call("GET", "/servers", null, B.accessToken)).data;
check("sans image : iconUrl vide", list.find((x) => x.id === srv.id)?.iconUrl === null);

// Un membre simple ne peut pas changer l'image
const bAtt = await up(B);
let r = await call("PATCH", `/servers/${srv.id}`, { iconId: bAtt.id }, B.accessToken);
check("un membre ne peut pas mettre d'image (403)", r.status === 403);

// L'admin ne peut pas utiliser le fichier de quelqu'un d'autre
r = await call("PATCH", `/servers/${srv.id}`, { iconId: bAtt.id }, A.accessToken);
check("pas avec le fichier d'un autre (400)", r.status === 400);

// Un fichier qui n'est pas une image est refusé
const txt = (await call("POST", "/attachments?name=note.txt", null, A.accessToken, Buffer.from("bonjour"))).data;
r = await call("PATCH", `/servers/${srv.id}`, { iconId: txt.id }, A.accessToken);
check("pas un fichier texte (400)", r.status === 400);

// L'admin met une image
const att1 = await up(A);
r = await call("PATCH", `/servers/${srv.id}`, { iconId: att1.id }, A.accessToken);
check("l'admin met une image", r.status === 200 && typeof r.data.iconUrl === "string" && r.data.name === "Avec image");
const url1 = r.data.iconUrl;
list = (await call("GET", "/servers", null, B.accessToken)).data;
check("les membres voient l'image dans la liste", list.find((x) => x.id === srv.id)?.iconUrl === url1);
r = await call("GET", `/servers/${srv.id}`, null, B.accessToken);
check("… et dans le détail du serveur", r.data.iconUrl === url1);
check("l'image se télécharge", (await fetch(base + url1)).status === 200);

r = await call("PATCH", `/servers/${srv.id}`, { iconId: att1.id }, A.accessToken);
check("le même fichier ne sert pas deux fois (400)", r.status === 400);

// Remplacer : l'ancienne image est effacée
const att2 = await up(A);
r = await call("PATCH", `/servers/${srv.id}`, { iconId: att2.id }, A.accessToken);
check("l'admin change l'image", r.status === 200 && r.data.iconUrl !== url1);
check("l'ancienne image est effacée", (await fetch(base + url1)).status === 404);
const url2 = r.data.iconUrl;

// Renommer ne touche pas à l'image
r = await call("PATCH", `/servers/${srv.id}`, { name: "Nouveau nom" }, A.accessToken);
check("renommer garde l'image", r.status === 200 && r.data.name === "Nouveau nom" && r.data.iconUrl === url2);

r = await call("PATCH", `/servers/${srv.id}`, {}, A.accessToken);
check("rien à modifier (400)", r.status === 400);

// Retirer
r = await call("PATCH", `/servers/${srv.id}`, { iconId: null }, A.accessToken);
check("l'admin retire l'image", r.status === 200 && r.data.iconUrl === null);
check("l'image retirée est effacée", (await fetch(base + url2)).status === 404);

// Les photos de profil marchent toujours
const av = await up(A);
r = await call("PATCH", "/me/profile", { avatarId: av.id }, A.accessToken);
check("la photo de profil marche toujours", r.status === 200 && typeof r.data.avatarUrl === "string");

await call("DELETE", `/servers/${srv.id}`, null, A.accessToken);
console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
