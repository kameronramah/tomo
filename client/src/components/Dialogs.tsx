import { useState, type ReactNode } from "react";
import { getServerInfo, normalizeApiUrl } from "../lib/voice";
import type { SavedServer } from "../lib/storage";

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose?: () => void }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal card" role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

/** Choix du pseudo : au premier lancement (sans bouton Annuler) ou pour le modifier. */
export function ProfileDialog({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (name: string) => void;
  onClose?: () => void;
}) {
  const [name, setName] = useState(initial);
  const first = !onClose;
  return (
    <Modal title={first ? "Bienvenue sur Talk2Mates 👋" : "Ton pseudo"} onClose={onClose}>
      {first && <p className="muted">Choisis le pseudo que tes amis verront.</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onSave(name.trim());
        }}
      >
        <label>
          Pseudo
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} required autoFocus />
        </label>
        <div className="actions">
          {onClose && (
            <button type="button" className="ghost" onClick={onClose}>
              Annuler
            </button>
          )}
          <button type="submit">{first ? "C'est parti" : "Enregistrer"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Rejoindre un serveur : adresse + code d'invitation, vérifiés auprès de l'API. */
export function AddServerDialog({
  onAdd,
  onClose,
}: {
  onAdd: (server: Omit<SavedServer, "id">) => void;
  onClose: () => void;
}) {
  const [apiUrl, setApiUrl] = useState("");
  const [invite, setInvite] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    const access = { apiUrl: normalizeApiUrl(apiUrl), invite: invite.trim() };
    try {
      const info = await getServerInfo(access);
      onAdd({ ...access, name: info.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Rejoindre un serveur" onClose={onClose}>
      <p className="muted">Demande l'adresse et le code d'invitation à la personne qui héberge le serveur.</p>
      <form onSubmit={submit}>
        <label>
          Adresse du serveur
          <input
            value={apiUrl}
            onChange={(e) => setApiUrl(e.target.value)}
            placeholder="t2m-api.duckdns.org"
            required
            autoFocus
          />
        </label>
        <label>
          Code d'invitation
          <input type="password" value={invite} onChange={(e) => setInvite(e.target.value)} required />
        </label>
        {error && <p className="error">{error}</p>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" disabled={busy}>
            {busy ? "Vérification…" : "Rejoindre"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
