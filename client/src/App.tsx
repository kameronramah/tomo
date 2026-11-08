import { useState } from "react";
import type { Room } from "livekit-client";
import { joinRoom, loadSettings, saveSettings, type Settings } from "./lib/voice";
import RoomView from "./components/RoomView";
import "./App.css";

export default function App() {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [room, setRoom] = useState<Room | null>(null);
  const [warning, setWarning] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const update = (key: keyof Settings) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setSettings({ ...settings, [key]: e.target.value });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setBusy(true);
    const s = { ...settings, name: settings.name.trim(), room: settings.room.trim().toLowerCase() };
    saveSettings(s);
    try {
      const joined = await joinRoom(s);
      setWarning(joined.warning);
      setRoom(joined.room);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onLeave() {
    await room?.disconnect();
    setRoom(null);
    setWarning(undefined);
  }

  if (room) return <RoomView room={room} warning={warning} onLeave={onLeave} />;

  return (
    <main className="login">
      <h1>
        Talk2Mates <span className="tag">T2M</span>
      </h1>
      <p className="muted">Le vocal pensé pour jouer entre potes.</p>

      <form onSubmit={onSubmit} className="card">
        <label>
          Pseudo
          <input value={settings.name} onChange={update("name")} maxLength={32} required autoFocus />
        </label>
        <label>
          Salon
          <input
            value={settings.room}
            onChange={update("room")}
            pattern="[a-zA-Z0-9_\-]{1,32}"
            title="Lettres, chiffres, - et _"
            required
          />
        </label>
        <label>
          Code d'invitation
          <input type="password" value={settings.invite} onChange={update("invite")} required />
        </label>
        <details>
          <summary>Serveur</summary>
          <label>
            Adresse de l'API
            <input value={settings.apiUrl} onChange={update("apiUrl")} required />
          </label>
        </details>

        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={busy}>
          {busy ? "Connexion…" : "Rejoindre"}
        </button>
      </form>
    </main>
  );
}
