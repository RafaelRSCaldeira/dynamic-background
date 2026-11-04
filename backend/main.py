"""Servidor local do Painel Ambiente.

Uso:  .venv\\Scripts\\python -m backend.main
"""
from __future__ import annotations

import asyncio
import logging
import os
import warnings

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_PROGRESS_BARS", "1")
os.environ.setdefault("HF_HUB_VERBOSITY", "error")
warnings.filterwarnings("ignore", message=".*unauthenticated requests.*")
from contextlib import asynccontextmanager

import httpx
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import dados, ia, imagens, modelos, privacidade, visao
from .config import CONFIG, FRONTEND
from .hub import Hub
from .retorno import listar_microfones, retorno
from .sala import Sala
from .zak import Zak

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(name)-11s %(message)s", datefmt="%H:%M:%S")
for ruidoso in ("httpx", "httpx2", "httpcore", "faster_whisper"):
    logging.getLogger(ruidoso).setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)  # "sem HF_TOKEN" não é problema aqui
log = logging.getLogger("painel")

hub = Hub()
sala = Sala(hub, CONFIG["audio"], CONFIG["ia"])
zak = Zak(sala, CONFIG["zak"], CONFIG["ia"], CONFIG["local"])
sala.ao_ouvir = zak.ouvir
telas_zak: set = set()
# os cards da Sala só são gerados se alguma tela clássica (sem ?zak) estiver aberta
sala.insights_necessarios = lambda: any(local and ws not in telas_zak for ws, local in list(hub.clientes.items()))
LOCAIS = {"127.0.0.1", "::1", "localhost"}


@asynccontextmanager
async def ciclo(app: FastAPI):
    hub.loop = retorno.loop = asyncio.get_running_loop()
    app.state.http = httpx.AsyncClient(timeout=15, headers={"User-Agent": "PainelAmbiente/1.0"})
    tarefas: list[asyncio.Task] = []
    if CONFIG["audio"]["ativado"]:
        from .audio import ServicoAudio

        ServicoAudio(sala, CONFIG["audio"]).iniciar()
        tarefas.append(asyncio.create_task(ia.executar(sala, CONFIG["ia"])))
        if CONFIG["audio"]["mute_automatico"]:
            tarefas.append(asyncio.create_task(privacidade.vigiar(sala)))
    tarefas.append(asyncio.create_task(zak.executar(app.state.http)))
    porta = CONFIG["servidor"]["porta"]
    log.info("Painel em http://localhost:%s  |  controle remoto em /remote", porta)
    yield
    for t in tarefas:
        t.cancel()
    zak.gerador.fechar()
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
        "zak": CONFIG["zak"],
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


@app.get("/api/imagem")
async def api_imagem(q: str):
    """Melhor foto (4K, filtrada) para o assunto de uma cena do Zak, com paleta e crédito."""
    meta = await _proteger(imagens.buscar(app.state.http, q))
    if not meta:
        raise HTTPException(404, "Nenhuma imagem boa o bastante")
    return meta


@app.get("/api/imagem/gerar")
async def api_imagem_gerar(p: str):
    """Imagem gerada localmente (ideias e atmosferas sem foto real). Pode levar alguns segundos."""
    if not zak.gerador.disponivel:
        raise HTTPException(404, f"Geração de imagens indisponível: {zak.gerador.detalhe}")
    try:
        meta = await zak.gerador.gerar(p)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Falha ao gerar: {e}") from e
    finally:
        zak.publicar()
    if not meta:
        raise HTTPException(404, "Não foi possível gerar a imagem")
    return meta


