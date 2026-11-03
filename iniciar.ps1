# Inicia o Painel Ambiente: prepara o ambiente Python (.venv), sobe o servidor e abre a tela cheia.
# Uso: dois cliques em iniciar.bat   |   Para sair do modo quiosque: Alt+F4
# Opções: -SemNavegador (só o servidor)  -Reinstalar (recria o .venv do zero)
param([switch]$SemNavegador, [switch]$Reinstalar)

# "Continue": no Windows PowerShell 5.1, avisos que o pip escreve no stderr NÃO podem derrubar o script.
$ErrorActionPreference = "Continue"
Set-Location $PSScriptRoot
$venvPy = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
$verificar = Join-Path $PSScriptRoot "tools\verificar_python.py"
$logs = Join-Path $PSScriptRoot "logs"
New-Item -ItemType Directory -Force $logs | Out-Null

function Falhar([string]$mensagem) {
    Write-Host ""
    Write-Host "ERRO: $mensagem" -ForegroundColor Red
    Write-Host ""
    Read-Host "Pressione Enter para fechar"
    exit 1
}

function Testar-Python([string]$exe, [string[]]$extra = @()) {
    # devolve $true se o Python serve; mostra o motivo se não servir
    $saida = & $exe @extra $verificar 2>&1 | Out-String
    $ok = $LASTEXITCODE -eq 0
    if (-not $ok -and $saida.Trim()) { Write-Host ("  " + $saida.Trim()) -ForegroundColor DarkYellow }
    return $ok
}

function Encontrar-Python {
    # Prefere versões com mais pacotes prontos (3.13/3.12), depois as demais.
    $candidatos = @()
    if (Get-Command py -ErrorAction SilentlyContinue) {
        foreach ($v in "3.13", "3.12", "3.14", "3.11", "3.10") { $candidatos += , @("py", "-$v") }
    }
    foreach ($c in "python", "python3") {
        $cmd = Get-Command $c -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -notmatch "WindowsApps\\python") { $candidatos += , @($cmd.Source) }
    }
    foreach ($c in $candidatos) {
        $exe = $c[0]; $extra = @($c | Select-Object -Skip 1)
        & $exe @extra --version *> $null
        if ($LASTEXITCODE -ne 0) { continue }
        Write-Host "Testando $($c -join ' ')..." -ForegroundColor DarkGray
        if (Testar-Python $exe $extra) { return , $c }
    }
    return $null
}

function Instalar-Dependencias {
    Write-Host "Instalando dependencias no .venv (pode levar alguns minutos na primeira vez)..." -ForegroundColor Cyan
    & $venvPy -m pip install --upgrade pip --disable-pip-version-check -q
    & $venvPy -m pip uninstall -y onnxruntime-gpu *> $null   # convive mal com o onnxruntime normal
    & $venvPy -m pip install --disable-pip-version-check -r requirements.txt
    if ($LASTEXITCODE -ne 0) { Falhar "A instalacao das dependencias falhou (veja as mensagens acima)." }
    if (Get-Command nvidia-smi -ErrorAction SilentlyContinue) {
        Write-Host "Placa NVIDIA detectada: instalando bibliotecas CUDA para o Whisper..." -ForegroundColor Cyan
        & $venvPy -m pip install --disable-pip-version-check -r requirements-gpu.txt
        if ($LASTEXITCODE -ne 0) { Write-Host "Aviso: sem as libs CUDA o Whisper vai rodar na CPU." -ForegroundColor Yellow }
    }
}

# ── 1. Ambiente Python ──────────────────────────────────────
if ($Reinstalar -and (Test-Path .venv)) { Remove-Item -Recurse -Force .venv }

if ((Test-Path $venvPy) -and -not (Testar-Python $venvPy)) {
    Write-Host "O .venv atual usa um Python incompativel; recriando..." -ForegroundColor Yellow
    Remove-Item -Recurse -Force .venv
}

