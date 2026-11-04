"""Estado da "sala": mute, transcrição recente e insights gerados pela IA."""
from __future__ import annotations

import asyncio
import itertools
import threading
import time
from collections import deque

from . import modelos
from .hub import Hub


IDIOMAS = {"pt", "en", "auto"}
GANHO_MIN, GANHO_MAX = -12.0, 24.0


class Sala:
    def __init__(self, hub: Hub, cfg_audio: dict, cfg_ia: dict) -> None:
        self.hub = hub
        self.cfg = cfg_audio
        prefs = modelos.ler()
        # escolhas feitas na tela (preferencias.json) valem mais que o config.toml
        self.modelo_ia: str = prefs.get("modelo_ia") or cfg_ia["modelo"]
        self.modelo_whisper: str = prefs.get("modelo_whisper") or cfg_audio["modelo_whisper"]
        self.whisper_atual = ""        # modelo realmente carregado
        self.whisper_carregando = ""   # modelo sendo carregado agora (transcrição pausada)
        self.whisper_baixando = ""     # modelo baixando em segundo plano (o atual segue funcionando)
        self.whisper_aviso = ""
        self.whisper_dispositivo = ""  # cuda | cpu
        self.acordar_ia: asyncio.Event | None = None  # criado pelo laço da IA
        self.ao_trocar_whisper = None  # callback do serviço de áudio
        self.microfone: str = prefs.get("microfone", cfg_audio.get("microfone") or "")  # "" = padrão do Windows
        self.idioma: str = prefs.get("idioma") or cfg_audio.get("idioma") or "pt"      # pt | en | auto
        self.idioma_desde = time.time()
        self.ganho_db: float = float(prefs.get("ganho_db", cfg_audio.get("ganho_db", 0)) or 0)
        self.microfone_atual = ""      # nome do dispositivo aberto agora
        self.microfone_taxa = 0
        self.ao_trocar_microfone = None
        self._trava = threading.RLock()

        self.mutado_manual = bool(cfg_audio["iniciar_mutado"])
        self.mutado_auto = False
        self.motivo_auto = ""

        # iniciando | carregando | pronto | erro | desativado
        self.motor = "iniciando" if cfg_audio["ativado"] else "desativado"
        self.motor_detalhe = ""
        # verificando | pronta | pensando | indisponivel
        self.ia = "verificando"
        self.ia_detalhe = ""

        self.linhas: deque[dict] = deque(maxlen=500)
        self.insights: dict | None = None
        # tudo o que a IA já mostrou (resumos e cards), em ordem: a tela vai acrescentando numa lista
        self.historico: deque[dict] = deque(maxlen=60)
        self._ids = itertools.count(1)
        self.insights_em: float | None = None
        self.versao = 0  # muda a cada linha nova; a IA só roda quando há novidade

    # ── estado ──────────────────────────────────────────────
    @property
    def mutado(self) -> bool:
        return self.mutado_manual or self.mutado_auto

    def estado(self) -> str:
        if self.motor == "desativado":
            return "desativado"
        if self.mutado_manual:
            return "mutado"
        if self.mutado_auto:
            return "auto"
        if self.motor == "pronto":
            return "ouvindo"
        return self.motor

    def snapshot(self, completo: bool = True) -> dict:
        with self._trava:
            dados = {
                "tipo": "sala",
                "estado": self.estado(),
                "mutado": self.mutado,
                "mutado_manual": self.mutado_manual,
                "mutado_auto": self.mutado_auto,
                "motivo_auto": self.motivo_auto,
                "motor_detalhe": self.motor_detalhe,
            }
            if completo:
                dados.update(
                    ia=self.ia,
                    ia_detalhe=self.ia_detalhe,
                    ia_modelo=self.modelo_ia,
                    whisper_modelo=self.modelo_whisper,
                    whisper_atual=self.whisper_atual,
                    whisper_carregando=self.whisper_carregando,
                    whisper_baixando=self.whisper_baixando,
                    whisper_aviso=self.whisper_aviso,
                    whisper_dispositivo=self.whisper_dispositivo,
                    microfone=self.microfone,
                    idioma=self.idioma,
                    ganho_db=self.ganho_db,
                    microfone_atual=self.microfone_atual,
                    microfone_taxa=self.microfone_taxa,
                    linhas=list(self.linhas)[-6:],
                    insights=self.insights,
                    historico=list(self.historico),
                    insights_em=self.insights_em,
                )
            return dados

    def publicar(self) -> None:
        self.hub.enviar_threadsafe(self.snapshot(True), self.snapshot(False))

    # ── ações ───────────────────────────────────────────────
    def definir_mute(self, valor: bool | None = None) -> None:
        with self._trava:
            self.mutado_manual = (not self.mutado_manual) if valor is None else bool(valor)
        self.publicar()

    def definir_auto(self, valor: bool, motivo: str = "") -> None:
        with self._trava:
            if self.mutado_auto == valor and self.motivo_auto == motivo:
                return
            self.mutado_auto, self.motivo_auto = valor, motivo
        self.publicar()

    def definir_motor(self, estado: str, detalhe: str = "", carregando: str = "") -> None:
        with self._trava:
            self.motor, self.motor_detalhe = estado, detalhe
            self.whisper_carregando = carregando if estado == "carregando" else ""
        self.publicar()

    def definir_ia(self, estado: str, detalhe: str = "") -> None:
        with self._trava:
            if self.ia == estado and self.ia_detalhe == detalhe:
                return
            self.ia, self.ia_detalhe = estado, detalhe
        self.publicar()

    def definir_modelo_ia(self, nome: str) -> None:
        nome = (nome or "").strip()
        if not nome or nome == self.modelo_ia:
            return
        with self._trava:
            self.modelo_ia = nome
            self.ia, self.ia_detalhe = "verificando", ""
        modelos.gravar(modelo_ia=nome)
        self.publicar()
        if self.acordar_ia:
            self.acordar_ia.set()  # gera insights de novo já com o modelo novo

    def definir_modelo_whisper(self, nome: str) -> None:
        if nome not in modelos.NOMES_WHISPER or nome == self.modelo_whisper:
            return
        with self._trava:
            self.modelo_whisper = nome
        modelos.gravar(modelo_whisper=nome)
        self.publicar()
        if self.ao_trocar_whisper:
            self.ao_trocar_whisper(nome)

    def definir_microfone(self, nome: str) -> None:
        nome = (nome or "").strip()
        if nome == self.microfone:
            return
        with self._trava:
            self.microfone = nome
        modelos.gravar(microfone=nome)
        self.publicar()
        if self.ao_trocar_microfone:
            self.ao_trocar_microfone()

    def definir_idioma(self, idioma: str) -> None:
        if idioma not in IDIOMAS or idioma == self.idioma:
            return
        with self._trava:
            self.idioma, self.idioma_desde = idioma, time.time()
        modelos.gravar(idioma=idioma)
        self.publicar()

    def definir_ganho(self, db: float) -> None:
        db = round(max(GANHO_MIN, min(GANHO_MAX, float(db))), 1)
        if db == self.ganho_db:
            return
        with self._trava:
            self.ganho_db = db
        modelos.gravar(ganho_db=db)
        self.publicar()

    def definir_microfone_atual(self, nome: str, taxa: int) -> None:
        with self._trava:
            self.microfone_atual, self.microfone_taxa = nome, taxa
        self.publicar()

    def definir_baixando(self, nome: str, aviso: str = "") -> None:
        with self._trava:
            self.whisper_baixando, self.whisper_aviso = nome, aviso
        self.publicar()

    def definir_whisper_carregado(self, nome: str, dispositivo: str) -> None:
        with self._trava:
            self.whisper_atual, self.whisper_dispositivo = nome, dispositivo
        self.publicar()

    def definir_insights(self, insights: dict) -> None:
        agora = time.time()
        with self._trava:
            self.insights, self.insights_em = insights, agora
            self._acrescentar(insights, agora)
        self.publicar()

    def _acrescentar(self, ins: dict, t: float) -> None:
        """Acrescenta ao histórico só o que é novo: um resumo diferente do último e cards ainda não vistos."""
        resumo = (ins.get("resumo") or "").strip()
        ultimo = next((h for h in reversed(self.historico) if h["tipo"] == "resumo"), None)
        if resumo and (not ultimo or ultimo["texto"] != resumo):
            self.historico.append({"id": next(self._ids), "t": t, "tipo": "resumo", "texto": resumo,
                                   "topicos": list(ins.get("topicos") or [])})
        vistos = {(h["tipo"], h.get("titulo", "").lower()) for h in self.historico}
        for c in ins.get("cards") or []:
            if (c["tipo"], c["titulo"].lower()) in vistos:
                continue
            self.historico.append({"id": next(self._ids), "t": t, **c})

    def adicionar_linha(self, texto: str) -> None:
        with self._trava:
            self.linhas.append({"t": time.time(), "texto": texto})
            self.versao += 1
        self.podar()
        self.publicar()

    def esquecer(self) -> None:
        """Apaga toda a transcrição e os insights da memória."""
        with self._trava:
            self.linhas.clear()
            self.insights, self.insights_em = None, None
            self.historico.clear()
            self.versao += 1
        self.publicar()

    def podar(self) -> None:
        limite = time.time() - float(self.cfg["retencao_minutos"]) * 60
        with self._trava:
            while self.linhas and self.linhas[0]["t"] < limite:
                self.linhas.popleft()

    def texto_recente(self, minutos: float) -> tuple[int, str]:
        limite = time.time() - minutos * 60
        with self._trava:
            linhas = [l["texto"] for l in self.linhas if l["t"] >= limite]
            return self.versao, "\n".join(linhas)
