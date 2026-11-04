"""Arquivos do reconhecedor de mãos (MediaPipe), baixados uma única vez e servidos localmente.

O reconhecimento roda 100% no navegador; o servidor só guarda o código/modelo em `cache/visao`
para que funcione offline e sem depender da CDN a cada abertura.
"""
from __future__ import annotations

import asyncio
import logging
import os

import httpx
from fastapi import HTTPException
from fastapi.responses import FileResponse

from .config import RAIZ

log = logging.getLogger("visao")

VERSAO = "0.10.21"
_NPM = f"https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@{VERSAO}"
ARQUIVOS = {
    "vision_bundle.cjs": (f"{_NPM}/vision_bundle.cjs", "text/javascript"),  # carregado pelo worker (importScripts)
    "wasm/vision_wasm_internal.js": (f"{_NPM}/wasm/vision_wasm_internal.js", "text/javascript"),
    "wasm/vision_wasm_internal.wasm": (f"{_NPM}/wasm/vision_wasm_internal.wasm", "application/wasm"),
    "wasm/vision_wasm_nosimd_internal.js": (f"{_NPM}/wasm/vision_wasm_nosimd_internal.js", "text/javascript"),
    "wasm/vision_wasm_nosimd_internal.wasm": (f"{_NPM}/wasm/vision_wasm_nosimd_internal.wasm", "application/wasm"),
    "gesture_recognizer.task": (
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
        "application/octet-stream",
    ),
}
PASTA = RAIZ / "cache" / "visao" / VERSAO
_travas: dict[str, asyncio.Lock] = {}


async def servir(cliente: httpx.AsyncClient, caminho: str) -> FileResponse:
    if caminho not in ARQUIVOS:
        raise HTTPException(404)
    url, tipo = ARQUIVOS[caminho]
    destino = PASTA / caminho
    if not destino.exists():
        async with _travas.setdefault(caminho, asyncio.Lock()):
            if not destino.exists():
                destino.parent.mkdir(parents=True, exist_ok=True)
                tmp = destino.with_suffix(destino.suffix + ".parcial")
                log.info("Baixando %s (uma vez só)...", caminho)
                try:
                    async with cliente.stream("GET", url, timeout=120, follow_redirects=True) as r:
                        r.raise_for_status()
                        with open(tmp, "wb") as f:
                            async for bloco in r.aiter_bytes(1 << 16):
                                f.write(bloco)
                    os.replace(tmp, destino)
                except Exception as e:  # noqa: BLE001
                    tmp.unlink(missing_ok=True)
                    raise HTTPException(502, f"Não foi possível baixar {caminho}: {e}") from e
    # arquivos versionados: o navegador pode guardar por muito tempo
    return FileResponse(destino, media_type=tipo, headers={"Cache-Control": "public, max-age=31536000, immutable"})
