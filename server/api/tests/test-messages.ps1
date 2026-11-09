# Tests : modifier un message, réactions, mentions — serveur de dev lancé :
#   docker compose -f server/docker-compose.dev.yml up -d
# Lancer : powershell -ExecutionPolicy Bypass -File server\api\tests\test-messages.ps1
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
function Check($l, $c) { if ($c) { "OK   $l" } else { "FAIL $l" } }

$pw = "une-phrase-de-passe-solide"
$A = (Call POST "/auth/register" @{ username = "Ma$s"; password = $pw; email = "Ma$s@exemple.test" }).data
$B = (Call POST "/auth/register" @{ username = "Mb$s"; password = $pw; email = "Mb$s@exemple.test" }).data
$C = (Call POST "/auth/register" @{ username = "Mc$s"; password = $pw; email = "Mc$s@exemple.test" }).data
$tA = $A.accessToken; $tB = $B.accessToken; $tC = $C.accessToken
$srv = (Call POST "/servers" @{ name = "Messages" } $tA).data
$inv = (Call POST "/servers/$($srv.id)/invites" @{ kind = "member" } $tA).data
Call POST "/invites/$($inv.code)/accept" $null $tB | Out-Null
$ch = (Call GET "/servers/$($srv.id)" $null $tA).data.channels[0].id

# ---- Modifier -------------------------------------------------------------------
$m = (Call POST "/channels/$ch/messages" @{ content = "je suis la dans 10 min" } $tB).data
$r = Call PATCH "/messages/$($m.id)" @{ content = "je suis la dans 5 min" } $tB
Check "l'auteur modifie son message (marqué modifié)" ($r.ok -and $r.data.content -eq "je suis la dans 5 min" -and $r.data.editedAt)
$r = Call PATCH "/messages/$($m.id)" @{ content = "pirate" } $tA; Check "personne d'autre ne peut le modifier, même un admin (403)" ($r.status -eq 403)
$r = Call PATCH "/messages/$($m.id)" @{ content = "   " } $tB; Check "un message vide est refusé (400)" ($r.status -eq 400)
$list = (Call GET "/channels/$ch/messages" $null $tA).data
Check "l'historique montre la version modifiée" ((@($list) | Where-Object { $_.id -eq $m.id }).content -eq "je suis la dans 5 min")

# ---- Réactions -------------------------------------------------------------------
$r = Call POST "/messages/$($m.id)/reactions" @{ emoji = "👍" } $tA; Check "A réagit 👍" ($r.ok -and $r.data.reactions[0].count -eq 1)
$r = Call POST "/messages/$($m.id)/reactions" @{ emoji = "👍" } $tB; Check "B réagit 👍 aussi (2)" ($r.ok -and $r.data.reactions[0].count -eq 2)
$r = Call POST "/messages/$($m.id)/reactions" @{ emoji = "👍" } $tA; Check "A retire sa réaction (1)" ($r.ok -and $r.data.reactions[0].count -eq 1 -and $r.data.reactions[0].userIds[0] -eq $B.user.id)
$r = Call POST "/messages/$($m.id)/reactions" @{ emoji = "bonjour" } $tA; Check "une réaction qui n'est pas un emoji est refusée (400)" ($r.status -eq 400)
$r = Call POST "/messages/$($m.id)/reactions" @{ emoji = "🔥" } $tC; Check "C (pas membre) ne peut pas réagir (404)" ($r.status -eq 404)
$list = (Call GET "/channels/$ch/messages" $null $tA).data
Check "les réactions reviennent avec l'historique" (@((@($list) | Where-Object { $_.id -eq $m.id }).reactions).Count -eq 1)

# ---- Mentions ----------------------------------------------------------------------
$r = Call POST "/channels/$ch/messages" @{ content = "<@$($A.user.id)> tu viens ?" } $tB; Check "mention d'un membre gardée telle quelle" ($r.data.content -eq "<@$($A.user.id)> tu viens ?")
$r = Call POST "/channels/$ch/messages" @{ content = "<@tous> ce soir 21h" } $tB; Check "@tous par un non-admin devient du simple texte" ($r.data.content -eq "@tous ce soir 21h")
$r = Call POST "/channels/$ch/messages" @{ content = "<@tous> ce soir 21h" } $tA; Check "@tous par un admin est gardé" ($r.data.content -eq "<@tous> ce soir 21h")
$r = Call POST "/channels/$ch/messages" @{ content = "<@vocal> on lance" } $tB; Check "@vocal est permis à tous" ($r.data.content -eq "<@vocal> on lance")

$r = Call DELETE "/messages/$($m.id)" $null $tB; Check "suppression : les réactions partent avec le message" $r.ok
