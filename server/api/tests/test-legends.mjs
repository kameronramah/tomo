// Tests : mur des légendes + défis à points. Serveur de dev lancé, puis :
//   node server/api/tests/test-legends.mjs
const base = "http://localhost:3000";
const s = Math.floor(Math.random() * 99999);
let ok = 0, fail = 0;
const check = (label, cond) => (cond ? ok++ : fail++, console.log(`${cond ? "OK  " : "FAIL"} ${label}`));

async function call(method, path, body, token, raw) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(body && !raw ? { "content-type": "application/json" } : {}), ...(raw ? { "content-type": "application/octet-stream" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

const pw = "une-phrase-de-passe-solide";
const reg = async (n) => (await call("POST", "/auth/register", { username: `${n}${s}`, password: pw })).data;
const A = await reg("La"), B = await reg("Lb"), C = await reg("Lc"), D = await reg("Ld");
const srv = (await call("POST", "/servers", { name: "Légendes" }, A.accessToken)).data;
const inv = (await call("POST", `/servers/${srv.id}/invites`, { kind: "member" }, A.accessToken)).data;
for (const x of [B, C]) await call("POST", `/invites/${inv.code}/accept`, null, x.accessToken);
const ch = (await call("GET", `/servers/${srv.id}`, null, A.accessToken)).data.channels[0].id;

// ---- Mur des légendes ----------------------------------------------------------
const quote = (await call("POST", `/channels/${ch}/messages`, { content: "Promis ce soir on joue sérieux." }, B.accessToken)).data;
let r = await call("POST", `/servers/${srv.id}/legends`, { messageId: quote.id }, C.accessToken);
check("C épingle la citation de B", r.status === 200 && r.data.kind === "quote" && r.data.authorId === B.user.id && r.data.context === "#général");
const legendId = r.data.id;
r = await call("POST", `/servers/${srv.id}/legends`, { messageId: quote.id }, A.accessToken);
check("pas deux fois le même message (409)", r.status === 409);
r = await call("POST", `/servers/${srv.id}/legends`, { messageId: quote.id }, D.accessToken);
check("D (pas membre) ne peut pas épingler (404)", r.status === 404);

// Image : 1x1 PNG
const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4f20000000049454e44ae426082", "hex");
const att = (await call("POST", "/attachments?name=top1.png&width=1&height=1", null, A.accessToken, png)).data;
const imgMsg = (await call("POST", `/channels/${ch}/messages`, { content: "", attachments: [att.id] }, A.accessToken)).data;
r = await call("POST", `/servers/${srv.id}/legends`, { messageId: imgMsg.id, title: "Top 1 à 3 PV" }, B.accessToken);
check("image épinglée avec titre (copie du fichier)", r.status === 200 && r.data.kind === "image" && r.data.attachment?.id !== att.id);
const imgLegend = r.data;
await call("DELETE", `/messages/${imgMsg.id}`, null, A.accessToken);
const file = await fetch(base + imgLegend.attachment.url);
check("l'image reste sur le mur après suppression du message", file.status === 200);

// Clip : petit WAV
const wav = Buffer.alloc(44 + 100);
wav.write("RIFF", 0); wav.writeUInt32LE(36 + 100, 4); wav.write("WAVE", 8); wav.write("fmt ", 12); wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write("data", 36); wav.writeUInt32LE(100, 40);
const clipAtt = (await call("POST", "/attachments?name=clip.wav", null, C.accessToken, wav)).data;
check("un .wav est reconnu comme audio", clipAtt.kind === "audio" && clipAtt.mime === "audio/wav");
r = await call("POST", `/servers/${srv.id}/legends/clip`, { attachmentId: clipAtt.id, title: "Le clutch à 1 contre 4" }, C.accessToken);
check("clip mis au mur", r.status === 200 && r.data.kind === "clip" && r.data.attachment?.mime === "audio/wav");
r = await call("POST", `/servers/${srv.id}/legends/clip`, { attachmentId: clipAtt.id, title: "encore" }, C.accessToken);
check("le même fichier ne sert pas deux fois", r.status === 400);

r = await call("POST", `/legends/${legendId}/reactions`, { emoji: "😂" }, A.accessToken);
check("réaction sur une légende", r.status === 200 && r.data.reactions[0]?.count === 1);
let list = (await call("GET", `/servers/${srv.id}/legends`, null, B.accessToken)).data;
check("le mur liste les 3 légendes", list.length === 3);

r = await call("DELETE", `/legends/${legendId}`, null, D.accessToken);
check("D ne peut pas retirer (404)", r.status === 404);
// B est l'auteur de la citation : il peut la retirer
r = await call("DELETE", `/legends/${legendId}`, null, B.accessToken);
check("l'auteur du moment peut retirer sa légende", r.status === 200);
r = await call("DELETE", `/legends/${imgLegend.id}`, null, C.accessToken);
check("un simple membre ne peut pas retirer celle d'un autre (403)", r.status === 403);
r = await call("DELETE", `/legends/${imgLegend.id}`, null, A.accessToken);
check("un admin peut retirer", r.status === 200);
const gone = await fetch(base + imgLegend.attachment.url);
check("le fichier de la légende retirée est effacé", gone.status === 404);

// ---- Défis ------------------------------------------------------------------------
r = await call("POST", `/servers/${srv.id}/challenges`, { title: "Le plus de kills sur 3 parties", reward: 100 }, A.accessToken);
check("A lance un défi (100 points)", r.status === 200 && r.data.players.length === 1);
const cid = r.data.id;
r = await call("POST", `/servers/${srv.id}/challenges`, { title: "triche", reward: 99999 }, A.accessToken);
check("récompense hors liste refusée", r.status === 400);
r = await call("POST", `/challenges/${cid}/claim`, null, A.accessToken);
check("impossible de gagner seul (400)", r.status === 400);
await call("POST", `/challenges/${cid}/join`, null, B.accessToken);
r = await call("POST", `/challenges/${cid}/join`, null, C.accessToken);
check("B et C relèvent le défi", r.data.players.length === 3);
r = await call("POST", `/challenges/${cid}/claim`, null, B.accessToken);
check("B déclare avoir gagné (2 votes nécessaires)", r.data.status === "claimed" && r.data.needed === 2);
r = await call("POST", `/challenges/${cid}/vote`, { approve: true }, B.accessToken);
check("B ne vote pas pour lui-même (403)", r.status === 403);
r = await call("POST", `/challenges/${cid}/vote`, { approve: false }, C.accessToken);
check("C conteste : le défi reprend", r.data.status === "open" && r.data.claimedBy === null);
await call("POST", `/challenges/${cid}/claim`, null, B.accessToken);
await call("POST", `/challenges/${cid}/vote`, { approve: true }, A.accessToken);
r = await call("POST", `/challenges/${cid}/vote`, { approve: true }, C.accessToken);
check("A et C valident : B gagne", r.data.status === "done" && r.data.winnerId === B.user.id);
const board = (await call("GET", `/servers/${srv.id}/challenges`, null, C.accessToken)).data;
check("classement du mois : B a 100 points", board.leaderboard[0]?.userId === B.user.id && board.leaderboard[0]?.points === 100);
r = await call("DELETE", `/challenges/${cid}`, null, A.accessToken);
check("un défi terminé ne s'annule pas", r.status === 400);
const c2 = (await call("POST", `/servers/${srv.id}/challenges`, { title: "Premier au donjon", reward: 50 }, B.accessToken)).data;
r = await call("DELETE", `/challenges/${c2.id}`, null, C.accessToken);
check("C ne peut pas annuler le défi de B (403)", r.status === 403);
r = await call("DELETE", `/challenges/${c2.id}`, null, A.accessToken);
check("un admin peut annuler", r.status === 200);
r = await call("GET", `/servers/${srv.id}/challenges`, null, D.accessToken);
check("D (pas membre) ne voit rien (404)", r.status === 404);

console.log(`\n${ok} OK, ${fail} échec(s)`);
process.exit(fail ? 1 : 0);
