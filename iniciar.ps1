# Inicia o servidor do Painel Ambiente e abre a tela em modo quiosque (tela cheia).
# Para sair do modo quiosque: Alt+F4.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$py = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
    Write-Host "Criando ambiente Python..." -ForegroundColor Cyan
    python -m venv .venv
    & $py -m pip install -r requirements.txt
}

$porta = 8765
$linha = Select-String -Path "config.toml" -Pattern '^\s*porta\s*=\s*(\d+)' | Select-Object -First 1
if ($linha) { $porta = [int]$linha.Matches[0].Groups[1].Value }
$url = "http://localhost:$porta"

Write-Host "Iniciando servidor em $url ..." -ForegroundColor Cyan
$servidor = Start-Process -FilePath $py -ArgumentList "-m", "backend.main" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Minimized

$pronto = $false
for ($i = 0; $i -lt 60; $i++) {
    try { Invoke-WebRequest "$url/api/config" -UseBasicParsing -TimeoutSec 1 | Out-Null; $pronto = $true; break }
    catch { Start-Sleep -Milliseconds 500 }
}
if (-not $pronto) { Write-Host "O servidor não respondeu. Veja a janela minimizada do Python." -ForegroundColor Red; exit 1 }

$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
$perfil = Join-Path $env:LOCALAPPDATA "PainelAmbiente\edge"

$argumentos = @(
    "--kiosk", $url, "--edge-kiosk-type=fullscreen",
    "--user-data-dir=`"$perfil`"",
    "--use-fake-ui-for-media-stream",      # concede a câmera sem pop-up (só neste perfil)
    "--no-first-run", "--disable-features=Translate",
    "--autoplay-policy=no-user-gesture-required"
)
$navegador = Start-Process -FilePath $edge -ArgumentList $argumentos -PassThru
$navegador.WaitForExit()

Write-Host "Encerrando servidor..." -ForegroundColor Cyan
Stop-Process -Id $servidor.Id -ErrorAction SilentlyContinue
