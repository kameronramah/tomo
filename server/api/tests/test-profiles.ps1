# Tests des profils, statuts, confidentialité, demandes de message et blocages — serveur de dev lancé :
#   docker compose -f server/docker-compose.dev.yml up -d
# Lancer : powershell -ExecutionPolicy Bypass -File server\api\tests\test-profiles.ps1
$base = "http://localhost:3000"; $s = Get-Random -Maximum 99999
function Call($method, $path, $body = $null, $token = $null) {
  $h = @{}; if ($token) { $h.Authorization = "Bearer $token" }
  $p = @{ Method = $method; Uri = "$base$path"; Headers = $h }
  if ($null -ne $body) { $p.ContentType = "application/json; charset=utf-8"; $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress)) }
  for ($try = 0; $try -lt 2; $try++) {
    try { return @{ ok = $true; data = Invoke-RestMethod @p } }
    catch { $err = @{ ok = $false; status = $_.Exception.Response.StatusCode.value__; data = $_.ErrorDetails.Message }; if ($err.status -eq 429 -and $try -eq 0) { Write-Host "(limitation de l'API : pause d'une minute)"; Start-Sleep 61; continue }; return $err }
  }
}
function Upload($bytes, $query, $token) {
  try { return @{ ok = $true; data = Invoke-RestMethod -Method POST -Uri "$base/attachments?$query" -Headers @{ Authorization = "Bearer $token" } -ContentType "application/octet-stream" -Body $bytes } }
  catch { return @{ ok = $false; status = $_.Exception.Response.StatusCode.value__ } }
}
function Check($l, $c) { if ($c) { "OK   $l" } else { "FAIL $l" } }

$pw = "une-phrase-de-passe-solide"
$A = (Call POST "/auth/register" @{ username = "Pa$s"; password = $pw; email = "Pa$s@exemple.test" }).data
$B = (Call POST "/auth/register" @{ username = "Pb$s"; password = $pw; email = "Pb$s@exemple.test" }).data
$C = (Call POST "/auth/register" @{ username = "Pc$s"; password = $pw; email = "Pc$s@exemple.test" }).data
$tA = $A.accessToken; $tB = $B.accessToken; $tC = $C.accessToken
$idA = $A.user.id; $idB = $B.user.id; $idC = $C.user.id

# ---- Profil -------------------------------------------------------------------
$r = Call PATCH "/me/profile" @{ displayName = "Kaze"; bio = "Toujours partant pour un ranked."; accent = "#2dd4bf" } $tA
Check "profil modifié (nom affiché, phrase, couleur)" ($r.ok -and $r.data.displayName -eq "Kaze")
$r = Call PATCH "/me/profile" @{ accent = "rouge" } $tA; Check "couleur invalide refusée (400)" ($r.status -eq 400)
$r = Call PATCH "/me/profile" @{ bio = ("x" * 191) } $tA; Check "phrase trop longue refusée (400)" ($r.status -eq 400)

$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
$img = Upload $png "name=moi.png&width=1&height=1" $tA
$r = Call PATCH "/me/profile" @{ avatarId = $img.data.id } $tA; Check "photo de profil enregistrée" ($r.ok -and $r.data.avatarUrl)
try { $f = Invoke-WebRequest -Uri "$base$($r.data.avatarUrl)" -UseBasicParsing; $okImg = $f.StatusCode -eq 200 } catch { $okImg = $false }
Check "photo de profil lisible" $okImg
$txt = Upload ([Text.Encoding]::UTF8.GetBytes("pas une image")) "name=a.txt" $tA
$r = Call PATCH "/me/profile" @{ bannerId = $txt.data.id } $tA; Check "bannière qui n'est pas une image refusée (400)" ($r.status -eq 400)
$other = Upload $png "name=b.png" $tB
$r = Call PATCH "/me/profile" @{ avatarId = $other.data.id } $tA; Check "impossible de prendre l'image de quelqu'un d'autre (400)" ($r.status -eq 400)

# ---- Statut -------------------------------------------------------------------
$r = Call PATCH "/me/status" @{ status = "dnd"; customStatus = "Dispo pour un ranked" } $tA; Check "statut « ne pas déranger » + statut perso" $r.ok
$r = Call GET "/me/profile" $null $tA; Check "statut choisi enregistré" ($r.data.chosenStatus -eq "dnd" -and $r.data.customStatusRaw -eq "Dispo pour un ranked")
$r = Call PATCH "/me/status" @{ status = "absent" } $tA; Check "statut inconnu refusé (400)" ($r.status -eq 400)

