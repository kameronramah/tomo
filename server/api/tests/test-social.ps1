# Tests de bout en bout de l'API tomo (serveur de dev lancé : docker compose -f server/docker-compose.dev.yml up -d)
# Lancer : powershell -ExecutionPolicy Bypass -File server\api\tests\test-social.ps1
$base = "http://localhost:3000"; $s = Get-Random -Maximum 99999
function Call($method, $path, $body = $null, $token = $null) {
  $h = @{}; if ($token) { $h.Authorization = "Bearer $token" }
  $p = @{ Method = $method; Uri = "$base$path"; Headers = $h }
  if ($null -ne $body) { $p.ContentType = "application/json; charset=utf-8"; $p.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress)) }
  # Limitation anti-force brute de l'API (10 essais/min/IP sur /auth) : on attend puis on réessaie
  for ($try = 0; $try -lt 2; $try++) {
    try { return @{ ok = $true; data = Invoke-RestMethod @p } }
    catch { $err = @{ ok = $false; status = $_.Exception.Response.StatusCode.value__; data = $_.ErrorDetails.Message }; if ($err.status -eq 429 -and $try -eq 0) { Write-Host "(limitation de l'API : pause d'une minute)"; Start-Sleep 61; continue }; return $err }
  }
}
function Check($l, $c) { if ($c) { "OK   $l" } else { "FAIL $l" } }
$pw = "une-phrase-de-passe-solide"
$userA = (Call POST "/auth/register" @{ username = "Alice$s"; password = $pw }).data
$userB = (Call POST "/auth/register" @{ username = "Bob$s"; password = $pw }).data
$tokA = $userA.accessToken; $tokB = $userB.accessToken

$r = Call POST "/friends" @{ username = "Bob$s" } $tokA; Check "demande d'ami envoyée" ($r.ok -and $r.data.status -eq "outgoing")
$r = Call GET "/friends" $null $tokB; Check "Bob voit la demande entrante" ($r.ok -and $r.data[0].status -eq "incoming")
$r = Call POST "/dm/$($userB.user.id)/messages" @{ content = "salut" } $tokA; Check "message privé refusé avant amitié (403)" ($r.status -eq 403)
$r = Call POST "/friends/$($userA.user.id)/accept" $null $tokB; Check "Bob accepte" $r.ok
$r = Call GET "/friends" $null $tokA; Check "amis des deux côtés" ($r.ok -and $r.data[0].status -eq "friend")
$r = Call POST "/dm/$($userB.user.id)/messages" @{ content = "salut Bob" } $tokA; Check "message privé envoyé" ($r.ok -and $r.data.content -eq "salut Bob")
$r = Call GET "/dm/$($userA.user.id)/messages" $null $tokB; Check "Bob lit le message" ($r.ok -and @($r.data).Count -eq 1)
$r = Call GET "/dm" $null $tokB; Check "conversation listée" ($r.ok -and $r.data[0].userId -eq $userA.user.id)
$r = Call POST "/calls/$($userB.user.id)" $null $tokA; Check "appel refusé si l'ami n'est pas connecté (409)" ($r.status -eq 409)

$srv = (Call POST "/servers" @{ name = "Chat test" } $tokA).data
$d = (Call GET "/servers/$($srv.id)" $null $tokA).data
Check "serveur créé avec un salon textuel" (@($d.channels).Count -eq 1)
$ch = $d.channels[0].id
$r = Call POST "/channels/$ch/messages" @{ content = "hello salon" } $tokA; Check "message dans le salon textuel" $r.ok
$r = Call GET "/channels/$ch/messages" $null $tokB; Check "Bob (non membre) ne lit pas le salon (404)" ($r.status -eq 404)
$r = Call POST "/rooms/$($d.rooms[0].id)/messages" @{ content = "chat vocal" } $tokA; Check "message dans le chat du salon vocal" $r.ok
$r = Call POST "/servers/$($srv.id)/channels" @{ name = "Mèmes Drôles" } $tokA; Check "nouveau salon textuel (nom normalisé)" ($r.ok -and $r.data.name -eq "mèmes-drôles")
$long = "x" * 2001
$r = Call POST "/channels/$ch/messages" @{ content = $long } $tokA; Check "message trop long refusé (400)" ($r.status -eq 400)
$m = (Call GET "/channels/$ch/messages" $null $tokA).data[0]
$r = Call DELETE "/messages/$($m.id)" $null $tokA; Check "suppression de son message" $r.ok

$r = Call POST "/me/password" @{ current = "faux"; next = "nouvelle-phrase-solide" } $tokA; Check "mauvais mot de passe actuel refusé (401)" ($r.status -eq 401)
$r = Call POST "/me/password" @{ current = $pw; next = "nouvelle-phrase-solide" } $tokA; Check "mot de passe changé" ($r.ok -and $r.data.refreshToken)
$r = Call POST "/auth/refresh" @{ refreshToken = $userA.refreshToken }; Check "ancienne session révoquée (401)" ($r.status -eq 401)
$r = Call POST "/auth/login" @{ username = "Alice$s"; password = "nouvelle-phrase-solide" }; Check "connexion avec le nouveau mot de passe" $r.ok


