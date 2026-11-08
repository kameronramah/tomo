import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Channel, RoomInfo, ServerDetail } from "../lib/api";
import { loadDevices } from "../lib/prefs";
import { Icon, Logo, UserAvatar } from "./Brand";

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
      <span className="grow col gap-2" style={{ minWidth: 0 }}>
        <strong className="ellipsis" title={label}>{running ? label || "Micro actif" : "Tester mon micro"}</strong>
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

type HomeProps = {
  detail: ServerDetail;
  isGuest: boolean;
  isManager: boolean;
  /** Ma présence en vocal (dans ce serveur ou ailleurs) */
  voice: { roomId: string; identity: string; ping?: ReactNode } | null;
  myName: string;
  speaking: ReadonlySet<string>;
  unread: Record<string, number>;
  /** Liste des membres (colonne de droite) */
  members: ReactNode;
  joiningRoomId?: string;
  onJoin: (room: RoomInfo) => void;
  onInvite: () => void;
  onManage: () => void;
  onAddRoom: () => void;
  onRenameRoom: (room: RoomInfo) => void;
  onDeleteRoom: (room: RoomInfo) => void;
  onOpenChannel: (c: Channel) => void;
  onAddChannel: () => void;
  onRenameChannel: (c: Channel) => void;
  onDeleteChannel: (c: Channel) => void;
};

/** Petit menu « ⋯ » (renommer / supprimer) pour les admins. */
function MoreMenu({ label, onRename, onDelete }: { label: string; onRename: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <button className="icon-btn sm" aria-label={`Options de ${label}`} aria-expanded={open} onClick={(e) => (e.stopPropagation(), setOpen(!open))}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <>
          <div className="click-away" onClick={() => setOpen(false)} />
          <div className="popover room-menu" role="menu">
            <button role="menuitem" className="menu-item" onClick={() => (setOpen(false), onRename())}>
              <Icon name="edit" size={16} /> Renommer
            </button>
            <button role="menuitem" className="menu-item danger" onClick={() => (setOpen(false), onDelete())}>
              <Icon name="trash" size={16} /> Supprimer
            </button>
          </div>
        </>
      )}
    </span>
  );
}

