"""Captura do microfone → segmentação por voz → transcrição local com Whisper.

Privacidade:
- Quando mutado, o stream do microfone é FECHADO (o Windows deixa de mostrar o mic em uso).
- Áudio nunca é gravado em disco; segmentos vivem só na memória até serem transcritos.
- Se o mute for ativado durante uma transcrição, o resultado é descartado.
"""
from __future__ import annotations

import gc
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

from . import modelos
from .sala import Sala

log = logging.getLogger("audio")

TAXA = 16000           # Whisper trabalha em 16 kHz
BLOCO_MS = 100
PRE_FALA_MS = 500      # áudio guardado antes do início da fala (não corta a 1ª sílaba)
SILENCIO_FIM_MS = 1000 # pausa que encerra uma frase; curta demais = frases picotadas e sem contexto
SEGMENTO_MAX_MS = 28000  # o Whisper enxerga janelas de 30 s
FALA_MIN_MS = 400

# Frases que o Whisper costuma "alucinar" em silêncio/ruído
ALUCINACOES = (
    "amara.org", "legendas pela comunidade", "inscreva-se", "obrigado por assistir",
    "legenda adriana", "transcrição e legendas", "e aí, pessoal", "tchau, tchau",
    "subtitles by", "thank you for watching", "legendado por", "se inscreva no canal",
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


def _reamostrar(x: np.ndarray, de: int, para: int) -> np.ndarray:
    """Reamostragem limitada em banda (FFT). Ao contrário de interpolar amostra a amostra,
    não "dobra" as frequências altas para dentro da voz (aliasing), o que piora muito o Whisper."""
    if de == para or len(x) < 2:
        return x.astype(np.float32)
    n = len(x)
    m = max(1, int(round(n * para / de)))
    borda = min(n // 4, de // 100)  # 10 ms de fade: evita "estalo" nas pontas (a FFT supõe sinal periódico)
    if borda:
        rampa = np.linspace(0.0, 1.0, borda, dtype=np.float32)
        x = x.copy()
        x[:borda] *= rampa
        x[-borda:] *= rampa[::-1]
    espectro = np.fft.rfft(x)
    k = m // 2 + 1
    novo = np.zeros(k, dtype=espectro.dtype)
    c = min(k, len(espectro))
    novo[:c] = espectro[:c]
    return (np.fft.irfft(novo, m) * (m / n)).astype(np.float32)


def _normalizar(x: np.ndarray) -> np.ndarray:
    """Microfone longe das pessoas → fala baixa. Ganho moderado até um pico de ~0,9."""
    pico = float(np.max(np.abs(x))) if len(x) else 0.0
    if pico < 1e-4:
        return x
    return (x * min(0.9 / pico, 10.0)).astype(np.float32)


class ServicoAudio:
    def __init__(self, sala: Sala, cfg: dict) -> None:
        self.sala = sala
        self.cfg = cfg
        self.blocos: queue.Queue[np.ndarray] = queue.Queue(maxsize=300)
        self.segmentos: queue.Queue[np.ndarray] = queue.Queue(maxsize=6)
        self.parar = threading.Event()
        self.modelo = None
        self.nome = ""
        self.dispositivo = "?"
        self.taxa_mic = TAXA
        self._troca: str | None = None
        self._baixando = ""
        sala.ao_trocar_whisper = self.trocar_modelo

    def iniciar(self) -> None:
        threading.Thread(target=self._loop_transcricao, name="whisper", daemon=True).start()
        threading.Thread(target=self._loop_captura, name="captura", daemon=True).start()

    def trocar_modelo(self, nome: str) -> None:
        """Pedido vindo da tela. Se o modelo ainda não foi baixado, baixa em segundo plano
        enquanto o atual continua transcrevendo; a troca em si acontece entre um segmento e outro."""
        if nome == self._baixando:
            return  # já está baixando; troca sozinho quando terminar
        self._baixando = ""  # um pedido novo cancela a troca de um download anterior
        if nome == self.nome and self.modelo is not None:
            self.sala.definir_baixando("")
            return  # já é o modelo em uso (ex.: "auto" já tinha escolhido o turbo)
        if self.modelo is None or modelos.whisper_baixado(nome):
            self._troca = nome
        else:
            self._baixar_e_trocar(nome)

    def _baixar_e_trocar(self, nome: str) -> None:
        self._baixando = nome
        self.sala.definir_baixando(nome)

        def tarefa() -> None:
            try:
                from faster_whisper.utils import download_model

                log.info("Baixando Whisper %s em segundo plano...", nome)
                download_model(nome)
                if self._baixando == nome:
                    self._troca = nome
            except Exception as e:  # noqa: BLE001
                log.warning("Download do Whisper %s falhou: %s", nome, e)
                if self._baixando == nome:
                    self._baixando = ""
                    if self.nome:  # continua com o atual
                        self.sala.modelo_whisper = self.nome
                        modelos.gravar(modelo_whisper=self.nome)
                    self.sala.definir_baixando("", f"Não foi possível baixar o {nome}: {e}"[:200])

        threading.Thread(target=tarefa, name=f"baixar-{nome}", daemon=True).start()

    def _gpu_disponivel(self) -> bool:
        if self.cfg["dispositivo_whisper"] == "cpu":
            return False
        try:
            import ctranslate2

            return ctranslate2.get_cuda_device_count() > 0
        except Exception:  # noqa: BLE001
            return False

    def _resolver(self, pedido: str) -> str:
        """"auto" = o melhor que roda bem: large-v3-turbo com GPU, small só com CPU."""
        if pedido != "auto":
            return pedido
        return "large-v3-turbo" if self._gpu_disponivel() else "small"

    # ── Whisper ─────────────────────────────────────────────
    def _carregar_modelo(self, pedido: str) -> None:
        from faster_whisper import WhisperModel

        pref = self.cfg["dispositivo_whisper"]
        tentativas = []
        if pref in ("auto", "cuda"):
            _registrar_dlls_cuda()
            tentativas.append(("cuda", "float16"))
        if pref in ("auto", "cpu"):
            tentativas.append(("cpu", "int8"))

        # libera o modelo anterior antes (a VRAM é dividida com o Ollama)
        self.modelo = None
        gc.collect()

        erros = []
        for dispositivo, tipo in tentativas:
            # "auto": o melhor que cabe — turbo na GPU, small na CPU
            nome = pedido if pedido != "auto" else ("large-v3-turbo" if dispositivo == "cuda" else "small")
            info = next((m for m in modelos.WHISPER if m["nome"] == nome), None)
            acao = "Carregando" if modelos.whisper_baixado(nome) else f"Baixando ({info['tamanho'] if info else '?'})"
            self.sala.definir_motor("carregando", f"{acao} Whisper {nome} · {dispositivo.upper()}…", carregando=nome)
            try:
                modelo = WhisperModel(nome, device=dispositivo, compute_type=tipo)
                # aquecimento: força o carregamento das libs CUDA agora, e não no meio da conversa
                list(modelo.transcribe(np.zeros(TAXA, dtype=np.float32), language=self.cfg["idioma"])[0])
                self.modelo, self.nome, self.dispositivo = modelo, nome, dispositivo
                log.info("Whisper %s carregado em %s", nome, dispositivo)
                if self._baixando == nome:
                    self._baixando = ""
                    self.sala.definir_baixando("")
                self.sala.definir_whisper_carregado(nome, dispositivo)
                self.sala.definir_motor("pronto", f"Whisper {nome} · {dispositivo.upper()}")
                return
            except Exception as e:  # noqa: BLE001
                log.warning("Whisper %s em %s falhou: %s", nome, dispositivo, e)
                erros.append(f"{dispositivo}: {e}")
                gc.collect()
        raise RuntimeError("; ".join(erros))

    def _contexto(self) -> str | None:
        """Últimas falas como 'prompt': ajuda o Whisper com nomes, assunto e pontuação."""
        _, texto = self.sala.texto_recente(2)
        texto = " ".join(texto.split())
        return texto[-220:] if texto else None

    def _loop_transcricao(self) -> None:
        pedido = self.sala.modelo_whisper
        alvo = self._resolver(pedido)
        inicial = pedido
        if not modelos.whisper_baixado(alvo):
            # o escolhido ainda não foi baixado: começa com o maior que já está no PC
            em_cache = [m["nome"] for m in reversed(modelos.WHISPER) if modelos.whisper_baixado(m["nome"])]
            if em_cache:
                inicial = em_cache[0]
        try:
            self._carregar_modelo(inicial)
            # (no "auto", se a GPU falhou e caiu para a CPU, fica no modelo leve)
            if self.nome != alvo and not (pedido == "auto" and self.dispositivo == "cpu"):
                self._baixar_e_trocar(alvo)
        except Exception as e:  # noqa: BLE001
            self.sala.definir_motor("erro", f"Não foi possível carregar o Whisper: {e}")

        while not self.parar.is_set():
            if self._troca:
                pedido, self._troca = self._troca, None
                anterior = self.nome
                try:
                    self._carregar_modelo(pedido)
                except Exception as e:  # noqa: BLE001
                    erro = f"Não foi possível carregar o Whisper {pedido}: {e}"
                    if anterior:
                        log.warning("Troca para %s falhou; voltando para %s", pedido, anterior)
                        try:
                            self._carregar_modelo(anterior)
                            erro = ""
                            self.sala.modelo_whisper = anterior
                            modelos.gravar(modelo_whisper=anterior)
                            self.sala.definir_motor("pronto", f"{pedido} falhou; continuando com {anterior}")
                        except Exception:  # noqa: BLE001
                            pass
                    if erro:
                        self.sala.definir_motor("erro", erro)
            if self.modelo is None:
                time.sleep(0.5)
                continue
            try:
                audio = self.segmentos.get(timeout=0.5)
            except queue.Empty:
                continue
            if self.sala.mutado:
                continue
            audio = _normalizar(_reamostrar(audio, self.taxa_mic, TAXA))
            gpu = self.dispositivo == "cuda"
            try:
                partes, _ = self.modelo.transcribe(
                    audio,
                    language=self.cfg["idioma"],
                    beam_size=5 if gpu else 3,
                    vad_filter=True,
                    vad_parameters={"threshold": 0.4, "min_silence_duration_ms": 600, "speech_pad_ms": 400},
                    condition_on_previous_text=False,
                    initial_prompt=self._contexto(),
                    hallucination_silence_threshold=2.0,
                )
                trechos = []
                for p in partes:
                    # descarta só o que é claramente ruído/alucinação
                    if (p.no_speech_prob > 0.6 and p.avg_logprob < -0.8) or p.avg_logprob < -1.4:
                        continue
                    if p.compression_ratio > 2.4:  # repetição em loop
                        continue
                    trechos.append(p.text.strip())
                texto = " ".join(trechos).strip()
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
            try:
                self.blocos.put_nowait(indata[:, 0].copy())
            except queue.Full:
                pass

        stream = sd.InputStream(
            device=indice, channels=1, samplerate=taxa, blocksize=tamanho, dtype="float32", callback=callback
        )
        stream.start()
        self.taxa_mic = taxa  # os segmentos são reamostrados para 16 kHz inteiros, antes do Whisper
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
        pre_fala: deque[np.ndarray] = deque(maxlen=PRE_FALA_MS // BLOCO_MS)
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
                    self.sala.definir_motor("pronto", f"Whisper {self.nome} · {self.dispositivo.upper()}")

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
