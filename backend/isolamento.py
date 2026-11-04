"""Isolamento da voz no microfone (escritório com teclado, cadeiras, ar-condicionado e conversa ao fundo).

Três modos, trocados na hora em Ajustes (ou [audio] isolamento no config.toml):
- "volume":    o jeito antigo — qualquer som bem acima do ruído de fundo vira uma frase para o Whisper.
- "voz":       um detector de voz neural (Silero VAD, o mesmo que já vem com o faster-whisper) decide quando
               alguém começou e parou de falar. Teclado, porta, cadeira e ar-condicionado não abrem frase.
- "voz_ruido": o detector + um removedor de ruído neural (GTCRN, 0,5 MB, roda na CPU) que limpa a frase
               antes do Whisper. Ajuda com ruído contínuo; ouça em Ajustes → retorno o que chega ao Whisper.

Tudo local: o áudio nunca sai do computador. O GTCRN é baixado uma vez para cache/isolamento.
"""
from __future__ import annotations

import logging
import os
import threading
import time
import urllib.request

import numpy as np

from .config import RAIZ

log = logging.getLogger("audio")

MODOS = ("volume", "voz", "voz_ruido")
PASTA = RAIZ / "cache" / "isolamento"
GTCRN_URL = "https://github.com/k2-fsa/sherpa-onnx/releases/download/speech-enhancement-models/gtcrn_simple.onnx"
TAXA = 16000


def _sessao(caminho: str, threads: int = 1):
    import onnxruntime

    opts = onnxruntime.SessionOptions()
    opts.inter_op_num_threads = 1
    opts.intra_op_num_threads = threads
    opts.log_severity_level = 4
    return onnxruntime.InferenceSession(caminho, providers=["CPUExecutionProvider"], sess_options=opts)


class DetectorVoz:
    """Silero VAD em streaming: recebe áudio a 16 kHz aos pedaços e devolve a probabilidade de voz."""

    JANELA = 512      # 32 ms
    CONTEXTO = 64

    def __init__(self) -> None:
        import faster_whisper.vad as vad

        self._s = _sessao(os.path.join(os.path.dirname(vad.__file__), "assets", "silero_vad_v6.onnx"))
        self.reiniciar()

    def reiniciar(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._ctx = np.zeros(self.CONTEXTO, dtype=np.float32)
        self._resto = np.zeros(0, dtype=np.float32)
        self.ultima = 0.0

    def prob(self, x16: np.ndarray) -> float:
        """Maior probabilidade de voz entre as janelas completas deste pedaço."""
        x = np.concatenate([self._resto, x16.astype(np.float32)])
        n = len(x) // self.JANELA
        self._resto = x[n * self.JANELA:]
        if not n:
            return self.ultima
        maior = 0.0
        for i in range(n):
            janela = x[i * self.JANELA:(i + 1) * self.JANELA]
            entrada = np.concatenate([self._ctx, janela])[None, :]
            p, self._h, self._c = self._s.run(None, {"input": entrada, "h": self._h, "c": self._c})
            self._ctx = janela[-self.CONTEXTO:]
            maior = max(maior, float(p.ravel()[0]))
        self.ultima = maior
        return maior


class RemovedorRuido:
    """GTCRN (modelo de streaming): STFT de 512 pontos, salto de 256, janela raiz de Hann; um quadro por vez."""

    N_FFT, SALTO = 512, 256

    def __init__(self) -> None:
        self.estado, self.detalhe = "desligado", ""
        self._s = None
        self._trava = threading.Lock()
        n = np.arange(self.N_FFT)
        self._janela = np.sqrt(0.5 - 0.5 * np.cos(2 * np.pi * n / self.N_FFT)).astype(np.float32)   # Hann periódica

    @property
    def pronto(self) -> bool:
        return self._s is not None

    def preparar(self) -> None:
        """Baixa (uma vez) e carrega o modelo numa thread; até lá as frases seguem sem limpeza."""
        with self._trava:
            if self._s is not None or self.estado == "carregando":
                return
            self.estado, self.detalhe = "carregando", "preparando o removedor de ruído…"
        threading.Thread(target=self._carregar, name="gtcrn", daemon=True).start()

    def _carregar(self) -> None:
        try:
            PASTA.mkdir(parents=True, exist_ok=True)
            arq = PASTA / "gtcrn_simple.onnx"
            if not arq.exists():
                log.info("Baixando o removedor de ruído (GTCRN, 0,5 MB)")
                pedido = urllib.request.Request(GTCRN_URL, headers={"User-Agent": "PainelAmbiente/1.0"})
                with urllib.request.urlopen(pedido, timeout=60) as r:
                    dados = r.read()
                tmp = arq.with_suffix(".tmp")
                tmp.write_bytes(dados)
                tmp.replace(arq)
            self._s = _sessao(str(arq), threads=2)
            self.estado, self.detalhe = "pronto", "GTCRN"
            log.info("Removedor de ruído pronto (GTCRN)")
        except Exception as e:  # noqa: BLE001
            self.estado, self.detalhe = "erro", f"removedor de ruído indisponível: {e}"[:200]
            log.warning("%s", self.detalhe)

    def limpar(self, x16: np.ndarray) -> np.ndarray:
        """A frase inteira (16 kHz) sem o ruído. Sem modelo pronto, devolve a frase como veio."""
        if self._s is None or len(x16) < self.N_FFT:
            return x16
        t0 = time.perf_counter()
        n, h, w = self.N_FFT, self.SALTO, self._janela
        x = np.pad(x16.astype(np.float32), (n // 2, n // 2), mode="reflect")   # como o torch.stft(center=True)
        quadros = 1 + (len(x) - n) // h
        conv = np.zeros((2, 1, 16, 16, 33), dtype=np.float32)
        tra = np.zeros((2, 3, 1, 1, 16), dtype=np.float32)
        inter = np.zeros((2, 1, 33, 16), dtype=np.float32)
        saida = np.zeros(len(x), dtype=np.float32)
        soma = np.zeros(len(x), dtype=np.float32)
        mix = np.zeros((1, n // 2 + 1, 1, 2), dtype=np.float32)
        for i in range(quadros):
            ini = i * h
            espectro = np.fft.rfft(x[ini:ini + n] * w)
            mix[0, :, 0, 0], mix[0, :, 0, 1] = espectro.real, espectro.imag
            enh, conv, tra, inter = self._s.run(None, {"mix": mix, "conv_cache": conv, "tra_cache": tra, "inter_cache": inter})
            quadro = np.fft.irfft(enh[0, :, 0, 0] + 1j * enh[0, :, 0, 1], n).astype(np.float32) * w
            saida[ini:ini + n] += quadro
            soma[ini:ini + n] += w * w
        saida = saida / np.maximum(soma, 1e-6)
        limpo = saida[n // 2:n // 2 + len(x16)]
        self.ultimo_ms = round((time.perf_counter() - t0) * 1000)
        return limpo.astype(np.float32)
