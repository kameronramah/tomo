/**
 * Outils de test côté client : faux joueurs (« bots ») et retour micro.
 * Utilisés uniquement depuis le panneau « Outils de test » du compte de test.
 */
import { Room, Track, createLocalAudioTrack, type LocalAudioTrack } from "livekit-client";
import type { Api } from "./api";
import { getSpatial } from "./voice";

type Bot = { name: string; room: Room; ctx: AudioContext; gain: GainNode; timer: number; talking: boolean; walk: number };

const BOT_NAMES = ["Bot Alex", "Bot Sam", "Bot Nico", "Bot Léa", "Bot Max", "Bot Inès", "Bot Hugo", "Bot Zoé"];
const bots: Bot[] = [];
let chatty = true;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function onBotsChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const botCount = () => bots.length;

/** Un faux joueur rejoint le salon et « parle » de temps en temps (bip doux). */
export async function addBot(api: Api, roomId: string) {
  const name = `${BOT_NAMES[bots.length % BOT_NAMES.length]}${bots.length >= BOT_NAMES.length ? ` ${bots.length + 1}` : ""}`;
  const { url, token } = await api.devBotToken(roomId, name);
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false });

  // Voix synthétique : un oscillateur dont on ouvre/ferme le volume pour simuler la parole.
  const ctx = new AudioContext();
  await ctx.resume().catch(() => {});
  const osc = ctx.createOscillator();
  osc.type = "triangle";
  osc.frequency.value = 160 + Math.random() * 240;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const dest = ctx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();
  await room.localParticipant.publishTrack(dest.stream.getAudioTracks()[0], {
    source: Track.Source.Microphone,
    name: "bot-voice",
  });

  // Audio spatial : le bot tourne en rond (position publiée comme un vrai joueur).
  // Il suit ton mode : sur la carte autour du centre, ou « dans le même jeu » autour de ta position en jeu.
  const radius = 5 + Math.random() * 15;
  const speed = (0.15 + Math.random() * 0.25) * (Math.random() < 0.5 ? -1 : 1);
  let angle = Math.random() * Math.PI * 2;
  const enc = new TextEncoder();
  const walk = window.setInterval(() => {
    angle += speed * 0.15;
    const me = getSpatial();
    const inGame = me?.mySource === "game";
    const cx = inGame ? me!.me.x : 0;
    const cy = inGame ? me!.me.y : 0;
    const pos = {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      yaw: 0,
      src: inGame ? "game" : "map",
      ctx: inGame ? me!.myCtx : "",
    };
    room.localParticipant.publishData(enc.encode(JSON.stringify(pos)), { reliable: false, topic: "pos" }).catch(() => {});
  }, 150);

  const bot: Bot = { name, room, ctx, gain, timer: 0, talking: false, walk };
  const loop = () => {
    bot.talking = chatty && Math.random() < 0.35;
    gain.gain.setTargetAtTime(bot.talking ? 0.06 : 0, ctx.currentTime, 0.04);
    bot.timer = window.setTimeout(loop, bot.talking ? 700 + Math.random() * 2200 : 1200 + Math.random() * 3500);
  };
  loop();
  bots.push(bot);
  notify();
}

/**
 * Un bot partage un « faux écran » : animation 1080p à 60 i/s (blocs qui bougent,
 * compteur, petit texte) pour tester l'affichage, la netteté et la fluidité des partages.
 */
export async function addScreenBot(api: Api, roomId: string) {
  const name = "Bot Écran";
  const { url, token } = await api.devBotToken(roomId, name);
  const room = new Room();
  await room.connect(url, token, { autoSubscribe: false });

  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const g = canvas.getContext("2d")!;
  let frame = 0;
  const start = performance.now();
  const draw = () => {
    const t = (performance.now() - start) / 1000;
    frame++;
    g.fillStyle = "#0e1014";
    g.fillRect(0, 0, 1920, 1080);
    // Grille
    g.strokeStyle = "#1c2029";
    for (let x = 0; x < 1920; x += 80) g.strokeRect(x, 0, 80, 1080);
    for (let y = 0; y < 1080; y += 80) g.strokeRect(0, y, 1920, 80);
    // Blocs en mouvement (fluidité)
    const colors = ["#2dd4bf", "#ffb020", "#a78bfa", "#60a5fa", "#f472b6"];
    colors.forEach((c, i) => {
      g.fillStyle = c;
      const x = 960 + Math.cos(t * (0.8 + i * 0.3) + i) * (300 + i * 90) - 60;
      const y = 540 + Math.sin(t * (1.1 + i * 0.25) + i) * (220 + i * 40) - 60;
      g.fillRect(x, y, 120, 120);
    });
    // Barre qui balaie l'écran (saccades visibles)
    g.fillStyle = "#ffffff";
    g.fillRect(((t * 600) % 2000) - 40, 0, 8, 1080);
    // Textes (netteté)
    g.fillStyle = "#eceef3";
    g.font = "bold 64px Inter, sans-serif";
    g.fillText("Tomo · partage de test", 80, 130);
    g.font = "28px Inter, sans-serif";
    g.fillText(`Image n° ${frame} · ${t.toFixed(2)} s · 1920 × 1080 · 60 i/s visés`, 80, 190);
    g.font = "14px Consolas, monospace";
    g.fillStyle = "#9aa1b2";
    for (let i = 0; i < 6; i++) g.fillText("Petit texte pour juger la netteté : 0123456789 abcdefghijklmnopqrstuvwxyz ABCDEFGHIJKLMNOPQRSTUVWXYZ", 80, 960 + i * 18);
  };
  draw();
  const timer = window.setInterval(draw, 1000 / 60);
  const track = canvas.captureStream(60).getVideoTracks()[0];
  await room.localParticipant.publishTrack(track, {
    source: Track.Source.ScreenShare,
    name: "bot-screen",
    videoCodec: "h264",
    screenShareEncoding: { maxBitrate: 8_000_000, maxFramerate: 60 },
  });

  // Rangé avec les autres bots (retiré par « Tout retirer »)
  const ctx = new AudioContext();
  bots.push({ name, room, ctx, gain: ctx.createGain(), timer: 0, talking: false, walk: timer });
  notify();
}

export async function removeAllBots() {
  const all = bots.splice(0, bots.length);
  await Promise.all(
    all.map(async (b) => {
      clearTimeout(b.timer);
      clearInterval(b.walk);
      await b.room.disconnect();
      await b.ctx.close();
    }),
  );
  notify();
}

/** Les bots parlent-ils ? (sinon ils restent connectés mais silencieux) */
export function setBotsChatty(value: boolean) {
  chatty = value;
  if (!value) bots.forEach((b) => b.gain.gain.setTargetAtTime(0, b.ctx.currentTime, 0.04));
  notify();
}
export const botsChatty = () => chatty;

// ---------------------------------------------------------------------------
// Retour micro : s'entendre soi-même (tester son micro seul)
// ---------------------------------------------------------------------------
let loopback: { track: LocalAudioTrack; el: HTMLMediaElement } | null = null;

export async function setLoopback(on: boolean, deviceId?: string) {
  if (!on) {
    loopback?.track.detach().forEach((el) => el.remove());
    loopback?.track.stop();
    loopback = null;
    return;
  }
  if (loopback) return;
  const track = await createLocalAudioTrack({ deviceId, echoCancellation: false, noiseSuppression: true });
  const el = track.attach();
  el.muted = false;
  el.style.display = "none";
  document.body.appendChild(el);
  loopback = { track, el };
}
export const loopbackOn = () => loopback !== null;
