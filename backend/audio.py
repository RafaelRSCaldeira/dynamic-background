"""Captura do microfone → segmentação por voz → transcrição local com Whisper.

Privacidade:
- Quando mutado, o stream do microfone é FECHADO (o Windows deixa de mostrar o mic em uso).
- Áudio nunca é gravado em disco; segmentos vivem só na memória até serem transcritos.
- Se o mute for ativado durante uma transcrição, o resultado é descartado.
"""
from __future__ import annotations

import glob
import logging
import math
import os
import queue
import site
import threading
import time
from collections import deque

import numpy as np

from .sala import Sala

log = logging.getLogger("audio")

TAXA = 16000          # Whisper trabalha em 16 kHz
BLOCO_MS = 100
SILENCIO_FIM_MS = 800
SEGMENTO_MAX_MS = 20000
FALA_MIN_MS = 400

# Frases que o Whisper costuma "alucinar" em silêncio/ruído
ALUCINACOES = (
    "amara.org", "legendas pela comunidade", "inscreva-se", "obrigado por assistir",
    "legenda adriana", "transcrição e legendas", "e aí, pessoal", "tchau, tchau",
    "subtitles by", "thank you for watching",
)


def _registrar_dlls_cuda() -> None:
    """Permite usar a GPU com as libs pip `nvidia-cublas-cu12` / `nvidia-cudnn-cu12`."""
    if os.name != "nt":
        return
    pastas = site.getsitepackages() + [site.getusersitepackages()]
    for sp in pastas:
        for d in glob.glob(os.path.join(sp, "nvidia", "*", "bin")):
            try:
                os.add_dll_directory(d)
            except OSError:
                pass
            os.environ["PATH"] = d + os.pathsep + os.environ.get("PATH", "")


def _eh_alucinacao(texto: str) -> bool:
    t = texto.lower().strip(" .!?…")
    if len(t) < 2:
        return True
    return any(a in t for a in ALUCINACOES)


