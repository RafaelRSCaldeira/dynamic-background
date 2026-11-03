"""Estado da "sala": mute, transcrição recente e insights gerados pela IA."""
from __future__ import annotations

import threading
import time
from collections import deque

from .hub import Hub


class Sala:
    def __init__(self, hub: Hub, cfg_audio: dict, cfg_ia: dict) -> None:
        self.hub = hub
        self.cfg = cfg_audio
        self.modelo_ia = cfg_ia["modelo"]
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
                    linhas=list(self.linhas)[-6:],
                    insights=self.insights,
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

    def definir_motor(self, estado: str, detalhe: str = "") -> None:
        with self._trava:
            self.motor, self.motor_detalhe = estado, detalhe
        self.publicar()

    def definir_ia(self, estado: str, detalhe: str = "") -> None:
        with self._trava:
            if self.ia == estado and self.ia_detalhe == detalhe:
                return
            self.ia, self.ia_detalhe = estado, detalhe
        self.publicar()

    def definir_insights(self, insights: dict) -> None:
        with self._trava:
            self.insights, self.insights_em = insights, time.time()
        self.publicar()

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
