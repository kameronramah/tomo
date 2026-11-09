/**
 * « Appuyer pour parler » et « baisser les autres quand je parle ».
 *
 * Push-to-talk : on coupe la piste micro brute (`enabled = false`) tant que la touche n'est pas
 * tenue. Ce qui part vers les autres (avec ou sans suppression de bruit) est alors du silence.
 * La coupure LiveKit (« micro coupé ») reste prioritaire : on ne rouvre jamais un micro coupé.
 */
import { useEffect, useState } from "react";
import { RoomEvent, Track, TrackEvent, type LocalTrack, type Room } from "livekit-client";
import { getSettings, onSettingsChange } from "./prefs";
import { playSound } from "./sounds";

let held = false;
let open = false;
let releaseTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
let current: Room | null = null;

const isPtt = () => getSettings().audio.mode === "ptt";

function micTrack(room: Room): LocalTrack | undefined {
  return room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track as LocalTrack | undefined;
}

/** Applique l'état voulu à la piste brute du micro. */
function apply(room: Room | null) {
  if (!room) return;
  const track = micTrack(room);
  if (!track) return;
  const raw = track.mediaStreamTrack;
  if (!raw) return;
  const want = track.isMuted ? false : isPtt() ? open : true;
  if (raw.enabled !== want) raw.enabled = want;
}

function notify() {
  apply(current);
  listeners.forEach((l) => l());
}

/** Touche push-to-talk enfoncée / relâchée (depuis les raccourcis). */
export function setPttHeld(down: boolean) {
  if (down === held) return;
  held = down;
  clearTimeout(releaseTimer);
  const inVoice = !!current && isPtt();
  if (down) {
    if (!open && inVoice && getSettings().audio.pttSound) playSound("pttOn");
    open = true;
    notify();
  } else {
    // petit délai : on ne coupe pas la fin des mots
    releaseTimer = setTimeout(() => {
      open = false;
      if (inVoice && getSettings().audio.pttSound) playSound("pttOff");
      notify();
    }, getSettings().audio.pttDelay);
    listeners.forEach((l) => l());
  }
}

/** Suit une connexion vocale : garde la piste micro dans le bon état. */
export function watchPtt(room: Room): () => void {
  current = room;
  const reapply = () => apply(room);
  const onPublished = () => {
    const track = micTrack(room);
    if (track) {
      track.off(TrackEvent.Unmuted, reapply).on(TrackEvent.Unmuted, reapply);
      track.off(TrackEvent.Restarted, reapply).on(TrackEvent.Restarted, reapply);
    }
    reapply();
  };
  room.on(RoomEvent.LocalTrackPublished, onPublished);
  onPublished();
  // Filet de sécurité (changement de micro, reconnexion…) : léger, 4 fois par seconde.
  const safety = setInterval(reapply, 250);
  const offSettings = onSettingsChange(() => notify());
  return () => {
    clearInterval(safety);
    offSettings();
    room.off(RoomEvent.LocalTrackPublished, onPublished);
    if (current === room) current = null;
  };
}

/** Pour l'interface : mode du micro et touche tenue. */
export function usePtt(): { ptt: boolean; open: boolean } {
  const [, force] = useState(0);
  useEffect(() => {
    const fn = () => force((n) => n + 1);
    listeners.add(fn);
    const off = onSettingsChange(fn);
    return () => {
      listeners.delete(fn);
      off();
    };
  }, []);
  return { ptt: isPtt(), open: held || open };
}
