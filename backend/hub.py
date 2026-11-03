"""Distribui mensagens em tempo real para as telas conectadas via WebSocket."""
from __future__ import annotations

import asyncio
import json

from fastapi import WebSocket


class Hub:
    def __init__(self) -> None:
        # ws -> True se o cliente é local (a própria tela); remotos só recebem mensagens públicas
        self.clientes: dict[WebSocket, bool] = {}
        self.loop: asyncio.AbstractEventLoop | None = None
        self._trava = asyncio.Lock()

    def adicionar(self, ws: WebSocket, local: bool) -> None:
        self.clientes[ws] = local

    def remover(self, ws: WebSocket) -> None:
        self.clientes.pop(ws, None)

    async def enviar(self, msg: dict, publica: dict | None = None) -> None:
        texto = json.dumps(msg, ensure_ascii=False)
        texto_pub = json.dumps(publica, ensure_ascii=False) if publica is not None else None
        async with self._trava:
            for ws, local in list(self.clientes.items()):
                carga = texto if local else texto_pub
                if carga is None:
                    continue
                try:
                    await ws.send_text(carga)
                except Exception:
                    self.remover(ws)

    def enviar_threadsafe(self, msg: dict, publica: dict | None = None) -> None:
        """Pode ser chamado de qualquer thread (captura de áudio, Whisper...)."""
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(self.enviar(msg, publica), loop)