/** Accueil d'un serveur : les pièces vocales en cartes, les fils, et qui est là ce soir. */
export function ServerHome(p: HomeProps) {
  const { detail } = p;
  const inVoice = detail.rooms.reduce((n, r) => n + r.participants.length, 0);

  return (
    <div className="home">
      <div className="home-main">
        <header className="home-head">
          <div className="col gap-6">
            <h1 className="display-sm">{detail.name}</h1>
            <span className="muted">
              {inVoice > 0 ? `${inVoice} en vocal` : "Personne en vocal"} · {detail.rooms.length} pièce{detail.rooms.length > 1 ? "s" : ""} ·{" "}
              {detail.channels.length} fil{detail.channels.length > 1 ? "s" : ""}
            </span>
          </div>
          <div className="row gap-8 wrap">
            {!p.isGuest && (
              <button className="btn soft" onClick={p.onInvite}>
                <Icon name="userPlus" size={16} /> Inviter
              </button>
            )}
            {p.isManager && (
              <button className="btn soft" onClick={p.onAddRoom}>
                <Icon name="plus" size={16} /> Nouvelle pièce
              </button>
            )}
            {!p.isGuest && (
              <button className="icon-btn" onClick={p.onManage} aria-label="Gérer le serveur" title="Gérer le serveur">
                <Icon name="settings" size={18} />
              </button>
            )}
          </div>
        </header>

        <section className="pieces" aria-label="Pièces vocales">
          {detail.rooms.length === 0 && <p className="muted">Aucune pièce vocale. {p.isManager ? "Crée-en une avec « Nouvelle pièce »." : ""}</p>}
          {detail.rooms.map((room) => {
            const here = p.voice?.roomId === room.id;
            const others = room.participants.filter((x) => x.identity !== p.voice?.identity);
            const people = here && p.voice ? [{ identity: p.voice.identity, name: p.myName, guest: p.isGuest }, ...others] : others;
            const busy = people.length > 0;
            const chat = p.unread[`room:${room.id}`] ?? 0;
            return (
              <article key={room.id} className={`piece${here ? " here" : ""}${busy ? "" : " empty"}`}>
                <div className="piece-head">
                  <div className="col gap-4 grow" style={{ minWidth: 0 }}>
                    <h2 className="piece-title ellipsis">{room.label}</h2>
                    <span className={`small ${here ? "teal-soft strong-ish" : "muted"}`}>
                      {here ? <>Tu es ici {p.voice?.ping}</> : busy ? `${people.length} en vocal` : "Personne pour l'instant"}
                    </span>
                  </div>
                  {room.spatial && (
                    <span className="chip amber" title="Audio spatial activé">
                      <Icon name="orbit" size={13} /> Spatial
                    </span>
                  )}
                  {chat > 0 && <span className="badge-dot" title="Nouveaux messages dans la discussion" />}
                  {p.isManager && <MoreMenu label={room.label} onRename={() => p.onRenameRoom(room)} onDelete={() => p.onDeleteRoom(room)} />}
                </div>
                <div className="piece-people">
                  {busy ? (
                    people.slice(0, 6).map((x) => <UserAvatar key={x.identity} identity={x.identity} name={x.name} size={50} speaking={here && p.speaking.has(x.identity)} />)
                  ) : (
                    <span className="piece-empty-dot" aria-hidden="true">
                      <Icon name="plus" size={18} />
                    </span>
                  )}
                  {people.length > 6 && <span className="piece-more">+{people.length - 6}</span>}
                </div>
                <div className="piece-foot">
                  <span className="small soft ellipsis grow">{people.map((x) => x.name + (x.guest ? " (invité)" : "")).join(", ")}</span>
                  <button
                    className={`btn small round-pill ${here ? "" : busy ? "primary" : ""}`}
                    onClick={() => p.onJoin(room)}
                    disabled={p.joiningRoomId === room.id}
                  >
                    {p.joiningRoomId === room.id ? "Connexion…" : here ? "Ouvrir" : busy ? "Rejoindre" : "Entrer en premier"}
                  </button>
                </div>
              </article>
            );
          })}
        </section>

        <section className="fils" aria-label="Fils de discussion">
          <div className="row space-between fils-head">
            <span className="section-title">Fils</span>
            {p.isManager && (
              <button className="icon-btn sm" onClick={p.onAddChannel} aria-label="Nouveau fil" title="Nouveau fil">
                <Icon name="plus" size={15} />
              </button>
            )}
          </div>
          {detail.channels.map((c) => {
            const n = p.unread[`channel:${c.id}`] ?? 0;
            return (
              <div key={c.id} className={`fil${n ? " unread" : ""}`}>
                <button className="fil-main" onClick={() => p.onOpenChannel(c)}>
                  <span className="fil-hash">#</span>
                  <span className="grow col gap-2 left" style={{ minWidth: 0 }}>
                    <span className="fil-name ellipsis">{c.name}</span>
                    <span className="small muted">{n > 0 ? `${n} nouveau${n > 1 ? "x" : ""} message${n > 1 ? "s" : ""}` : "Ouvrir le fil"}</span>
                  </span>
                  {n > 0 && <span className="badge amber-badge-fill">{n > 99 ? "99+" : n}</span>}
                </button>
                {p.isManager && <MoreMenu label={c.name} onRename={() => p.onRenameChannel(c)} onDelete={() => p.onDeleteChannel(c)} />}
              </div>
            );
          })}
        </section>
      </div>

      <aside className="home-side" aria-label="Membres">
        {p.members}
      </aside>
    </div>
  );
}