@app.get("/api/imagem/arquivo/{nome}")
async def api_imagem_arquivo(nome: str):
    caminho = imagens.arquivo(nome)
    if not caminho:
        raise HTTPException(404)
    return FileResponse(caminho, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=604800, immutable"})


@app.get("/api/modelos")
async def api_modelos(request: Request):
    # só a própria máquina vê e troca os modelos (o celular em /remote só muta)
    if (request.client.host if request.client else "") not in LOCAIS:
        raise HTTPException(403, "Disponível só no computador do painel")
    return {
        "ollama": await modelos.listar_ollama(app.state.http, CONFIG["ia"]["ollama_url"]),
        "ia_atual": sala.modelo_ia,
        "whisper": modelos.catalogo_whisper(),
        "whisper_modelo": sala.modelo_whisper,
        "whisper_atual": sala.whisper_atual,
        "whisper_dispositivo": sala.whisper_dispositivo,
        "audio": CONFIG["audio"]["ativado"],
        "microfones": await asyncio.to_thread(listar_microfones),
    }


@app.websocket("/ws")
async def ws(websocket: WebSocket):
    local = (websocket.client.host if websocket.client else "") in LOCAIS
    await websocket.accept()
    hub.adicionar(websocket, local)
    try:
        await websocket.send_json(sala.snapshot(completo=local))
        if local:
            await websocket.send_json(zak.snapshot())
        while True:
            msg = await websocket.receive_json()
            acao = msg.get("acao")
            if acao == "mute":
                sala.definir_mute(msg.get("valor"))
            elif acao == "esquecer":
                sala.esquecer()
                retorno.limpar()
                if zak.cena_origem == "ambiente":   # a cena veio da conversa que acabou de ser apagada
                    zak.limpar_tela()
            elif acao == "modelo_ia" and local:
                sala.definir_modelo_ia(str(msg.get("nome") or ""))
            elif acao == "modelo_whisper" and local:
                sala.definir_modelo_whisper(str(msg.get("nome") or ""))
            elif acao == "microfone" and local:
                sala.definir_microfone(str(msg.get("nome") or ""))
            elif acao == "idioma" and local:
                sala.definir_idioma(str(msg.get("valor") or ""))
            elif acao == "ganho_mic" and local:
                sala.definir_ganho(msg.get("db") or 0)
            # ── Zak (só a própria tela) ──
            elif acao == "zak_tela" and local:
                telas_zak.add(websocket)
                zak.tela_entrou(id(websocket))
            elif acao == "zak_pedido" and local:
                texto = str(msg.get("texto") or "")[:300]
                asyncio.create_task(zak.pedido(texto))
            elif acao == "zak_tocando" and local:
                zak.tocando(bool(msg.get("valor")))
            elif acao == "zak_protecao" and local:
                zak.definir_protecao(bool(msg.get("valor")))
            elif acao == "zak_limpar" and local:
                zak.limpar_tela()
            elif acao == "zak_calar" and local:
                zak.calar()
            elif acao == "zak_musica_parar" and local:
                zak.musica = None
                zak.publicar()
            elif acao == "zak_timer_cancelar" and local:
                zak.timers = [t for t in zak.timers if t["id"] != msg.get("id")]
                zak.publicar()
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        hub.remover(websocket)
        if websocket in telas_zak:
            telas_zak.discard(websocket)
            zak.tela_saiu(id(websocket))


@app.websocket("/ws/retorno")
async def ws_retorno(websocket: WebSocket):
    """Retorno do microfone para os Ajustes: só a própria máquina, e só enquanto está aberto."""
    if (websocket.client.host if websocket.client else "") not in LOCAIS:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    ouvinte = retorno.entrar()

    async def enviar():
        while True:
            m = await ouvinte.fila.get()
            if isinstance(m, bytes):
                await websocket.send_bytes(m)
            else:
                await websocket.send_json(m)

    envio = asyncio.create_task(enviar())
    try:
        while True:
            msg = await websocket.receive_json()
            if msg.get("acao") == "ao_vivo":
                ouvinte.ao_vivo = bool(msg.get("valor"))
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        envio.cancel()
        retorno.sair(ouvinte)


@app.get("/api/retorno/{ident}.wav")
async def api_retorno_wav(ident: int, request: Request):
    if (request.client.host if request.client else "") not in LOCAIS:
        raise HTTPException(403, "Disponível só no computador do painel")
    dados = retorno.obter_wav(ident)
    if dados is None:
        raise HTTPException(404, "Essa frase já foi apagada")
    return Response(dados, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/api/zak/audio/{chave}.wav")
async def api_zak_audio(chave: str, request: Request):
    if (request.client.host if request.client else "") not in LOCAIS:
        raise HTTPException(403, "Disponível só no computador do painel")
    dados_wav = zak.audio(chave)
    if dados_wav is None:
        raise HTTPException(404)
    return Response(dados_wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/visao/{caminho:path}")
async def api_visao(caminho: str):
    return await visao.servir(app.state.http, caminho)


@app.get("/remote")
async def remote():
    return FileResponse(FRONTEND / "remote.html")


app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")


if __name__ == "__main__":
    host = "0.0.0.0" if CONFIG["servidor"]["rede_local"] else "127.0.0.1"
    uvicorn.run(app, host=host, port=int(CONFIG["servidor"]["porta"]), log_level="warning")
