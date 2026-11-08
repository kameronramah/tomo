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
