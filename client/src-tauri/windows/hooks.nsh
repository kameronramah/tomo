; Étapes ajoutées à l'installateur Windows de tomo (NSIS).
;
; « Rester connecté » range le jeton de session dans le Gestionnaire d'identification
; Windows (voir src/lib.rs). Ce coffre-fort n'est pas touché par la désinstallation :
; sans ce nettoyage, réinstaller tomo reconnectait tout seul, sans redemander le mot de passe.
;
; À la désinstallation, on efface donc toutes les entrées « session:… » de tomo
; (cible Windows « session:<adresse du serveur>.com.tomo.app »).
; Pas pendant une mise à jour (/UPDATE) : là, on garde la session.

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    nsExec::Exec `powershell -NoProfile -NonInteractive -WindowStyle Hidden -Command "cmdkey /list | ForEach-Object { if ($$_ -match 'target=(session:\S*\.com\.tomo\.app)\s*$$') { cmdkey /delete:$$($$Matches[1]) | Out-Null } }"`
    Pop $0
  ${EndIf}
!macroend
