"""Servidor local do Painel Ambiente.

Uso:  .venv\\Scripts\\python -m backend.main
"""
from __future__ import annotations

import asyncio
import logging
import os

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import dados, ia, privacidade
from .config import CONFIG, FRONTEND
from .hub import Hub
from .sala import Sala

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(name)-11s %(message)s", datefmt="%H:%M:%S")
for ruidoso in ("httpx", "httpx2", "httpcore", "huggingface_hub", "faster_whisper"):
    logging.getLogger(ruidoso).setLevel(logging.WARNING)
log = logging.getLogger("painel")

hub = Hub()
sala = Sala(hub, CONFIG["audio"], CONFIG["ia"])
LOCAIS = {"127.0.0.1", "::1", "localhost"}


@asynccontextmanager
async def ciclo(app: FastAPI):
    hub.loop = asyncio.get_running_loop()
    app.state.http = httpx.AsyncClient(timeout=15, headers={"User-Agent": "PainelAmbiente/1.0"})
    tarefas: list[asyncio.Task] = []
    if CONFIG["audio"]["ativado"]:
        from .audio import ServicoAudio

        ServicoAudio(sala, CONFIG["audio"]).iniciar()
        tarefas.append(asyncio.create_task(ia.executar(sala, CONFIG["ia"])))
        if CONFIG["audio"]["mute_automatico"]:
            tarefas.append(asyncio.create_task(privacidade.vigiar(sala)))
    porta = CONFIG["servidor"]["porta"]
    log.info("Painel em http://localhost:%s  |  controle remoto em /remote", porta)
    yield
    for t in tarefas:
        t.cancel()
    await app.state.http.aclose()


app = FastAPI(title="Painel Ambiente", lifespan=ciclo)


@app.middleware("http")
async def sem_cache(request, chamar):
    # revalida sempre (via ETag): depois de editar o código, a tela nunca usa arquivo velho
    resposta = await chamar(request)
    resposta.headers.setdefault("Cache-Control", "no-cache")
    return resposta


async def _proteger(coro):
    try:
        return await coro
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Fonte indisponível: {e}") from e


@app.get("/api/config")
async def api_config():
    return {
        "local": CONFIG["local"].get("cidade"),
        "tela": CONFIG["tela"],
        "camera": CONFIG["camera"],
        "audio": CONFIG["audio"]["ativado"],
    }


@app.get("/api/clima")
async def api_clima():
    async def tudo():
        loc = await dados.localizar(app.state.http, CONFIG["local"])
        return await dados.clima(app.state.http, loc)

    return await _proteger(tudo())


@app.get("/api/mercado")
async def api_mercado():
    return await _proteger(dados.mercado(app.state.http, CONFIG["widgets"]["moedas"]))


@app.get("/api/feriados")
async def api_feriados():
    return await _proteger(dados.feriados(app.state.http))


@app.get("/api/noticias")
async def api_noticias():
    return await _proteger(dados.noticias(app.state.http, CONFIG["widgets"]["feeds"]))


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    local = (websocket.client.host if websocket.client else "") in LOCAIS
    await websocket.accept()
    hub.adicionar(websocket, local)
    try:
        await websocket.send_json(sala.snapshot(completo=local))
        while True:
            msg = await websocket.receive_json()
            acao = msg.get("acao")
            if acao == "mute":
                sala.definir_mute(msg.get("valor"))
            elif acao == "esquecer":
                sala.esquecer()
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        hub.remover(websocket)


@app.get("/remote")
async def remote():
    return FileResponse(FRONTEND / "remote.html")


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")


if __name__ == "__main__":
    host = "0.0.0.0" if CONFIG["servidor"]["rede_local"] else "127.0.0.1"
    uvicorn.run(app, host=host, port=int(CONFIG["servidor"]["porta"]), log_level="warning")
