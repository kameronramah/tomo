import { useEffect, useState } from "react";
import type { Room } from "livekit-client";
import { joinRoom, type RoomInfo } from "./lib/voice";
import {
  loadActiveServerId,
  loadProfileName,
  loadServers,
  saveActiveServerId,
  saveProfileName,
  saveServers,
  type SavedServer,
} from "./lib/storage";
import ServerRail from "./components/ServerRail";
import ChannelSidebar from "./components/ChannelSidebar";
import VoicePanel from "./components/VoicePanel";
import { AddServerDialog, ProfileDialog } from "./components/Dialogs";
import "./App.css";

type Voice = {
  server: SavedServer;
  roomId: string;
  roomLabel: string;
  room: Room;
  warning?: string;
};

export default function App() {
  const [profileName, setProfileName] = useState(loadProfileName);
  const [servers, setServers] = useState<SavedServer[]>(loadServers);
  const [activeId, setActiveId] = useState<string | undefined>(
    () => loadActiveServerId() ?? loadServers()[0]?.id,
  );
  const [voice, setVoice] = useState<Voice | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [joiningRoomId, setJoiningRoomId] = useState<string>();
  const [error, setError] = useState<string>();
  const [dialog, setDialog] = useState<"add" | "profile" | null>(null);

  useEffect(() => saveServers(servers), [servers]);
  useEffect(() => saveActiveServerId(activeId ?? null), [activeId]);

  const activeServer = servers.find((s) => s.id === activeId) ?? servers[0];

  // ---- Serveurs ----------------------------------------------------------
  function addServer(data: Omit<SavedServer, "id">) {
    const existing = servers.find((s) => s.apiUrl === data.apiUrl);
    if (existing) {
      setServers(servers.map((s) => (s.id === existing.id ? { ...s, ...data } : s)));
      setActiveId(existing.id);
    } else {
      const server = { ...data, id: crypto.randomUUID() };
      setServers([...servers, server]);
      setActiveId(server.id);
    }
    setDialog(null);
  }

  async function removeServer(id: string) {
    if (voice?.server.id === id) await leaveVoice();
    const rest = servers.filter((s) => s.id !== id);
    setServers(rest);
    if (activeId === id) setActiveId(rest[0]?.id);
  }

  function renameServer(id: string, name: string) {
    setServers((list) => list.map((s) => (s.id === id ? { ...s, name } : s)));
  }

  // ---- Vocal -------------------------------------------------------------
  async function joinChannel(server: SavedServer, info: RoomInfo) {
    if (voice?.server.id === server.id && voice.roomId === info.id) return;
    setError(undefined);
    setJoiningRoomId(info.id);
    try {
      // On quitte l'ancien salon avant d'entrer dans le nouveau (un seul vocal à la fois).
      if (voice) {
        const previous = voice.room;
        setVoice(null);
        await previous.disconnect();
      }
      const joined = await joinRoom(server, profileName, info.id, { micEnabled });
      setVoice({ server, roomId: info.id, roomLabel: info.label, room: joined.room, warning: joined.warning });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setJoiningRoomId(undefined);
    }
  }

  async function leaveVoice() {
    const current = voice;
    setVoice(null);
    await current?.room.disconnect();
  }

  /** Déconnexion subie (réseau, serveur) : on ne réagit que si c'est le salon actuel. */
  function onRoomDisconnected(room: Room) {
    setVoice((v) => (v?.room === room ? null : v));
  }

  // ---- Rendu -------------------------------------------------------------
  if (!profileName) {
    return (
      <ProfileDialog
        initial=""
        onSave={(name) => {
          saveProfileName(name);
          setProfileName(name);
        }}
      />
    );
  }

  return (
    <div className="app">
      <ServerRail
        servers={servers}
        activeId={activeServer?.id}
        voiceServerId={voice?.server.id}
        onSelect={setActiveId}
        onAdd={() => setDialog("add")}
      />

      <ChannelSidebar
        server={activeServer}
        voice={
          voice
            ? {
                serverId: voice.server.id,
                serverName: voice.server.name,
                roomId: voice.roomId,
                roomLabel: voice.roomLabel,
                identity: voice.room.localParticipant.identity,
              }
            : undefined
        }
        joiningRoomId={joiningRoomId}
        profileName={profileName}
        onJoin={(info) => activeServer && joinChannel(activeServer, info)}
        onLeaveVoice={leaveVoice}
        onRenameServer={renameServer}
        onRemoveServer={removeServer}
        onEditProfile={() => setDialog("profile")}
      />

      <main className="content">
        {error && (
          <p className="error banner" onClick={() => setError(undefined)}>
            {error}
          </p>
        )}
        {voice ? (
          <VoicePanel
            key={voice.room.name + voice.server.id}
            room={voice.room}
            roomLabel={voice.roomLabel}
            serverName={voice.server.name}
            warning={voice.warning}
            onLeave={leaveVoice}
            onMicChange={setMicEnabled}
            onDisconnected={onRoomDisconnected}
          />
        ) : (
          <div className="empty">
            {servers.length === 0 ? (
              <>
                <h2>Aucun serveur pour l'instant</h2>
                <p className="muted">Rejoins le serveur de tes amis avec son adresse et son code d'invitation.</p>
                <button onClick={() => setDialog("add")}>Rejoindre un serveur</button>
              </>
            ) : (
              <>
                <h2>Pas encore en vocal</h2>
                <p className="muted">Clique sur un salon à gauche pour le rejoindre.</p>
              </>
            )}
          </div>
        )}
      </main>

      {dialog === "add" && <AddServerDialog onAdd={addServer} onClose={() => setDialog(null)} />}
      {dialog === "profile" && (
        <ProfileDialog
          initial={profileName}
          onSave={(name) => {
            saveProfileName(name);
            setProfileName(name);
            setDialog(null);
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
