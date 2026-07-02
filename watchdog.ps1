# GuardTec Compliance App Watchdog
# Restarts the server if it is not listening on port 3000

$serverPath = "C:\Users\AsrarKhan\First Call Site Services\FCSS - Managers\HR and Legal\Asrar\GuardTec Compliance\GuardTec Compliance App\server.js"
$workDir    = "C:\Users\AsrarKhan\First Call Site Services\FCSS - Managers\HR and Legal\Asrar\GuardTec Compliance\GuardTec Compliance App"

$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue

if (-not $listening) {
    # Nothing on port 3000 — start the server
    Start-Process -FilePath "node" -ArgumentList "`"$serverPath`"" -WorkingDirectory $workDir -WindowStyle Hidden
}
