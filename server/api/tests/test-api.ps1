# Tests de bout en bout de l'API Tomo (serveur de dev lancé : docker compose -f server/docker-compose.dev.yml up -d)
# Lancer : powershell -ExecutionPolicy Bypass -File server\api\tests\test-api.ps1
$ErrorActionPreference = "Stop"
$base = "http://localhost:3000"
$suffix = Get-Random -Maximum 99999

function Call($method, $path, $body = $null, $token = $null) {
  $headers = @{}
  if ($token) { $headers["Authorization"] = "Bearer $token" }
  $params = @{ Method = $method; Uri = "$base$path"; Headers = $headers }
  if ($null -ne $body) { $params.ContentType = "application/json; charset=utf-8"; $params.Body = [Text.Encoding]::UTF8.GetBytes(($body | ConvertTo-Json -Compress)) }
  # Limitation anti-force brute de l'API (10 essais/min/IP sur /auth) : on attend puis on réessaie
  # (sauf /auth/login : le test du blocage après 5 échecs attend justement des refus)
  for ($try = 0; $try -lt 2; $try++) {
    try { return @{ ok = $true; data = Invoke-RestMethod @params } }
    catch {
      $err = @{ ok = $false; status = $_.Exception.Response.StatusCode.value__; data = $_.ErrorDetails.Message }
      if ($err.status -eq 429 -and $path -notlike "/auth/login*" -and $try -eq 0) { Write-Host "(limitation de l'API : pause d'une minute)"; Start-Sleep 61; continue }
      return $err
    }
  }
}
function Check($label, $cond) { if ($cond) { Write-Output "OK   $label" } else { Write-Output "FAIL $label" } }

$pw = "une-phrase-de-passe-solide"
$r = Call POST "/auth/register" @{ username = "Kam$suffix"; password = "court" }
Check "mot de passe trop court refusé (400)" ($r.status -eq 400)

$kam = Call POST "/auth/register" @{ username = "Kam$suffix"; password = $pw }
Check "inscription Kam" ($kam.ok -and $kam.data.accessToken -and $kam.data.refreshToken)
$r = Call POST "/auth/register" @{ username = "kam$suffix"; password = $pw }
Check "pseudo déjà pris, insensible à la casse (409)" ($r.status -eq 409)

$lea = Call POST "/auth/register" @{ username = "Lea$suffix"; password = $pw }
Check "inscription Léa" $lea.ok

$r = Call POST "/auth/login" @{ username = "Kam$suffix"; password = "mauvais-mot-de-passe" }
Check "mauvais mot de passe refusé (401)" ($r.status -eq 401)
$login = Call POST "/auth/login" @{ username = "Kam$suffix"; password = $pw }
Check "connexion Kam" $login.ok
$T = $login.data.accessToken

$r = Call GET "/servers" $null $T
Check "aucun serveur au départ" ($r.ok -and @($r.data).Count -eq 0)

$srv = Call POST "/servers" @{ name = "Les potes" } $T
Check "création serveur (owner)" ($srv.ok -and $srv.data.role -eq "owner")
$S = $srv.data.id

$detail = Call GET "/servers/$S" $null $T
Check "serveur créé avec 1 salon Général" ($detail.ok -and $detail.data.rooms.Count -eq 1 -and $detail.data.rooms[0].label -like "G*ral")
$room = Call POST "/servers/$S/rooms" @{ label = "Valorant" } $T
Check "création salon par l'admin" $room.ok

$TL = $lea.data.accessToken
$r = Call GET "/servers/$S" $null $TL
Check "Léa n'a pas accès avant invitation (404)" ($r.status -eq 404)

