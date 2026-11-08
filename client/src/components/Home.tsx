import { useEffect, useRef, useState } from "react";
import type { RoomInfo, ServerDetail } from "../lib/api";
import { loadDevices } from "../lib/prefs";
import { greeting } from "../lib/ui";
import { Avatar, Icon, Logo } from "./Brand";

/** Premier lancement : aucun serveur. */
export function Welcome({ name, onCreate, onJoin }: { name: string; onCreate: () => void; onJoin: () => void }) {
  return (
    <div className="welcome">
      <Logo size={64} cut="var(--bg)" />
      <div className="col gap-8 center">
        <h1 className="display-sm">Bienvenue {name} !</h1>
        <p className="muted text">Tu n'as encore aucun serveur. Crée le tien ou rejoins celui de tes potes.</p>
      </div>
      <div className="welcome-cards">
        <button className="big-card" onClick={onCreate}>
          <span className="feature-icon teal lg">
            <Icon name="plus" size={22} />
          </span>
          <strong>Créer un serveur</strong>
          <span className="muted small">Tu en seras l'admin : salons, invitations, membres.</span>
        </button>
        <button className="big-card" onClick={onJoin}>
          <span className="feature-icon amber lg">
            <Icon name="login" size={22} />
          </span>
          <strong>Rejoindre avec un code</strong>
          <span className="muted small">Un ami t'a envoyé un code ? Colle-le ici.</span>
        </button>
      </div>
    </div>
  );
}

/** Test du micro avant d'entrer dans un salon. */
export function MicTester() {
  const [level, setLevel] = useState(0);
  const [running, setRunning] = useState(false);
  const [label, setLabel] = useState<string>();
  const [error, setError] = useState<string>();
  const stopRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => stopRef.current?.(), []);

  async function start() {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: loadDevices().input, echoCancellation: true, noiseSuppression: true },
      });
      setLabel(stream.getAudioTracks()[0]?.label);
      const ctx = new AudioContext();
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      let raf = 0;
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 64));
        raf = requestAnimationFrame(tick);
      };
      tick();
      setRunning(true);
      stopRef.current = () => {
        cancelAnimationFrame(raf);
        stream.getTracks().forEach((t) => t.stop());
        ctx.close();
        setRunning(false);
        setLevel(0);
      };
    } catch {
      setError("Impossible d'accéder au micro. Vérifie l'autorisation dans Windows.");
    }
  }

  const bars = 8;
  return (
    <div className="mic-tester">
      <span className="feature-icon amber">
        <Icon name="mic" />
      </span>
      <span className="grow col gap-2">
        <strong>{running ? label || "Micro actif" : "Tester mon micro"}</strong>
        <span className="muted small">{error ?? (running ? "Parle : les barres doivent bouger." : "Vérifie ton niveau avant d'entrer.")}</span>
      </span>
      {running && (
        <span className="level" aria-label={`Niveau du micro ${Math.round(level * 100)} %`} role="img">
          {Array.from({ length: bars }, (_, i) => (
            <span key={i} className={i < Math.round(level * bars) ? "on" : ""} style={{ height: 6 + i * 2 }} />
          ))}
        </span>
      )}
      <button className="btn small" onClick={() => (running ? stopRef.current?.() : start())}>
        {running ? "Arrêter" : "Tester"}
      </button>
    </div>
  );
}

/** Accueil d'un serveur quand on n'est pas (ou pas ici) en vocal. */
export function ServerHome({
  name,
  detail,
  canInvite,
  joiningRoomId,
  onJoin,
  onInvite,
}: {
  name: string;
  detail: ServerDetail;
  canInvite: boolean;
  joiningRoomId?: string;
  onJoin: (room: RoomInfo) => void;
  onInvite: () => void;
}) {
  const inVoice = detail.rooms.reduce((n, r) => n + r.participants.length, 0);
  return (
    <div className="home">
      <header className="row space-between wrap gap-12">
        <div className="col gap-6">
          <h1 className="display-sm">
            {greeting()} {name}
          </h1>
          <span className="muted text">
            {inVoice > 0 ? (
              <>
                {inVoice} {inVoice > 1 ? "potes sont" : "pote est"} en vocal sur <strong className="text-strong">{detail.name}</strong>.
                Clique sur un salon pour les rejoindre.
              </>
            ) : (
              <>
                Personne en vocal sur <strong className="text-strong">{detail.name}</strong> pour l'instant. Lance la soirée !
              </>
            )}
          </span>
        </div>
        {canInvite && (
          <button className="btn pill" onClick={onInvite}>
            <Icon name="userPlus" size={16} /> Inviter
          </button>
        )}
      </header>

      <div className="room-grid">
        {detail.rooms.map((room) => {
          const busy = room.participants.length > 0;
          return (
            <div key={room.id} className="room-tile">
              <div className="row gap-10">
                <span className={`feature-icon${busy ? " teal" : ""}`}>
                  <Icon name={room.spatial ? "orbit" : busy ? "speakerLoud" : "speaker"} />
                </span>
                <span className="grow col gap-2">
                  <strong>{room.label}</strong>
                  <span className={`small ${busy ? "teal-soft" : "muted"}`}>
                    {busy
                      ? `${room.participants.length} en vocal`
                      : room.spatial
                        ? "Audio spatial activé"
                        : "Personne pour l'instant"}
                  </span>
                </span>
              </div>
              {busy ? (
                <div className="row gap-8">
                  <span className="stack">
                    {room.participants.slice(0, 5).map((p) => (
                      <Avatar key={p.identity} name={p.name} size={28} />
                    ))}
                  </span>
                  <span className="small soft ellipsis">{room.participants.map((p) => p.name).join(", ")}</span>
                </div>
              ) : (
                <span className="muted small tile-hint">Sois le premier, tes potes verront que tu es là.</span>
              )}
              <button
                className={`btn ${busy ? "primary" : "outline"}`}
                onClick={() => onJoin(room)}
                disabled={joiningRoomId === room.id}
              >
                {joiningRoomId === room.id ? "Connexion…" : "Rejoindre"}
              </button>
            </div>
          );
        })}
      </div>

      <MicTester />
    </div>
  );
}
