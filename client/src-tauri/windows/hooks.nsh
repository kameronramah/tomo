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

; Après l'installation (et après chaque mise à jour) : on prévient Windows que l'icône
; a pu changer. Sans ça, la recherche Windows et le menu Démarrer gardaient une icône
; générique (cache d'icônes pas rafraîchi quand tomo.exe est remplacé).
!macro NSIS_HOOK_POSTINSTALL
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
  nsExec::Exec `"$SYSDIR\ie4uinit.exe" -show`
  Pop $0
!macroend

; Le nom est passé de « tomo » à « Tomo » (v0.12.2). Windows garde la casse d'un fichier
; qu'on réécrit : on renomme donc l'ancien raccourci pour que le menu Démarrer affiche « Tomo ».
!macro NSIS_HOOK_PREINSTALL
  ${If} ${FileExists} "$SMPROGRAMS\tomo.lnk"
    Rename "$SMPROGRAMS\tomo.lnk" "$SMPROGRAMS\tomo-renomme.lnk"
    Rename "$SMPROGRAMS\tomo-renomme.lnk" "$SMPROGRAMS\Tomo.lnk"
  ${EndIf}
  ${If} ${FileExists} "$DESKTOP\tomo.lnk"
    Rename "$DESKTOP\tomo.lnk" "$DESKTOP\tomo-renomme.lnk"
    Rename "$DESKTOP\tomo-renomme.lnk" "$DESKTOP\Tomo.lnk"
  ${EndIf}
!macroend