if (-not (Test-Path $venvPy)) {
    Write-Host "Procurando um Python compativel (3.10 a 3.14, 64 bits)..." -ForegroundColor Cyan
    $base = Encontrar-Python
    if (-not $base) {
        Falhar "Nenhum Python compativel encontrado. Instale o Python 3.13 (64 bits) em https://www.python.org/downloads/ e marque 'Add python.exe to PATH'."
    }
    $exe = $base[0]; $extra = @($base | Select-Object -Skip 1)
    Write-Host "Criando .venv com $($base -join ' ')..." -ForegroundColor Cyan
    & $exe @extra -m venv .venv
    if (-not (Test-Path $venvPy)) { Falhar "Nao foi possivel criar o ambiente .venv." }
    Instalar-Dependencias
}
else {
    & $venvPy $verificar --deps *> $null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Dependencias ausentes ou com problema; corrigindo..." -ForegroundColor Yellow
        & $venvPy $verificar --deps
        Instalar-Dependencias
    }
}

& $venvPy $verificar --deps *> $null
if ($LASTEXITCODE -ne 0) {
    & $venvPy $verificar --deps
    Falhar "As dependencias continuam com problema. Tente: iniciar.bat -Reinstalar"
}

# ── 2. Servidor ─────────────────────────────────────────────
$porta = 8765
$linha = Select-String -Path "config.toml" -Pattern '^\s*porta\s*=\s*(\d+)' | Select-Object -First 1
if ($linha) { $porta = [int]$linha.Matches[0].Groups[1].Value }
# 127.0.0.1 e nao "localhost": no Windows, "localhost" tenta IPv6 (::1) primeiro e leva ~2 s para cair no IPv4.
$url = "http://127.0.0.1:$porta"

function Servidor-Responde {
    try { Invoke-WebRequest "$url/api/config" -UseBasicParsing -TimeoutSec 3 | Out-Null; return $true } catch { return $false }
}

$servidor = $null
if (Servidor-Responde) {
    Write-Host "O servidor ja esta rodando em $url." -ForegroundColor Cyan
}
else {
    Write-Host "Iniciando servidor em $url ..." -ForegroundColor Cyan
    $logSaida = Join-Path $logs "servidor.log"
    $logErro = Join-Path $logs "servidor-erros.log"
    $servidor = Start-Process -FilePath $venvPy -ArgumentList "-u", "-m", "backend.main" -WorkingDirectory $PSScriptRoot `
        -PassThru -WindowStyle Hidden -RedirectStandardOutput $logSaida -RedirectStandardError $logErro
    $pronto = $false
    for ($i = 0; $i -lt 90; $i++) {
        if ($servidor.HasExited) { break }
        if (Servidor-Responde) { $pronto = $true; break }
        Start-Sleep -Milliseconds 500
    }
    if (-not $pronto) {
        Write-Host "--- ultimas linhas de logs\servidor-erros.log ---" -ForegroundColor DarkGray
        if (Test-Path $logErro) { Get-Content $logErro -Tail 25 }
        if (-not $servidor.HasExited) { Stop-Process -Id $servidor.Id -ErrorAction SilentlyContinue }
        Falhar "O servidor nao iniciou. Veja o log acima (completo em logs\servidor-erros.log)."
    }
    Write-Host "Servidor pronto. Log em logs\servidor-erros.log" -ForegroundColor Green
}

if ($SemNavegador) {
    Write-Host "Modo -SemNavegador: abra $url manualmente. Ctrl+C para encerrar." -ForegroundColor Cyan
    if ($servidor) { $servidor.WaitForExit() }
    exit 0
}

# ── 3. Tela cheia ───────────────────────────────────────────
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    $perfil = Join-Path $env:LOCALAPPDATA "PainelAmbiente\edge"
    $argumentos = @(
        "--kiosk", $url, "--edge-kiosk-type=fullscreen",
        "--user-data-dir=`"$perfil`"",
        "--use-fake-ui-for-media-stream",      # concede a camera sem pop-up (so neste perfil)
        "--no-first-run", "--disable-features=Translate",
        "--autoplay-policy=no-user-gesture-required"
    )
    $navegador = Start-Process -FilePath $edge -ArgumentList $argumentos -PassThru
    $navegador.WaitForExit()
}
else {
    Write-Host "Edge nao encontrado; abrindo no navegador padrao (aperte F para tela cheia)." -ForegroundColor Yellow
    Start-Process $url
    Read-Host "Pressione Enter para encerrar o painel"
}

if ($servidor -and -not $servidor.HasExited) {
    Write-Host "Encerrando servidor..." -ForegroundColor Cyan
    Stop-Process -Id $servidor.Id -ErrorAction SilentlyContinue
}
