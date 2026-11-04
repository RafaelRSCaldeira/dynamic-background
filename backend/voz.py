"""Voz do Zak (texto → fala), tudo local.

Motores:
- "kokoro": Kokoro 82M em ONNX. Leve (roda na CPU mais rápido que o tempo real), voz masculina pt-BR "pm_alex".
  Baixa ~340 MB uma vez para cache/voz.
- "nenhum": sem áudio; a tela mostra só a legenda.
O motor é escolhido em [zak] voz_motor no config.toml. Novos motores (ex.: um modelo maior na GPU)
só precisam de `sintetizar(texto) -> (amostras float32, taxa)`.
"""
from __future__ import annotations

import io
import logging
import re
import threading
import time
import wave
from pathlib import Path

import httpx
import numpy as np

from .config import RAIZ

log = logging.getLogger("voz")
PASTA = RAIZ / "cache" / "voz"
KOKORO = {
    "kokoro-v1.0.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
}

# números e siglas que o fonetizador lê mal: escreve como se fala
_TROCAS = [
    (re.compile(r"(\d)\.(\d{3})\b"), r"\1\2"),          # 8.849 → 8849 (o ponto de milhar vira "ponto")
    (re.compile(r"\bkm/h\b", re.I), "quilômetros por hora"),
    (re.compile(r"(\d)\s?km\b", re.I), r"\1 quilômetros"),
    (re.compile(r"(\d)\s?m\b"), r"\1 metros"),
    (re.compile(r"(\d)\s?°C?"), r"\1 graus"),
    (re.compile(r"(\d)\s?%"), r"\1 por cento"),
    (re.compile(r"\bR\$\s?(\d+)"), r"\1 reais"),
    (re.compile(r"\b(\d{1,2})(?::|h)00\b"), r"\1 horas"),       # 15:00 → "15 horas"
    (re.compile(r"(\d{1,2})h(\d{2})\b"), r"\1 e \2"),
    (re.compile(r"(\d{1,2}):(\d{2})\b"), r"\1 e \2"),
    (re.compile(r"(\d{1,2})h\b"), r"\1 horas"),
    (re.compile(r"\bZak\b"), "Záque"),
    # palavras estrangeiras comuns, escritas como se fala
    (re.compile(r"\bjazz\b", re.I), "djéz"),
    (re.compile(r"\blo-?fi\b", re.I), "lôu fái"),
    (re.compile(r"\brock\b", re.I), "róque"),
    (re.compile(r"\bplaylist\b", re.I), "plêilist"),
    (re.compile(r"\bonline\b", re.I), "onláine"),
    (re.compile(r"\bwi-?fi\b", re.I), "uái fái"),
]


def preparar(texto: str) -> str:
    texto = re.sub(r"[*_#`>\[\]\"“”]", "", texto or "")
    # só o que o fonetizador em português sabe ler (letras latinas, números, pontuação)
    texto = re.sub(r"\([^)]*[^\x00-\u024f][^)]*\)", "", texto)
    texto = re.sub(r"[^\x00-\u024f\u2018\u2019\u2026\u2013\u2014]", "", texto)
    for padrao, troca in _TROCAS:
        texto = padrao.sub(troca, texto)
    return " ".join(texto.split())


def frases(texto: str) -> list[str]:
    """Divide em frases para começar a falar antes de sintetizar tudo."""
    partes = re.split(r"(?<=[.!?…])\s+", texto.strip())
    juntas: list[str] = []
    for p in partes:
        if juntas and len(juntas[-1]) < 25:   # frase curtinha vai junto com a próxima (soa mais natural)
            juntas[-1] += " " + p
        elif p:
            juntas.append(p)
    return juntas


def wav(amostras: np.ndarray, taxa: int) -> bytes:
    pcm = (np.clip(amostras, -1, 1) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(taxa)
        w.writeframes(pcm)
    return buf.getvalue()


class Voz:
    def __init__(self, cfg: dict) -> None:
        self.motor_pedido = (cfg.get("voz_motor") or "kokoro").lower()
        self.voz = cfg.get("voz") or "pm_alex"
        self.velocidade = float(cfg.get("voz_velocidade") or 1.0)
        self.estado = "desligada" if self.motor_pedido == "nenhum" else "carregando"
        self.detalhe = ""
        self._kokoro = None
        self._trava = threading.Lock()

    @property
    def pronta(self) -> bool:
        return self.estado == "pronta"

    # ── carga ───────────────────────────────────────────────
    def carregar(self) -> None:
        """Roda numa thread: baixa (uma vez) e carrega o modelo."""
        if self.motor_pedido == "nenhum":
            return
        try:
            PASTA.mkdir(parents=True, exist_ok=True)
            for nome, url in KOKORO.items():
                destino = PASTA / nome
                if destino.exists() and destino.stat().st_size > 1_000_000:
                    continue
                self.detalhe = f"Baixando a voz ({nome})…"
                log.info("Baixando %s", url)
                tmp = destino.with_suffix(".tmp")
                with httpx.stream("GET", url, follow_redirects=True, timeout=120) as r:
                    r.raise_for_status()
                    with open(tmp, "wb") as f:
                        for pedaco in r.iter_bytes(1 << 20):
                            f.write(pedaco)
                tmp.replace(destino)
            from kokoro_onnx import Kokoro

            t0 = time.perf_counter()
            self._kokoro = Kokoro(str(PASTA / "kokoro-v1.0.onnx"), str(PASTA / "voices-v1.0.bin"))
            self.sintetizar("Oi.")   # aquece (a primeira síntese é mais lenta)
            self.estado, self.detalhe = "pronta", f"Kokoro · {self.voz}"
            log.info("Voz pronta (Kokoro %s) em %.1fs", self.voz, time.perf_counter() - t0)
        except Exception as e:  # noqa: BLE001
            self.estado, self.detalhe = "erro", f"Voz indisponível: {e}"[:200]
            log.warning("Voz indisponível: %s", e)

    # ── síntese ─────────────────────────────────────────────
    def sintetizar(self, texto: str) -> tuple[np.ndarray, int]:
        if self._kokoro is None:
            raise RuntimeError("voz não carregada")
        with self._trava:
            amostras, taxa = self._kokoro.create(preparar(texto), voice=self.voz, speed=self.velocidade, lang="pt-br")
        return np.asarray(amostras, dtype=np.float32), int(taxa)