# ---- Serveur en commun : A et B ; C ne partage rien -------------------------------
$srv = (Call POST "/servers" @{ name = "Profils" } $tB).data
$inv = Call POST "/servers/$($srv.id)/invites" @{ kind = "member" } $tB
$r = Call POST "/invites/$($inv.data.code)/accept" $null $tA; Check "A rejoint le serveur de B" $r.ok
$r = Call GET "/servers/$($srv.id)/people" $null $tB
$pa = @($r.data) | Where-Object { $_.id -eq $idA }
Check "liste des membres : nom affiché et photo de A" ($r.ok -and $pa.displayName -eq "Kaze" -and $pa.avatarUrl)
Check "liste des membres : A hors ligne (pas connecté en temps réel)" ($pa.status -eq "offline")
$r = Call GET "/servers/$($srv.id)/people" $null $tC; Check "C (pas membre) ne voit pas la liste (404)" ($r.status -eq 404)

$r = Call GET "/users/$idA/profile" $null $tB; Check "B voit la fiche de A (phrase, membre depuis)" ($r.ok -and $r.data.bio -like "Toujours*" -and $r.data.createdAt)
Check "fiche : 1 serveur en commun, peut écrire" ($r.data.commonServers -eq 1 -and $r.data.canMessage)
$r = Call GET "/users/$idA/profile" $null $tC; Check "C (aucun lien) ne voit pas la fiche de A (404)" ($r.status -eq 404)

# ---- Messages hors amis -------------------------------------------------------------
$r = Call POST "/dm/$idA/messages" @{ content = "salut" } $tC; Check "C (aucun serveur commun) ne peut pas écrire à A (403)" ($r.status -eq 403)
$r = Call POST "/dm/$idA/messages" @{ content = "On cherche un 5e ce soir ?" } $tB; Check "B (même serveur) peut écrire à A" $r.ok
$r = Call GET "/dm" $null $tA; $conv = @($r.data) | Where-Object { $_.userId -eq $idB }
Check "chez A : la conversation est une demande" ($conv.request -eq $true)
$r = Call GET "/dm" $null $tB; $conv = @($r.data) | Where-Object { $_.userId -eq $idA }
Check "chez B (qui a écrit) : ce n'est pas une demande" ($conv.request -eq $false)
$r = Call POST "/dm/$idB/accept" $null $tA; Check "A accepte la demande" $r.ok
$r = Call GET "/dm" $null $tA; $conv = @($r.data) | Where-Object { $_.userId -eq $idB }
Check "après acceptation : plus une demande" ($conv.request -eq $false)

$r = Call PATCH "/me/privacy" @{ dm = "everyone" } $tA; Check "A ouvre ses messages à tout le monde" $r.ok
$r = Call POST "/dm/$idA/messages" @{ content = "coucou" } $tC; Check "C peut maintenant écrire à A" $r.ok
$r = Call PATCH "/me/privacy" @{ dm = "friends"; friend = "nobody" } $tA; Check "A : messages amis seulement, aucune demande d'ami" $r.ok
$r = Call POST "/friends" @{ username = "Pa$s" } $tB; Check "demande d'ami refusée par le réglage de A (403)" ($r.status -eq 403)
$r = Call PATCH "/me/privacy" @{ dm = "n'importe" } $tA; Check "réglage invalide refusé (400)" ($r.status -eq 400)
$r = Call POST "/calls/$idA" $null $tB; Check "appel d'un non-ami refusé par défaut (403)" ($r.status -eq 403)

# ---- Blocage --------------------------------------------------------------------
$r = Call POST "/blocks/$idB" $null $tA; Check "A bloque B" $r.ok
$r = Call POST "/dm/$idA/messages" @{ content = "tu m'entends ?" } $tB; Check "B bloqué ne peut plus écrire à A (403)" ($r.status -eq 403)
$r = Call GET "/blocks" $null $tA; Check "B dans la liste des bloqués de A" (@($r.data).Count -eq 1 -and $r.data[0].id -eq $idB)
$r = Call GET "/dm" $null $tA; Check "conversation avec B masquée chez A" (-not (@($r.data) | Where-Object { $_.userId -eq $idB }))
$r = Call DELETE "/blocks/$idB" $null $tA; Check "A débloque B" $r.ok
$r = Call GET "/blocks" $null $tA; Check "liste des bloqués vide" (@($r.data).Count -eq 0)