$inv = Call POST "/servers/$S/invites" @{ kind = "member" } $T
Check "code membre créé ($($inv.data.code))" ($inv.ok -and $inv.data.code -match '^[A-Z2-9]{4}-[A-Z2-9]{4}$')
$acc = Call POST "/invites/$($inv.data.code)/accept" $null $TL
Check "Léa rejoint avec le code" ($acc.ok -and $acc.data.role -eq "member")
$r = Call POST "/servers/$S/rooms" @{ label = "Pirate" } $TL
Check "Léa (membre) ne peut pas créer de salon (403)" ($r.status -eq 403)
$r = Call POST "/servers/$S/invites" @{ kind = "guest" } $TL
Check "Léa (membre) ne peut pas créer de code invité (403)" ($r.status -eq 403)

$tok = Call POST "/rooms/$($room.data.id)/token" $null $TL
Check "Léa obtient un jeton vocal" ($tok.ok -and $tok.data.token -and $tok.data.identity -like "u:*")

$g = Call POST "/servers/$S/invites" @{ kind = "guest"; hours = 4; maxUses = 2 } $T
Check "code invité créé par l'admin" $g.ok
$r = Call POST "/invites/$($g.data.code)/accept" $null $TL
Check "code invité refusé pour rejoindre en membre (400)" ($r.status -eq 400)
$guest = Call POST "/auth/guest" @{ code = $g.data.code; name = "Tom" }
Check "invité Tom entre sans compte" ($guest.ok -and $guest.data.guest.server.name -eq "Les potes")
$TG = $guest.data.accessToken
$r = Call GET "/servers" $null $TG
Check "l'invité ne voit que ce serveur" ($r.ok -and @($r.data).Count -eq 1 -and $r.data[0].role -eq "guest")
$r = Call POST "/rooms/$($room.data.id)/token" $null $TG
Check "l'invité obtient un jeton vocal (g:)" ($r.ok -and $r.data.identity -like "g:*")
$r = Call POST "/servers" @{ name = "Hack" } $TG
Check "l'invité ne peut pas créer de serveur (403)" ($r.status -eq 403)
$null = Call POST "/auth/guest" @{ code = $g.data.code; name = "Tom2" }
$r = Call POST "/auth/guest" @{ code = $g.data.code; name = "Tom3" }
Check "code invité limité à 2 utilisations (404)" ($r.status -eq 404)

$ref = Call POST "/auth/refresh" @{ refreshToken = $login.data.refreshToken }
Check "renouvellement de session" ($ref.ok -and $ref.data.refreshToken -ne $login.data.refreshToken)
$r = Call POST "/auth/refresh" @{ refreshToken = $login.data.refreshToken }
Check "ancien jeton de renouvellement inutilisable (401)" ($r.status -eq 401)

$members = Call GET "/servers/$S/members" $null $T
Check "liste des membres (2)" ($members.ok -and @($members.data).Count -eq 2)
$leaId = $lea.data.user.id
$r = Call PATCH "/servers/$S/members/$leaId" @{ role = "admin" } $T
Check "Léa promue admin" $r.ok
$r = Call POST "/servers/$S/rooms" @{ label = "Minecraft" } $TL
Check "Léa (admin) peut créer un salon" $r.ok
$r = Call DELETE "/servers/$S/members/$leaId" $null $T
Check "Kam exclut Léa" $r.ok
$r = Call GET "/servers/$S" $null $TL
Check "Léa n'a plus accès (404)" ($r.status -eq 404)

$r = Call PATCH "/servers/$S" @{ name = "Les vrais potes" } $T
Check "serveur renommé" $r.ok
$r = Call DELETE "/servers/$S" $null $T
Check "serveur supprimé" $r.ok
$r = Call GET "/servers" $null $T
Check "plus aucun serveur" ($r.ok -and @($r.data).Count -eq 0)

$fails = 0
1..5 | ForEach-Object { $x = Call POST "/auth/login" @{ username = "Lea$suffix"; password = "faux-faux-faux" }; if ($x.status -eq 429) { $fails++ } }
$r = Call POST "/auth/login" @{ username = "Lea$suffix"; password = $pw }
Check "blocage après 5 échecs, même avec le bon mot de passe (429)" ($r.status -eq 429)
