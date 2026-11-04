"""Retorno do microfone: deixa ouvir, na própria tela, o que o microfone capta (ao vivo)
e exatamente o que chegou ao Whisper em cada frase (depois da reamostragem e do ganho).

Serve para descobrir se a transcrição está ruim por causa do áudio: volume baixo, ruído,
eco, microfone errado...

Privacidade:
- Só funciona para a tela LOCAL (o celular em /remote não tem acesso).
- As frases só são guardadas enquanto o retorno está aberto em Ajustes, e no máximo as últimas 6.
  Ao fechar os Ajustes, mutar ou clicar em "Esquecer", elas são apagadas. Nada vai para o disco.
"""
from __future__ import annotations

import asyncio
import io
import itertools
import logging
import math
import time
import wave
from collections import deque
from dataclasses import dataclass, field

import numpy as np

log = logging.getLogger("retorno")

MAX_FRASES = 6


def _db(v: float) -> float:
    return round(20 * math.log10(max(v, 1e-6)), 1)


def wav(x: np.ndarray, taxa: int) -> bytes:
    pcm = (np.clip(x, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        w.writeframes(pcm)
    return b.getvalue()


@dataclass(eq=False)
class Ouvinte:
    fila: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(maxsize=80))
    ao_vivo: bool = False

    def por(self, msg) -> None:
        try:
            self.fila.put_nowait(msg)
        except asyncio.QueueFull:
            pass  # tela lenta: perde um pedaço do ao vivo, mas não acumula atraso


class Retorno:
    def __init__(self) -> None:
        self.loop: asyncio.AbstractEventLoop | None = None
        self.ouvintes: set[Ouvinte] = set()
        self.frases: deque[dict] = deque(maxlen=MAX_FRASES)
        self.info: dict = {"tipo": "info", "microfone": "", "taxa": 0}
        self._ids = itertools.count(1)

    # ── lido pelas threads de áudio ─────────────────────────
    @property
    def ativo(self) -> bool:
        return bool(self.ouvintes)

    @property
    def ao_vivo(self) -> bool:
        return any(o.ao_vivo for o in tuple(self.ouvintes))

    def _no_loop(self, f, *args) -> None:
        loop = self.loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(f, *args)

    def definir_info(self, microfone: str, taxa: int, api: str = "") -> None:
        self.info = {"tipo": "info", "microfone": microfone, "taxa": taxa, "api": api}
        self._no_loop(self._todos, self.info)

    def audio(self, bloco: np.ndarray) -> None:
        """Bloco do microfone (float32, taxa nativa): nível em dBFS para o medidor e,
        para as telas com o ao vivo ligado, o próprio áudio em int16."""
        if not self.ouvintes:
            return
        rms = float(np.sqrt(np.mean(bloco * bloco))) if len(bloco) else 0.0
        pico = float(np.max(np.abs(bloco))) if len(bloco) else 0.0
        self._no_loop(self._todos, {"tipo": "nivel", "rms": _db(rms), "pico": _db(pico)})
        if self.ao_vivo:
            pcm = (np.clip(bloco, -1.0, 1.0) * 32767).astype("<i2").tobytes()
            self._no_loop(self._ao_vivo, pcm)

    def frase(self, dados: dict, audio: np.ndarray, taxa: int) -> None:
        if not self.ativo:
            return
        item = {"tipo": "frase", "id": next(self._ids), "t": time.time(), **dados}
        item["_wav"] = wav(audio, taxa)
        self._no_loop(self._nova_frase, item)

    def limpar(self) -> None:
        self._no_loop(self._limpar)

    # ── no laço do servidor ─────────────────────────────────
    def _todos(self, msg) -> None:
        for o in self.ouvintes:
            o.por(msg)

    def _ao_vivo(self, pcm: bytes) -> None:
        for o in self.ouvintes:
            if o.ao_vivo:
                o.por(pcm)

    def _publica(self, f: dict) -> dict:
        return {k: v for k, v in f.items() if not k.startswith("_")}

    def _nova_frase(self, item: dict) -> None:
        if not self.ouvintes:
            return
        self.frases.append(item)
        self._todos(self._publica(item))

    def _limpar(self) -> None:
        self.frases.clear()
        self._todos({"tipo": "limpo"})

    def entrar(self) -> Ouvinte:
        if self.loop is None:
            self.loop = asyncio.get_running_loop()
        o = Ouvinte()
        self.ouvintes.add(o)
        o.por(self.info)
        for f in self.frases:
            o.por(self._publica(f))
        return o

    def sair(self, o: Ouvinte) -> None:
        self.ouvintes.discard(o)
        if not self.ouvintes:
            self.frases.clear()  # ninguém ouvindo: não guarda áudio nenhum

    def obter_wav(self, ident: int) -> bytes | None:
        return next((f["_wav"] for f in self.frases if f["id"] == ident), None)


retorno = Retorno()


def listar_microfones() -> list[dict]:
    """Microfones pelo WASAPI (nomes completos e áudio na taxa nativa, sem a conversão do MME)."""
    try:
        import sounddevice as sd

        apis = sd.query_hostapis()
        wasapi = next((i for i, a in enumerate(apis) if "WASAPI" in a["name"]), None)
        padrao = apis[wasapi]["default_input_device"] if wasapi is not None else sd.default.device[0]
        lista = []
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] <= 0 or (wasapi is not None and d["hostapi"] != wasapi):
                continue
            lista.append({"nome": d["name"], "padrao": i == padrao, "taxa": int(d["default_samplerate"])})
        return lista
    except Exception as e:  # noqa: BLE001
        log.warning("Não foi possível listar os microfones: %s", e)
        return []
