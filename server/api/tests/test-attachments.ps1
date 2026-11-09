# Tests des pièces jointes (images, messages vocaux, fichiers) — serveur de dev lancé :
#   docker compose -f server/docker-compose.dev.yml up -d
# Lancer : powershell -ExecutionPolicy Bypass -File server\api\tests\test-attachments.ps1
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
function Fetch($url) {
  try { $r = Invoke-WebRequest -Uri "$base$url" -UseBasicParsing; return @{ ok = $true; status = [int]$r.StatusCode; headers = $r.Headers; length = $r.RawContentLength } }
  catch { return @{ ok = $false; status = $_.Exception.Response.StatusCode.value__ } }
}
function Check($l, $c) { if ($c) { "OK   $l" } else { "FAIL $l" } }

$pw = "une-phrase-de-passe-solide"
$userA = (Call POST "/auth/register" @{ username = "Pj$s"; password = $pw; email = "Pj$s@exemple.test" }).data
$userB = (Call POST "/auth/register" @{ username = "Pk$s"; password = $pw; email = "Pk$s@exemple.test" }).data
$tokA = $userA.accessToken; $tokB = $userB.accessToken
$srv = (Call POST "/servers" @{ name = "PJ test" } $tokA).data
$ch = (Call GET "/servers/$($srv.id)" $null $tokA).data.channels[0].id

# Une vraie petite image PNG (1×1), un faux « vocal » WebM (en-tête EBML), un fichier texte, un faux PNG (SVG)
$png = [Convert]::FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==")
$webm = [byte[]]([byte[]](0x1A, 0x45, 0xDF, 0xA3) + [byte[]](1..200))
$txt = [Text.Encoding]::UTF8.GetBytes("bonjour")
$svg = [Text.Encoding]::UTF8.GetBytes("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")

$r = Upload $png "name=capture.png&width=1&height=1" $null; Check "envoi refusé sans être connecté (401)" ($r.status -eq 401)
$img = Upload $png "name=capture.png&width=1&height=1" $tokA; Check "image envoyée, reconnue comme image" ($img.ok -and $img.data.kind -eq "image" -and $img.data.mime -eq "image/png")
$voc = Upload $webm "name=vocal.webm&durationMs=4200&waveform=0123456789" $tokA; Check "message vocal reconnu (audio, durée, onde)" ($voc.ok -and $voc.data.kind -eq "audio" -and $voc.data.durationMs -eq 4200 -and $voc.data.waveform -eq "0123456789")
$doc = Upload $txt "name=..%2F..%2Fnotes.txt" $tokA; Check "fichier quelconque = téléchargement, nom nettoyé" ($doc.ok -and $doc.data.kind -eq "file" -and $doc.data.name -eq "notes.txt")
$bad = Upload $svg "name=joli.png" $tokA; Check "un SVG déguisé en PNG n'est pas affiché comme image" ($bad.ok -and $bad.data.kind -eq "file" -and $bad.data.mime -eq "application/octet-stream")
$r = Upload ([byte[]]@()) "name=vide" $tokA; Check "fichier vide refusé (400)" ($r.status -eq 400)

$r = Fetch $img.data.url; Check "fichier pas encore lisible tant qu'il n'est dans aucun message (404)" ($r.status -eq 404)
$r = Call POST "/channels/$ch/messages" @{ content = ""; attachments = @($img.data.id) } $tokB; Check "Bob (non membre) ne peut pas poster dans le salon (404)" ($r.status -eq 404)

$msg = Call POST "/channels/$ch/messages" @{ content = ""; attachments = @($img.data.id, $voc.data.id, $doc.data.id) } $tokA
Check "message sans texte mais avec 3 pièces jointes" ($msg.ok -and @($msg.data.attachments).Count -eq 3)
$r = Call POST "/channels/$ch/messages" @{ content = "encore"; attachments = @($img.data.id) } $tokA; Check "une pièce jointe ne sert qu'une fois (400)" ($r.status -eq 400)
$other = Upload $png "name=b.png" $tokB
$r = Call POST "/channels/$ch/messages" @{ content = "vol"; attachments = @($other.data.id) } $tokA; Check "impossible d'utiliser le fichier de quelqu'un d'autre (400)" ($r.status -eq 400)
$r = Call POST "/channels/$ch/messages" @{ content = "" } $tokA; Check "message vide sans pièce jointe refusé (400)" ($r.status -eq 400)

$list = (Call GET "/channels/$ch/messages" $null $tokA).data
Check "les pièces jointes reviennent avec l'historique" (@($list[-1].attachments).Count -eq 3)

$r = Fetch $img.data.url; Check "image servie en ligne, bon type, nosniff" ($r.ok -and $r.headers["Content-Type"] -eq "image/png" -and $r.headers["X-Content-Type-Options"] -eq "nosniff" -and $r.headers["Content-Disposition"] -like "inline*")
$r = Fetch $doc.data.url; Check "fichier servi en téléchargement" ($r.ok -and $r.headers["Content-Disposition"] -like "attachment*" -and $r.headers["Content-Type"] -eq "application/octet-stream")
$forged = $img.data.url -replace "/files/([^/]+)/[^/]+/", '/files/$1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/'
$r = Fetch $forged; Check "adresse avec une fausse signature refusée (404)" ($r.status -eq 404)

$r = Call GET "/gifs?q=chat" $null $null; Check "recherche de GIF refusée sans être connecté (401)" ($r.status -eq 401)
$r = Call GET "/gifs?q=chat" $null $tokA
Check "recherche de GIF : résultats (clé Klipy) ou « non activée » (503 sans clé)" (($r.ok -and $null -ne $r.data.gifs) -or $r.status -eq 503)
$r = Call POST "/gifs/attach" @{ url = "https://exemple.com/pas-klipy.gif" } $tokA; Check "GIF venant d'un autre site que Klipy refusé" ($r.status -eq 400 -or $r.status -eq 503)

$r = Call DELETE "/messages/$($msg.data.id)" $null $tokA; Check "suppression du message" $r.ok
$r = Fetch $img.data.url; Check "ses fichiers sont effacés avec lui (404)" ($r.status -eq 404)
