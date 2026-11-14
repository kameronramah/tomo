import { useEffect, useRef, useState } from "react";
import { getUpdateState, onUpdateState, restartNow, startUpdateChecks, type UpdateState } from "../lib/updater";
import { Icon } from "./Brand";
import { t } from "../lib/i18n";

/**
 * Pop-up « Une nouvelle version de Tomo est prête ».
 * - Jamais pendant un vocal : elle attend qu'on le quitte.
 * - « Plus tard » la ferme ; elle revient au prochain départ d'un vocal (et la mise à jour est imposée au prochain lancement).
 * - Version imposée par le serveur (« required ») : pas de « Plus tard ».
 * Tomo ne redémarre jamais tout seul.
 */
export default function UpdateCard({ inVoice, apiBase }: { inVoice: boolean; apiBase: string }) {
  const [up, setUp] = useState<UpdateState>(getUpdateState());
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const wasInVoice = useRef(inVoice);
  useEffect(() => onUpdateState(setUp), []);
  useEffect(() => startUpdateChecks(apiBase), [apiBase]);

  // Départ d'un vocal : la pop-up revient même si on avait dit « Plus tard ».
  useEffect(() => {
    if (wasInVoice.current && !inVoice) setDismissed(false);
    wasInVoice.current = inVoice;
  }, [inVoice]);

  const required = up.kind === "required";
  if (inVoice || (up.kind !== "ready" && !required) || (dismissed && !required)) return null;
  const web = up.kind === "ready" && up.web;

  async function install() {
    setBusy(true);
    try {
      await restartNow();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal update-modal" role="dialog" aria-modal="true" aria-label={t("Mise à jour de Tomo")}>
        <div className="row gap-12">
          <span className="feature-icon teal">
            <Icon name="download" size={18} />
          </span>
          <div className="col gap-4 grow">
            <h2 className="title-sm">{required ? t("Mise à jour obligatoire") : t("Une nouvelle version de Tomo est prête")}</h2>
            <span className="muted small">
              {required
                ? t("Ton serveur Tomo demande au moins la version {0}. Mets à jour pour continuer.", { 0: up.minVersion })
                : web
                  ? t("Recharge la page pour l'utiliser (quelques secondes).")
                  : t("Tomo {0} est téléchargée. L'installation prend quelques secondes, puis Tomo se relance.", { 0: up.kind === "ready" ? up.version : "" })}
            </span>
          </div>
        </div>
        <div className="row gap-8 update-modal-actions">
          {!required && (
            <button className="btn" onClick={() => setDismissed(true)} disabled={busy}>
              {t("Plus tard")}
            </button>
          )}
          <button className="btn primary" onClick={() => void install()} disabled={busy}>
            {busy ? t("Un instant…") : web ? t("Recharger maintenant") : t("Mettre à jour maintenant")}
          </button>
        </div>
      </div>
    </div>
  );
}