class ServicoAudio:
    def __init__(self, sala: Sala, cfg: dict) -> None:
        self.sala = sala
        self.cfg = cfg
        self.blocos: queue.Queue[np.ndarray] = queue.Queue(maxsize=300)
        self.segmentos: queue.Queue[np.ndarray] = queue.Queue(maxsize=6)
        self.parar = threading.Event()
        self.modelo = None
        self.dispositivo = "?"

    def iniciar(self) -> None:
        threading.Thread(target=self._loop_transcricao, name="whisper", daemon=True).start()
        threading.Thread(target=self._loop_captura, name="captura", daemon=True).start()

    # ── Whisper ─────────────────────────────────────────────
    def _carregar_modelo(self) -> None:
        from faster_whisper import WhisperModel

        nome = self.cfg["modelo_whisper"]
        pref = self.cfg["dispositivo_whisper"]
        tentativas = []
        if pref in ("auto", "cuda"):
            _registrar_dlls_cuda()
            tentativas.append(("cuda", "float16"))
        if pref in ("auto", "cpu"):
            tentativas.append(("cpu", "int8"))

        erros = []
        for dispositivo, tipo in tentativas:
            self.sala.definir_motor("carregando", f"Whisper {nome} ({dispositivo.upper()})")
            try:
                modelo = WhisperModel(nome, device=dispositivo, compute_type=tipo)
                # aquecimento: força o carregamento das libs CUDA agora, e não no meio da conversa
                list(modelo.transcribe(np.zeros(TAXA, dtype=np.float32), language=self.cfg["idioma"])[0])
                self.modelo, self.dispositivo = modelo, dispositivo
                log.info("Whisper %s carregado em %s", nome, dispositivo)
                return
            except Exception as e:  # noqa: BLE001
                log.warning("Whisper em %s falhou: %s", dispositivo, e)
                erros.append(f"{dispositivo}: {e}")
        raise RuntimeError("; ".join(erros))

    def _loop_transcricao(self) -> None:
        try:
            self._carregar_modelo()
        except Exception as e:  # noqa: BLE001
            self.sala.definir_motor("erro", f"Não foi possível carregar o Whisper: {e}")
            return
        self.sala.definir_motor("pronto", f"Whisper {self.cfg['modelo_whisper']} · {self.dispositivo.upper()}")

        while not self.parar.is_set():
            try:
                audio = self.segmentos.get(timeout=0.5)
            except queue.Empty:
                continue
            if self.sala.mutado:
                continue
            try:
                partes, _ = self.modelo.transcribe(
                    audio,
                    language=self.cfg["idioma"],
                    beam_size=5 if self.dispositivo == "cuda" else 1,
                    vad_filter=True,
                    condition_on_previous_text=False,
                )
                texto = " ".join(
                    p.text.strip() for p in partes if p.no_speech_prob < 0.6 and p.avg_logprob > -1.0
                ).strip()
            except Exception as e:  # noqa: BLE001
                log.warning("Erro na transcrição: %s", e)
                continue
            if not texto or _eh_alucinacao(texto):
                continue
            if self.sala.mutado:  # mutaram enquanto transcrevia → descarta
                continue
            log.info("🗣  %s", texto)
            self.sala.adicionar_linha(texto)

    # ── Microfone ───────────────────────────────────────────
    def _escolher_dispositivo(self):
        import sounddevice as sd

        nome = (self.cfg.get("microfone") or "").strip().lower()
        if not nome:
            return None, sd.query_devices(kind="input")
        for i, d in enumerate(sd.query_devices()):
            if d["max_input_channels"] > 0 and nome in d["name"].lower():
                return i, d
        raise RuntimeError(f'Microfone "{self.cfg["microfone"]}" não encontrado')

    def _abrir_stream(self):
        import sounddevice as sd

        indice, info = self._escolher_dispositivo()
        taxa = int(info["default_samplerate"]) or 48000
        tamanho = int(taxa * BLOCO_MS / 1000)

        def callback(indata, frames, tempo, status):  # thread do PortAudio
            bloco = indata[:, 0]
            if taxa != TAXA:  # reamostra para 16 kHz
                n = int(len(bloco) * TAXA / taxa)
                bloco = np.interp(np.linspace(0, len(bloco) - 1, n), np.arange(len(bloco)), bloco)
            try:
                self.blocos.put_nowait(bloco.astype(np.float32))
            except queue.Full:
                pass

        stream = sd.InputStream(
            device=indice, channels=1, samplerate=taxa, blocksize=tamanho, dtype="float32", callback=callback
        )
        stream.start()
        log.info("Microfone aberto: %s (%d Hz)", info["name"], taxa)
        return stream

    def _limpar_fila(self) -> None:
        while True:
            try:
                self.blocos.get_nowait()
            except queue.Empty:
                return

    def _loop_captura(self) -> None:
        hub = self.sala.hub
        stream = None
        sens = max(0.2, float(self.cfg.get("sensibilidade", 1.0)))
        pre_fala: deque[np.ndarray] = deque(maxlen=4)  # 400 ms antes da fala começar
        segmento: list[np.ndarray] = []
        falando = False
        silencio_ms = 0
        historico_rms: deque[float] = deque(maxlen=100)  # últimos 10 s
        ultimo_nivel = 0.0

        while not self.parar.is_set():
            # ── mute: fecha o microfone de verdade ──
            if self.sala.mutado:
                if stream is not None:
                    stream.stop()
                    stream.close()
                    stream = None
                    self._limpar_fila()
                    segmento, falando = [], False
                    pre_fala.clear()
                    hub.enviar_threadsafe({"tipo": "nivel", "v": 0})
                    log.info("Microfone fechado (mute)")
                time.sleep(0.15)
                continue

            if stream is None:
                try:
                    stream = self._abrir_stream()
                except Exception as e:  # noqa: BLE001
                    self.sala.definir_motor("erro", f"Microfone indisponível: {e}")
                    time.sleep(5)
                    continue
                if self.sala.motor == "erro" and self.modelo is not None:
                    self.sala.definir_motor("pronto", f"Whisper {self.cfg['modelo_whisper']} · {self.dispositivo.upper()}")

            try:
                bloco = self.blocos.get(timeout=0.5)
            except queue.Empty:
                continue

            rms = float(np.sqrt(np.mean(bloco * bloco)) + 1e-9)

            # ruído de fundo = percentil 20 dos últimos 10 s (se adapta a ventilador, ar-condicionado...)
            historico_rms.append(rms)
            ruido = float(np.percentile(historico_rms, 20)) if len(historico_rms) >= 10 else 0.003
            limiar = max(ruido * 2.5, 0.004) / sens

            # nível para a onda na tela: relativo ao ruído de fundo (sala quieta ≈ 0, fala ≈ 0.4–1)
            agora = time.monotonic()
            if agora - ultimo_nivel >= 0.08:
                acima_db = 20 * math.log10(rms / max(ruido, 1e-6))
                hub.enviar_threadsafe({"tipo": "nivel", "v": round(min(1.0, max(0.0, (acima_db - 3) / 24)), 3)})
                ultimo_nivel = agora
            if not falando:
                pre_fala.append(bloco)
                if rms > limiar:
                    falando, segmento, silencio_ms = True, list(pre_fala), 0
                continue

            segmento.append(bloco)
            silencio_ms = 0 if rms > limiar * 0.8 else silencio_ms + BLOCO_MS
            duracao = len(segmento) * BLOCO_MS
            if silencio_ms >= SILENCIO_FIM_MS or duracao >= SEGMENTO_MAX_MS:
                if duracao - silencio_ms >= FALA_MIN_MS:
                    try:
                        self.segmentos.put_nowait(np.concatenate(segmento))
                    except queue.Full:
                        log.warning("Transcrição atrasada; segmento descartado")
                falando, segmento = False, []
                pre_fala.clear()
