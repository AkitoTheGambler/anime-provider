# Live end-to-end test: local Jikan (localhost:8080) + provider (localhost:3000).
# Run from the anime-provider folder while both are running:
#   powershell -ExecutionPolicy Bypass -File .\test-live.ps1
param(
    [string]$Jikan = 'http://localhost:8080',
    [string]$Provider = 'http://localhost:3000'
)
$ErrorActionPreference = 'Stop'
$results = @()

function Step([string]$Name, [scriptblock]$Body) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    try {
        $info = & $Body
        $sw.Stop()
        $status = 'PASS'
        if ($info -is [string] -and $info.StartsWith('WARN:')) { $status = 'WARN'; $info = $info.Substring(5).Trim() }
        $line = '{0,-4} {1,-44} {2,6:N1}s  {3}' -f $status, $Name, $sw.Elapsed.TotalSeconds, $info
    } catch {
        $sw.Stop()
        $msg = $_.Exception.Message
        if ($_.Exception.Response) {
            try { $msg = "HTTP $([int]$_.Exception.Response.StatusCode) - $msg" } catch { }
        }
        $line = '{0,-4} {1,-44} {2,6:N1}s  {3}' -f 'FAIL', $Name, $sw.Elapsed.TotalSeconds, $msg
    }
    Write-Host $line
    $script:results += $line
}

# Plex metadata has both "guid"/"Guid" and "studio"/"Studio"; PowerShell's JSON
# parser rejects keys that differ only in case, so rename the array first.
function ConvertFrom-PlexJson([string]$Text) { ($Text -creplace '"(Guid|Studio)":', '"$1List":') | ConvertFrom-Json }
function Get-Json([string]$Url) {
    $r = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 180
    ConvertFrom-PlexJson $r.Content
}
function Post-Match([hashtable]$Body) {
    $r = Invoke-WebRequest -UseBasicParsing -Uri "$Provider/library/metadata/matches" -Method Post -TimeoutSec 300 `
        -ContentType 'application/json' -Body ($Body | ConvertTo-Json -Compress)
    ConvertFrom-PlexJson $r.Content
}
function Assert($Cond, [string]$Msg) { if (-not $Cond) { throw $Msg } }

Write-Host "=== Jikan ($Jikan) ==="
Step 'Jikan is up' { $null = Invoke-WebRequest -UseBasicParsing -TimeoutSec 10 "$Jikan/"; 'root answers' }
Step 'Jikan lookup by ID (MAL 34437)' {
    $a = Get-Json "$Jikan/v4/anime/34437"
    Assert ($a.data.mal_id -eq 34437) 'wrong/missing data'
    $a.data.title
}
Step 'Jikan search (needs index)' {
    $s = Get-Json "$Jikan/v4/anime?q=Death%20Note&limit=5"
    $n = @($s.data).Count
    if ($n -eq 0) { 'WARN: 0 results - search index not built yet (.\index-anime.ps1)' }
    else { "$n results, first: $($s.data[0].title)" }
}
Step 'Jikan search with start_date' {
    try {
        $s = Get-Json "$Jikan/v4/anime?q=Death%20Note&limit=5&start_date=2006-01-01"
        "accepted ($(@($s.data).Count) results)"
    } catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        if ($code -eq 400 -or $code -eq 422) { "WARN: rejected (HTTP $code) - provider falls back to searching without it (OK)" }
        else { throw }
    }
}

Write-Host ''
Write-Host "=== Provider ($Provider) ==="
Step 'Provider health' {
    $h = Get-Json "$Provider/health"
    Assert ($h.status -eq 'ok') 'not ok'
    "source=$($h.source)"
}
Step 'Provider definition' {
    $p = Get-Json "$Provider/"
    "$($p.MediaProvider.identifier) / $($p.MediaProvider.title)"
}
Step 'Match season by folder tag {anidb-12566}' {
    $r = Post-Match @{ type = 3; parentTitle = 'Code Geass Fukkatsu No Lelouch'; parentYear = 2019; index = 1; includeChildren = 1
        filename = 'Code Geass Fukkatsu no Lelouch (2019) {anidb-12566}\Season 01\Code Geass Fukkatsu no Lelouch (2019) - S01E01 - Complete Movie.mp4' }
    $m = $r.MediaContainer.Metadata[0]
    # {anidb-12566} folders: AniDB when ANIDB_CLIENT is set, else translated to MAL 34437
    Assert ($m.ratingKey -in @('anidb-season-12566-1', 'mal-season-34437-1')) "got '$($m.ratingKey)'"
    "$($m.ratingKey) / $($m.parentTitle)"
}
Step 'Match season by folder tag {anidb-15910}' {
    $r = Post-Match @{ type = 3; parentTitle = 'Code Geass Dakkan No Roze'; parentYear = 2024; index = 1; includeChildren = 1
        filename = 'Code Geass Dakkan no Roze (2024) {anidb-15910}\Code Geass Dakkan no Roze (2024) - E01 - Melting Snow.mp4' }
    $m = $r.MediaContainer.Metadata[0]
    # {anidb-15910} folders: AniDB when ANIDB_CLIENT is set, else translated to MAL 56835
    Assert ($m.ratingKey -in @('anidb-season-15910-1', 'mal-season-56835-1')) "got '$($m.ratingKey)'"
    "$($m.ratingKey) / $($m.parentTitle)"
}
Step 'Match show by title + year (needs index)' {
    $r = Post-Match @{ type = 2; title = 'Death Note'; year = 2006 }
    if ($r.MediaContainer.size -eq 0) { 'WARN: no match - search index not built yet' }
    else {
        $m = $r.MediaContainer.Metadata[0]
        Assert ($m.ratingKey -eq 'mal-show-1535') "got '$($m.ratingKey)' ($($m.title))"
        "$($m.ratingKey) / $($m.title)"
    }
}
Step 'Show metadata (cast, crew, collection)' {
    $r = Get-Json "$Provider/library/metadata/mal-show-34437"
    $m = $r.MediaContainer.Metadata[0]
    Assert ($m.title) 'no title'
    $roles = @($m.Role).Count; $dirs = @($m.Director).Count; $genres = @($m.Genre).Count
    $col = if ($m.Collection) { $m.Collection[0].tag } else { '-' }
    $sim = @($m.Similar).Count
    "'$($m.title)' roles=$roles directors=$dirs genres=$genres similar=$sim collection='$col'"
}
Step 'Season children (episodes)' {
    $r = Get-Json "$Provider/library/metadata/mal-season-56835-1/children"
    $eps = @($r.MediaContainer.Metadata[0].Children.Metadata)
    Assert ($eps.Count -gt 0) 'no episodes'
    "$($eps.Count) episodes, E1: $($eps[0].title)"
}
Step 'Images' {
    $r = Get-Json "$Provider/library/metadata/mal-show-34437/images"
    "$(@($r.MediaContainer.Image).Count) images"
}

Write-Host ''
$fail = @($results | Where-Object { $_.StartsWith('FAIL') }).Count
$warn = @($results | Where-Object { $_.StartsWith('WARN') }).Count
Write-Host "Done: $($results.Count) checks, $fail failed, $warn warnings"
