import { useState } from "react";
import type { Api, Friend } from "../lib/api";
import { errorMessage } from "../lib/ui";
import { Avatar, Icon } from "./Brand";
import { t } from "../lib/i18n";

type Tab = "online" | "all" | "pending" | "add";

type Props = {
  api: Api;
  friends: Friend[];
  onChanged: () => void;
  onMessage: (f: Friend) => void;
  onCall: (f: Friend) => void;
};

export default function FriendsView({ api, friends, onChanged, onMessage, onCall }: Props) {
  const pending = friends.filter((f) => f.status !== "friend");
  const accepted = friends.filter((f) => f.status === "friend");
  const online = accepted.filter((f) => f.online);
  const [tab, setTab] = useState<Tab>(online.length ? "online" : accepted.length ? "all" : pending.length ? "pending" : "add");
  const [username, setUsername] = useState("");
  const [info, setInfo] = useState<{ ok: boolean; text: string }>();

  async function act(fn: () => Promise<unknown>) {
    try {
      await fn();
      onChanged();
    } catch (err) {
      setInfo({ ok: false, text: errorMessage(err) });
    }
  }

  const list = tab === "online" ? online : tab === "all" ? accepted : pending;

  return (
    <section className="friends">
      <header className="view-header">
        <span className="row gap-10">
          <span className="feature-icon teal">
            <Icon name="users" />
          </span>
          <h1 className="title-sm">{t("Amis")}</h1>
        </span>
        <nav className="tabs" role="tablist">
          {(
            [
              ["online", `En ligne · ${online.length}`],
              ["all", `Tous · ${accepted.length}`],
              ["pending", `En attente${pending.length ? ` · ${pending.length}` : ""}`],
            ] as [Tab, string][]
          ).map(([t, label]) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
              {label}
              {t === "pending" && pending.some((f) => f.status === "incoming") && <span className="badge-dot" />}
            </button>
          ))}
          <button role="tab" aria-selected={tab === "add"} className={`add${tab === "add" ? " on" : ""}`} onClick={() => setTab("add")}>
            <Icon name="userPlus" size={16} /> {t("Ajouter")}
          </button>
        </nav>
      </header>

      <div className="view-body">
        {tab === "add" ? (
          <div className="add-friend">
            <h2 className="title-sm">{t("Ajouter un ami")}</h2>
            <p className="muted">{t("Tape le pseudo exact de ton ami sur tomo. Il recevra une demande à accepter.")}</p>
            <form
              className="row gap-8"
              onSubmit={(e) => {
                e.preventDefault();
                setInfo(undefined);
                api
                  .addFriend(username.trim())
                  .then((r) => {
                    setInfo({ ok: true, text: r.status === "friend" ? t("Vous êtes maintenant amis 🎉") : t("Demande envoyée à {0} !", { 0: username.trim() }) });
                    setUsername("");
                    onChanged();
                  })
                  .catch((err) => setInfo({ ok: false, text: errorMessage(err) }));
              }}
            >
              <input className="grow" value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("Pseudo de ton ami")} aria-label={t("Pseudo de ton ami")} autoFocus />
              <button className="btn primary" disabled={!username.trim()}>
                {t("Envoyer la demande")}
              </button>
            </form>
            {info && <p className={info.ok ? "ok" : "error"}>{info.text}</p>}
          </div>
        ) : list.length === 0 ? (
          <div className="empty-state">
            <span className="feature-icon lg">
              <Icon name="users" size={22} />
            </span>
            <p className="muted">
              {tab === "online" ? t("Aucun ami en ligne pour l'instant.") : tab === "all" ? t("Tu n'as pas encore d'amis sur tomo.") : t("Aucune demande en attente.")}
            </p>
            {tab !== "pending" && (
              <button className="btn" onClick={() => setTab("add")}>
                <Icon name="userPlus" size={16} /> {t("Ajouter un ami")}
              </button>
            )}
          </div>
        ) : (
          <ul className="friend-list">
            {list.map((f) => (
              <li key={f.id}>
                <span className="avatar-wrap">
                  <Avatar name={f.displayName ?? f.username} src={f.avatarUrl} size={38} />
                  {f.status === "friend" && <span className={`status-dot${f.online ? "" : " off"}`} />}
                </span>
                <span className="grow col gap-2">
                  <strong>{f.username}</strong>
                  <span className="muted small">
                    {f.status === "friend" ? (f.online ? t("En ligne") : t("Hors ligne")) : f.status === "incoming" ? t("Demande reçue") : t("Demande envoyée")}
                  </span>
                </span>
                {f.status === "friend" && (
                  <>
                    <button className="icon-btn round" onClick={() => onMessage(f)} aria-label={t("Écrire à {0}", { 0: f.username })} title={t("Message")}>
                      <Icon name="chat" />
                    </button>
                    <button
                      className="icon-btn round"
                      onClick={() => onCall(f)}
                      disabled={!f.online}
                      aria-label={t("Appeler {0}", { 0: f.username })}
                      title={f.online ? t("Appeler") : t("Hors ligne")}
                    >
                      <Icon name="phone" />
                    </button>
                  </>
                )}
                {f.status === "incoming" && (
                  <button className="icon-btn round ok-btn" onClick={() => act(() => api.acceptFriend(f.id))} aria-label={t("Accepter {0}", { 0: f.username })} title={t("Accepter")}>
                    <Icon name="check" />
                  </button>
                )}
                <button
                  className="icon-btn round danger"
                  onClick={() => act(() => api.removeFriend(f.id))}
                  aria-label={f.status === "friend" ? t("Retirer {0}", { 0: f.username }) : f.status === "incoming" ? t("Refuser") : t("Annuler la demande")}
                  title={f.status === "friend" ? t("Retirer des amis") : f.status === "incoming" ? t("Refuser") : t("Annuler")}
                >
                  <Icon name="x" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {info && tab !== "add" && <p className="error pad">{info.text}</p>}
      </div>
    </section>
  );
}
