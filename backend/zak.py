"""Zak: o assistente da sala.

- Modo ambiente: assim que chega fala nova (no máximo a cada ~8 s) olha a conversa recente e, se houver
  um assunto (e não sensível), transforma a tela na cena desse assunto já na primeira leitura. Uma cena
  fica pelo menos 12 s; se o assunto continua, a cada ~35 s a tela mostra outro ângulo dele.
- "Ei, Zak": a frase reconhecida pelo Whisper que começa chamando o Zak vira um pedido: responder,
  timer, lembrete, música, limpar a tela, parar de ouvir. A resposta é falada (voz local) e mostrada na tela.
- Eco: enquanto o Zak fala, o que o microfone capta é descartado (é a própria voz dele), a não ser que
  alguém o chame pelo nome — aí ele se cala e atende ("Zak, para").
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
import re
import time
import unicodedata
from collections import OrderedDict
from datetime import datetime, timedelta

import httpx

from . import dados, modelos
from .config import RAIZ
from .imagens import UA
from .sala import Sala
from .geracao import Gerador
from .voz import Voz, frases, wav
from .zak_ia import Cerebro

log = logging.getLogger("zak")
AGENDA = RAIZ / "cache" / "zak_agenda.json"

ESPERA_PEDIDO_S = 8          # depois de um "Ei, Zak" sozinho, quanto tempo ele espera o pedido
JANELA_AMBIENTE_MIN = 1.5    # quanto da conversa recente o modo ambiente lê (curto: assunto novo pesa logo)
MIN_PALAVRAS = 6
PERMANENCIA_S = 12           # uma cena do ambiente fica pelo menos isso antes de dar lugar a outro assunto
VARIAR_S = 35                # mesmo assunto por mais que isso: a tela mostra outro ângulo dele
PRIORIDADE_CONVERSA_S = 30   # depois de responder alguém, o ambiente não troca a tela por esse tempo
CONFIANCA_MIN = 0.4
RECENTE_S = 40               # falas dos últimos X s definem o assunto; as anteriores só dão contexto
ECO_FOLGA_S = 0.8

# "Ei, Zak" e as formas como o Whisper costuma escrever (medido com vozes reais e sintéticas):
# "E Zak", "Eizaki", "Ozaki", "Ei, Zá", "Ei, Isaac", "Eis aqui"... A busca é feita no texto sem acentos.
_NOME = r"(?:zak|zack|zac|zach|zaque|zaqui|zaki|zake|zaq|zeck|zeke|zek|zequi|zaky)"   # estes valem até sem "ei"
_NOME_FROUXO = rf"(?:{_NOME}|za|sac|sak|saque|saqui|sack|zaca|zag|jack|isaac|izak|izaque|isaque)"   # só depois de "ei"
_EI = r"(?:ei|hei|hey|ey|e\s*ai|oi|ola|ok|okay|alo)"
_FIM = r"(?![a-z0-9])[\s,.!?;:-]*"
_CHAMADOS = [
    re.compile(rf"^\W*(?:{_EI}[\s,.!?]*)?{_NOME}{_FIM}"),           # "Zak, ...", "Ei Zak", "Eizak"
    re.compile(rf"^\W*(?:e|o|ou|eu)[\s,.!?]*{_NOME}{_FIM}"),         # "E Zak", "O Zak", "Ozaki" ("ei" mal ouvido)
    re.compile(rf"^\W*{_EI}[\s,.!?]*{_NOME_FROUXO}{_FIM}"),          # "Ei, Zá", "Ei, Isaac", "Eisaque"
    re.compile(rf"^\W*eis\s+a?qui{_FIM}"),                            # "Ei, Zak" ouvido como "Eis aqui"
    re.compile(rf"(?:^|[\s,.!?;:]){_EI}[\s,.!]+{_NOME_FROUXO}{_FIM}"),   # no meio da frase, só com "ei"
]
_PARE = re.compile(r"^(?:para|pare|chega|sil[eê]ncio|cala(?:-se| a boca)?|quieto|stop|espera|pode parar)[\s.!]*$", re.I)


# Comandos simples não passam pelo modelo: mais rápido e sem mal-entendido ("para a música" virava "o que quer ouvir?").
_ATALHOS = [
    ("parar_musica", re.compile(r"\b(?:para|pare|parar|desliga|desligar|tira|chega de|cala)\b.*\b(?:musica|radio|som)\b")),
    ("cancelar_timer", re.compile(r"\b(?:cancela|cancelar|para|pare|desliga|tira)\b.*\b(?:timer|cronometro|alarme|contagem)\b")),
    ("limpar_tela", re.compile(r"\b(?:limpa|limpar|apaga|apagar|tira|fecha)\b.*\btela\b")),
    ("volume_mais", re.compile(r"\b(?:aumenta|aumentar|sobe|subir|levanta)\b.*\b(?:volume|som|musica)\b|\bmais alto\b")),
    ("volume_menos", re.compile(r"\b(?:abaixa|abaixar|diminui|diminuir|baixa|baixar)\b.*\b(?:volume|som|musica)\b|\bmais baixo\b")),
]
# palavras que justificam a ação "clima" (o modelo às vezes a escolhia para perguntas como "altura do Everest")
_CLIMA = re.compile(r"\b(?:tempo|clima|chuv\w*|chove\w*|frio|calor|graus|temperatura|hora|horas|sol|nublad\w*|previs\w*|vento|neve)\b")


def atalho(frase: str) -> dict | None:
    """Pedido simples reconhecido sem o modelo (no mesmo formato do Cerebro.pedido)."""
    base = _base(frase)
    if len(base.split()) > 8 or re.search(r"\blembr|\bdaqui\b|\bdepois\b|\bquando\b|\bas \d|\bem \d", base):
        return None   # "me lembra de parar a música às 3" é um lembrete, não um comando para agora
    for acao, padrao in _ATALHOS:
        if padrao.search(base):
            volume = acao.removeprefix("volume_") if acao.startswith("volume_") else ""
            return {"acao": "volume" if volume else acao, "volume": volume, "segundos": 0, "rotulo": "", "em_minutos": 0,
                    "horario": "", "texto": "", "estilo": "", "lugar": "", "pesquisar": "", "fala": "", "cena": {"blocos": []}}
    return None


def _base(texto: str) -> str:
    """Minúsculas e sem acentos, letra por letra (mesmo tamanho do original, para recortar o pedido)."""
    return "".join((unicodedata.normalize("NFD", c)[:1] or c).lower() for c in texto)


def chamado(texto: str) -> str | None:
    """Se a frase chama o Zak, devolve o pedido (pode ser ""); senão None."""
    base = _base(texto)
    m = next((m for m in (r.search(base) for r in _CHAMADOS) if m), None)
    if not m:
        return None
    return texto[m.end():].strip(" ,.!?-")


def _norm(s: str) -> str:
    s = "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9 ]+", " ", s)


def parecido(a: str, b: str) -> bool:
    pa = {w for w in _norm(a).split() if len(w) > 2}
    pb = {w for w in _norm(b).split() if len(w) > 2}
    if not pa or not pb:
        return False
    return len(pa & pb) / min(len(pa), len(pb)) >= 0.5


def _duracao(seg: int) -> str:
    h, resto = divmod(seg, 3600)
    m, s = divmod(resto, 60)
    partes = ([f"{h} hora" + ("s" if h > 1 else "")] if h else []) + ([f"{m} minuto" + ("s" if m > 1 else "")] if m else [])
    if s and not h:
        partes.append(f"{s} segundo" + ("s" if s > 1 else ""))
    return " e ".join(partes) or "0 segundos"


_WMO = {0: "Céu limpo", 1: "Quase sem nuvens", 2: "Parcialmente nublado", 3: "Nublado", 45: "Neblina", 48: "Neblina",
        51: "Garoa fraca", 53: "Garoa", 55: "Garoa forte", 61: "Chuva fraca", 63: "Chuva", 65: "Chuva forte",
        66: "Chuva congelante", 67: "Chuva congelante", 71: "Neve fraca", 73: "Neve", 75: "Neve forte", 77: "Neve",
        80: "Pancadas de chuva", 81: "Pancadas de chuva", 82: "Pancadas fortes", 85: "Pancadas de neve", 86: "Pancadas de neve",
        95: "Trovoadas", 96: "Trovoadas com granizo", 99: "Trovoadas com granizo"}


def _wmo(codigo) -> str:
    return _WMO.get(int(codigo or 0), "Tempo variável")


def _fuso(nome: str):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(nome)
    except Exception:  # noqa: BLE001
        return None


# ── dados de apoio (todos gratuitos, sem chave) ─────────────
async def _wikipedia(http: httpx.AsyncClient, termo: str) -> str:
    async def buscar():
        r = await http.get("https://pt.wikipedia.org/w/api.php", headers=UA, params={
            "action": "query", "format": "json", "list": "search", "srsearch": termo, "srlimit": 1})
        r.raise_for_status()
        achados = r.json().get("query", {}).get("search", [])
        if not achados:
            return ""
        titulo = achados[0]["title"]
        r = await http.get("https://pt.wikipedia.org/w/api.php", headers=UA, params={
            "action": "query", "format": "json", "prop": "extracts", "exintro": 1, "explaintext": 1,
            "redirects": 1, "titles": titulo})
        r.raise_for_status()
        paginas = r.json().get("query", {}).get("pages", {})
        texto = next(iter(paginas.values()), {}).get("extract", "")
        return f"{titulo}: {texto[:1800]}" if texto else ""

    return await dados.cache.obter(f"wiki:{termo.lower()}", 6 * 3600, buscar)


async def _lugar(http: httpx.AsyncClient, nome: str) -> dict | None:
    async def buscar():
        r = await http.get("https://geocoding-api.open-meteo.com/v1/search",
                           params={"name": nome, "count": 1, "language": "pt"})
        r.raise_for_status()
        res = (r.json().get("results") or [None])[0]
        if not res:
            return None
        c = await http.get("https://api.open-meteo.com/v1/forecast", params={
            "latitude": res["latitude"], "longitude": res["longitude"], "timezone": "auto",
            "current": "temperature_2m,weather_code,is_day", "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max",
            "forecast_days": 1})
        c.raise_for_status()
        d = c.json()
        return {"nome": res["name"], "pais": res.get("country", ""), "fuso": res.get("timezone") or d.get("timezone"),
                "temp": round(d["current"]["temperature_2m"]), "codigo": d["current"]["weather_code"],
                "dia": bool(d["current"]["is_day"]), "max": round(d["daily"]["temperature_2m_max"][0]),
                "min": round(d["daily"]["temperature_2m_min"][0]),
                "chuva": int((d["daily"].get("precipitation_probability_max") or [0])[0] or 0)}

    try:
        return await dados.cache.obter(f"lugar:{nome.lower()}", 1800, buscar)
    except Exception as e:  # noqa: BLE001
        log.info("lugar %r: %s", nome, e)
        return None


_RADIO_HOSTS = ["all.api.radio-browser.info", "de1.api.radio-browser.info", "nl1.api.radio-browser.info",
                "at1.api.radio-browser.info"]


async def _radio(http: httpx.AsyncClient, estilo: str) -> dict | None:
    """Uma rádio online gratuita do estilo pedido (radio-browser.info, base aberta de rádios)."""
    termos = _norm(estilo).split() or ["lofi"]

    async def pesquisar(params: dict) -> list:
        erro = None
        for host in _RADIO_HOSTS:   # o endereço "all" às vezes cai num espelho fora do ar: tenta os outros
            try:
                r = await http.get(f"https://{host}/json/stations/search", headers=UA, timeout=8, params={
                    **params, "order": "clickcount", "reverse": "true", "limit": 15, "hidebroken": "true"})
                r.raise_for_status()
                return r.json()
            except Exception as e:  # noqa: BLE001
                erro = e
        raise erro

    async def buscar():
        for params in ({"tag": " ".join(termos)}, {"tag": termos[0]}, {"name": " ".join(termos)}):
            achadas = await pesquisar(params)
            boas = [s for s in achadas if s.get("url_resolved") and s.get("codec", "").upper() in ("MP3", "AAC", "AAC+", "OGG")
                    and int(s.get("bitrate") or 128) >= 64]
            if boas:
                boas.sort(key=lambda s: (not s["url_resolved"].startswith("https"), -int(s.get("clickcount") or 0)))
                s = boas[0]
                return {"nome": " ".join(s["name"].split())[:60], "url": s["url_resolved"], "estilo": estilo}
        return None

    try:
        return await dados.cache.obter(f"radio:{' '.join(termos)}", 3600, buscar)
    except Exception as e:  # noqa: BLE001
        log.warning("rádio %r: %s", estilo, e)
        return None


class Zak:
    def __init__(self, sala: Sala, cfg: dict, cfg_ia: dict, cfg_local: dict) -> None:
        self.sala, self.hub, self.cfg, self.cfg_local = sala, sala.hub, cfg, cfg_local
        self.cerebro = Cerebro(cfg_ia)
        self.voz = Voz(cfg)
        self.gerador = Gerador(cfg)
        prefs = modelos.ler()
        self.protecao: bool = bool(prefs.get("zak_protecao", cfg.get("protecao", True)))
        self.loop: asyncio.AbstractEventLoop | None = None
        self.http: httpx.AsyncClient | None = None
        self.telas: set[int] = set()
        self.estado = "repouso"            # repouso | ouvindo | pensando
        self.esperando_ate = 0.0
        self.falando = False
        self.falando_ate = 0.0
        self.fala_atual = ""
        self._fala_id = 0
        self._ids = itertools.count(1)
        self.cena: dict | None = None
        self.cena_origem = ""
        self.cena_em = 0.0
        self.assunto = ""
        self.timers: list[dict] = []
        self.lembretes: list[dict] = []
        self.musica: dict | None = None
        self.volume = 0.5
        self.audios: OrderedDict[str, bytes] = OrderedDict()
        self._pedidos = asyncio.Lock()
        self._carregar_agenda()

    # ── estado e publicação ─────────────────────────────────
    def snapshot(self) -> dict:
        return {
            "tipo": "zak", "estado": self.estado, "protecao": self.protecao,
            "voz": self.voz.estado, "voz_detalhe": self.voz.detalhe,
            "imagem": {"pronto": "pronta", "carregando": "carregando", "gerando": "gerando", "erro": "erro", "baixando": "baixando",
                       "indisponivel": "indisponível", "desligado": "desligada"}.get(self.gerador.estado, ""),
            "imagem_detalhe": self.gerador.detalhe,
            "timers": self.timers, "lembretes": sorted(self.lembretes, key=lambda l: l["quando"])[:5],
            "musica": self.musica, "volume": self.volume,
            # uma tela que conecta agora (ou recarrega) só recebe a cena se ela ainda estaria no ar
            "cena": self.cena if self.cena and time.time() - self.cena_em < 120 else None,
        }

    def _enviar(self, msg: dict) -> None:
        self.hub.enviar_threadsafe(msg)   # só as telas locais (o celular em /remote nunca recebe)

    def publicar(self) -> None:
        self._enviar(self.snapshot())

    def _estado(self, estado: str, ouviu: str = "") -> None:
        self.estado = estado
        self._enviar({"tipo": "zak_estado", "estado": estado, "ouviu": ouviu})

    def definir_protecao(self, valor: bool) -> None:
        self.protecao = bool(valor)
        modelos.gravar(zak_protecao=self.protecao)
        if self.protecao and self.cena_origem == "ambiente":
            self.limpar_tela()   # a cena atual foi escolhida sem a proteção
        self.publicar()

    def tela_entrou(self, ident: int) -> None:
        self.telas.add(ident)

    def tela_saiu(self, ident: int) -> None:
        self.telas.discard(ident)

    def tocando(self, valor: bool) -> None:
        """A tela avisa quando a voz do Zak começa e termina de tocar (para descartar o eco)."""
        self.falando = bool(valor)
        if valor:
            self._falando_desde = time.time()
        else:
            self.falando_ate = time.time() + ECO_FOLGA_S

    @property
    def _falando_agora(self) -> bool:
        # trava de segurança: se a tela nunca avisar que terminou, depois de 40 s volta a ouvir normalmente
        return self.falando and time.time() - getattr(self, "_falando_desde", 0) < 40

    # ── laços ───────────────────────────────────────────────
    async def executar(self, http: httpx.AsyncClient) -> None:
        self.loop, self.http = asyncio.get_running_loop(), http
        await asyncio.to_thread(self.voz.carregar)
        self.publicar()
        await asyncio.gather(self._laco_ambiente(), self._laco_relogio(), self._preparar_imagens())

    async def _preparar_imagens(self) -> None:
        await self.gerador.preparar()
        self.publicar()

    async def _laco_ambiente(self) -> None:
        """Lê a conversa assim que chega fala nova (no máximo a cada `ambiente_segundos`) e troca a tela
        já na primeira leitura de um assunto novo. O mesmo assunto, se continua, ganha outro ângulo."""
        intervalo = max(4, int(self.cfg.get("ambiente_segundos", 8)))
        ultima_versao, ultima_leitura = -1, 0.0
        while True:
            await asyncio.sleep(1)
            try:
                agora = time.time()
                if agora - ultima_leitura < intervalo:
                    continue
                if not self.telas or self.sala.mutado or self.estado != "repouso" or self._falando_agora:
                    continue
                if self.cena_origem == "conversa" and agora - self.cena_em < PRIORIDADE_CONVERSA_S:
                    continue
                if self.cena_origem == "ambiente" and agora - self.cena_em < PERMANENCIA_S:
                    continue                                     # a cena acabou de entrar: não pisca
                versao, linhas = self.sala.linhas_recentes(JANELA_AMBIENTE_MIN)
                agora_ = [t for quando, t in linhas if agora - quando <= RECENTE_S]
                antes = [t for quando, t in linhas if agora - quando > RECENTE_S]
                if versao == ultima_versao or len(" ".join(agora_).split()) < MIN_PALAVRAS:
                    continue
                # o assunto sai das falas recentes; as anteriores são só contexto (senão o assunto velho domina)
                texto = (("Antes (só contexto):\n" + "\n".join(antes) + "\n\n" if antes else "")
                         + "AGORA (as últimas falas — é delas que sai o assunto):\n" + "\n".join(agora_))
                ultima_versao, ultima_leitura = versao, agora
                mostrado = self._resumo_cena() if self.cena_origem == "ambiente" else ""
                t0 = time.perf_counter()
                r = await self.cerebro.ambiente(self.http, self.sala.modelo_ia, texto, self.protecao, self.assunto, mostrado)
                if self.estado != "repouso" or self.sala.versao < versao:   # alguém chamou o Zak / pediu esquecer
                    continue
                log.info("ambiente: %s (%.2f%s, %.1fs) %s", r["assunto"] or "—", r["confianca"],
                         ", sensível" if r["sensivel"] else "", time.perf_counter() - t0, "→ mostrar" if r["mostrar"] else "")
                if not r["mostrar"] or r["confianca"] < CONFIANCA_MIN:
                    continue
                desde = time.time() - self.cena_em
                if self.cena_origem == "ambiente" and parecido(r["assunto"], self.assunto):
                    if desde < VARIAR_S:
                        self._enviar({"tipo": "zak_manter"})   # mesmo assunto, cena recente: continua na tela
                        continue
                await self._mostrar(r["cena"], "ambiente", assunto=r["assunto"])
            except Exception as e:  # noqa: BLE001
                log.warning("modo ambiente: %s", e)

    def _resumo_cena(self) -> str:
        """O que a tela mostra agora (para a próxima cena do mesmo assunto trazer outro ângulo)."""
        if not self.cena:
            return ""
        titulos = [b.get("titulo") or b.get("rotulo") or b.get("tipo") for b in self.cena.get("blocos", [])]
        foto = self.cena.get("visual", {}).get("busca", "")
        return f'{self.assunto} — blocos: {", ".join(t for t in titulos if t)}' + (f'; foto: "{foto}"' if foto else "")

    async def _laco_relogio(self) -> None:
        while True:
            await asyncio.sleep(1)
            agora = time.time()
            for t in [t for t in self.timers if t["ate"] <= agora]:
                self.timers.remove(t)
                self._salvar_agenda()
                rotulo = t["rotulo"]
                self._enviar({"tipo": "zak_alarme"})
                await self._mostrar({"blocos": [{"tipo": "contagem", "ate": int(t["ate"] * 1000), "segundos": t["total"],
                                                 "rotulo": rotulo or "Timer"}], "cor": "#ff8a5c"}, "conversa")
                await self.falar(f"Ei, o timer {'do ' + rotulo.lower() + ' ' if rotulo else ''}acabou!" if rotulo
                                 else "Ei, o tempo acabou!")
            for l in [l for l in self.lembretes if l["quando"] <= agora]:
                self.lembretes.remove(l)
                self._salvar_agenda()
                self._enviar({"tipo": "zak_alarme"})
                await self._mostrar({"blocos": [{"tipo": "destaque", "kicker": "Lembrete", "titulo": l["texto"][:60],
                                                 "sub": datetime.fromtimestamp(l["quando"]).strftime("Agora, %H:%M")}],
                                     "cor": "#ffb347"}, "conversa")
                await self.falar(f"Lembrete: {l['texto']}.")
                self.publicar()

    # ── o que o microfone ouviu (chamado pela thread do Whisper) ──
    def ouvir(self, texto: str, inicio: float, fim: float) -> bool:
        """Decide o destino da frase. True = é do Zak (pedido ou eco): não entra na conversa da sala."""
        if self.loop is None:
            return False
        agora = time.time()
        pedido = chamado(texto)
        eco = self._falando_agora or inicio < self.falando_ate
        if pedido is not None and _PARE.match(pedido):   # "Zak, para": só se cala (e não vira pedido)
            self.calar()
            self.esperando_ate = 0
            return True
        if eco:
            if pedido is not None and not parecido(texto, self.fala_atual):
                log.info("interrompido: %s", texto)
                self.calar()
                if pedido:
                    self._agendar(self.pedido(pedido, texto))
                else:
                    self._ouvir_pedido()
            return True
        if pedido is not None:
            if len(pedido.split()) < 2 and not re.search(r"\w{4,}", pedido):
                self._ouvir_pedido()             # só "Ei, Zak": espera o pedido na próxima frase
            else:
                self._agendar(self.pedido(pedido, texto))
            return True
        if agora < self.esperando_ate:
            self.esperando_ate = 0
            self._agendar(self.pedido(texto, texto))
            return True
        return False

    def _ouvir_pedido(self) -> None:
        self.esperando_ate = time.time() + ESPERA_PEDIDO_S
        self.loop.call_soon_threadsafe(self._estado, "ouvindo", "")

        async def desistir():
            await asyncio.sleep(ESPERA_PEDIDO_S + 0.5)
            if self.estado == "ouvindo" and time.time() >= self.esperando_ate:
                self._estado("repouso")
        self._agendar(desistir())

    def _agendar(self, coro) -> None:
        asyncio.run_coroutine_threadsafe(coro, self.loop)

    def calar(self) -> None:
        self._fala_id += 1                   # partes ainda sendo sintetizadas são abandonadas
        self.falando, self.falando_ate = False, time.time() + ECO_FOLGA_S
        self._enviar({"tipo": "zak_calar"})

    # ── pedidos ─────────────────────────────────────────────
    async def pedido(self, frase: str, original: str = "") -> None:
        frase = frase.strip()
        if not frase:
            return
        async with self._pedidos:
            self.esperando_ate = 0
            self._estado("pensando", original or frase)
            if r := atalho(frase):
                log.info("pedido: %s → %s (atalho)", frase, r["acao"])
                self._estado("repouso")
                await self._executar(r, original or frase)
                return
            log.info("pedido: %s", frase)
            try:
                cidade = self.cfg_local.get("cidade") or ""
                r = await self.cerebro.pedido(self.http, self.sala.modelo_ia, frase, cidade, await self._clima_local())
                if r["acao"] == "clima" and not _CLIMA.search(_base(frase)):
                    # "altura do Everest" não é pergunta de clima: responde de verdade, com a Wikipédia de apoio
                    log.info("ação clima descartada para: %s", frase)
                    r["acao"], r["pesquisar"] = "responder", r["pesquisar"] or frase
                if r["pesquisar"] and r["acao"] == "responder":
                    trecho = await _wikipedia(self.http, r["pesquisar"])
                    if trecho:
                        r = await self.cerebro.pedido(self.http, self.sala.modelo_ia, frase, cidade,
                                                      await self._clima_local(), (r["pesquisar"], trecho))
            except Exception as e:  # noqa: BLE001
                log.warning("pedido falhou: %s", e)
                self._estado("repouso")
                await self.falar("Desculpa, meu cérebro não respondeu agora. Tenta de novo em instantes?")
                return
            self._estado("repouso")
            await self._executar(r, original or frase)

    async def _executar(self, r: dict, pergunta: str) -> None:
        acao, fala = r["acao"], r["fala"]
        if acao == "timer" and r["segundos"] > 0:
            t = {"id": next(self._ids), "ate": time.time() + r["segundos"], "total": r["segundos"], "rotulo": r["rotulo"]}
            self.timers.append(t)
            self._salvar_agenda()
            await self._mostrar({"blocos": [{"tipo": "contagem", "ate": int(t["ate"] * 1000), "segundos": t["total"],
                                             "rotulo": r["rotulo"] or "Timer"}], "cor": r["cena"].get("cor") or "#d9893f"},
                                "conversa", pergunta=pergunta)
            fala = fala or f"Pronto, {_duracao(r['segundos'])}."
        elif acao == "cancelar_timer":
            n = len(self.timers)
            self.timers.clear()
            self._salvar_agenda()
            if self.cena and any(b["tipo"] == "contagem" for b in self.cena.get("blocos", [])):
                self.limpar_tela()
            fala = fala or ("Timer cancelado." if n else "Não tem nenhum timer rodando.")
        elif acao == "lembrete" and r["texto"]:
            quando = self._quando(r)
            if quando is None:
                fala = "Para quando é o lembrete?"
            else:
                self.lembretes.append({"id": next(self._ids), "quando": quando, "texto": r["texto"]})
                self._salvar_agenda()
                hora = datetime.fromtimestamp(quando)
                dia = "hoje" if hora.date() == datetime.now().date() else "amanhã" if hora.date() == (datetime.now() + timedelta(days=1)).date() else hora.strftime("%d/%m")
                await self._mostrar({"blocos": [{"tipo": "destaque", "kicker": "Lembrete", "titulo": r["texto"][:60],
                                                 "sub": f"{dia.capitalize()}, às {hora:%H:%M}"}], "cor": "#ffb347"},
                                    "conversa", pergunta=pergunta)
                fala = fala or f"Combinado, te lembro {dia} às {hora:%H:%M}."
        elif acao == "musica":
            radio = await _radio(self.http, r["estilo"] or "lofi")
            if radio:
                self.musica = radio
                self._enviar({"tipo": "zak_musica", "musica": radio, "volume": self.volume})
                await self._mostrar({"blocos": [{"tipo": "destaque", "kicker": "Tocando agora",
                                                 "titulo": (r["estilo"] or "Música").capitalize()[:40], "sub": radio["nome"]}],
                                     "gerar": f"{r['estilo'] or 'calm music'} mood, abstract sound waves of light, cinematic, no text",
                                     "cor": r["cena"].get("cor") or "#9b7bff"}, "conversa", pergunta=pergunta)
                fala = fala or "Tocando agora."
            else:
                fala = "Não achei uma rádio desse estilo agora. Quer tentar outro?"
        elif acao == "clima":
            lugar = await _lugar(self.http, r["lugar"] or self.cfg_local.get("cidade") or "São Paulo")
            if lugar:
                desc = _wmo(lugar["codigo"])
                await self._mostrar({"blocos": [{"tipo": "destaque", "kicker": lugar["pais"] or "Agora", "titulo": lugar["nome"],
                                                 "sub": f"{desc} · máxima de {lugar['max']}°, mínima de {lugar['min']}°"}],
                                     "foto": r["cena"].get("foto") or f"{lugar['nome']} skyline", "lugar": lugar["nome"],
                                     "cor": r["cena"].get("cor")}, "conversa", pergunta=pergunta)
                # a fala sai dos dados reais (não do modelo): hora local, temperatura, céu e chance de chuva
                hora = datetime.now(_fuso(lugar["fuso"])).strftime("%H:%M")
                chuva = f", com {lugar['chuva']}% de chance de chuva hoje" if lugar.get("chuva", 0) >= 20 else ""
                fala = f"Em {lugar['nome']} agora são {hora} e faz {lugar['temp']} graus, {desc.lower()}{chuva}."
            else:
                fala = "Não encontrei essa cidade. Pode repetir o nome?"
        elif acao == "parar_musica":
            self.musica = None
            self._enviar({"tipo": "zak_musica", "musica": None, "volume": self.volume})
            fala = fala or "Música desligada."
        elif acao == "volume":
            self.volume = round(min(1.0, max(0.05, self.volume + (0.15 if r["volume"] == "mais" else -0.15))), 2)
            self._enviar({"tipo": "zak_musica", "musica": self.musica, "volume": self.volume})
            fala = fala or "Feito."
        elif acao == "limpar_tela":
            self.limpar_tela()
            fala = fala or "Pronto."
        elif acao == "parar_de_ouvir":
            await self.falar(fala or "Tudo bem, parei de ouvir. Para eu voltar, toque no microfone.")
            await asyncio.sleep(1.5)
            self.sala.definir_mute(True)
            return
        elif r["cena"]["blocos"]:
            await self._mostrar(r["cena"], "conversa", pergunta=pergunta)
        self.publicar()
        if fala:
            await self.falar(fala)

    def _quando(self, r: dict) -> float | None:
        m = re.fullmatch(r"(\d{1,2})(?:[:h](\d{2})?)?", (r["horario"] or "").strip())
        if not m:   # sem horário dito: "daqui a X minutos"
            return time.time() + r["em_minutos"] * 60 if r["em_minutos"] else None
        agora = datetime.now()
        alvo = agora.replace(hour=min(23, int(m[1])), minute=int(m[2] or 0), second=0, microsecond=0)
        if alvo <= agora:
            alvo += timedelta(days=1)
        return alvo.timestamp()

    async def _clima_local(self) -> str:
        try:
            loc = await dados.localizar(self.http, self.cfg_local)
            d = await dados.clima(self.http, loc)
            c, dia = d["current"], d["daily"]
            chuva = max((d["hourly"].get("precipitation_probability") or [0])[:12])
            return (f"Clima agora em {loc['nome']}: {round(c['temperature_2m'])}°C (código WMO {c['weather_code']}), "
                    f"máxima {round(dia['temperature_2m_max'][0])}°, mínima {round(dia['temperature_2m_min'][0])}°, "
                    f"chance de chuva nas próximas 12 h até {chuva}%. Amanhã: máx {round(dia['temperature_2m_max'][1])}°, "
                    f"mín {round(dia['temperature_2m_min'][1])}°, chuva até {dia['precipitation_probability_max'][1]}%.")
        except Exception:  # noqa: BLE001
            return ""

    # ── tela ────────────────────────────────────────────────
    async def _mostrar(self, cena: dict, origem: str, assunto: str = "", pergunta: str = "") -> None:
        blocos = [dict(b) for b in cena.get("blocos") or []]
        if cena.get("lugar"):
            lugar = await _lugar(self.http, cena["lugar"])
            if lugar:
                # hora local (a tela mantém certa) e clima de agora: dados de verdade, não do modelo
                hora = {"rotulo": "Hora lá", "valor": datetime.now().strftime("%H:%M"), "fuso": lugar["fuso"]}
                fatos = next((b for b in blocos if b["tipo"] == "fatos"), None)
                if fatos:
                    fatos["itens"] = [hora] + [i for i in fatos["itens"] if "hora" not in i.get("rotulo", "").lower()][:3]
                else:
                    blocos.insert(1, {"tipo": "fatos", "itens": [hora]})
                blocos.append({"tipo": "clima", "temp": lugar["temp"], "codigo": lugar["codigo"], "dia": lugar["dia"],
                               "max": lugar["max"], "min": lugar["min"], "lugar": lugar["nome"]})
        gerar = cena.get("gerar") if self.gerador.disponivel else ""   # sem gerador: a cena fica só com o fundo animado
        visual = {k: v for k, v in (("busca", cena.get("foto")), ("gerar", gerar), ("cor", cena.get("cor"))) if v}
        self.cena = {"origem": origem, "pergunta": pergunta, "visual": visual, "blocos": blocos[:4], "t": time.time()}
        self.cena_origem, self.cena_em, self.assunto = origem, time.time(), assunto or self.assunto
        self._enviar({"tipo": "zak_cena", "cena": self.cena})

    def limpar_tela(self) -> None:
        self.cena, self.cena_origem, self.assunto = None, "", ""
        self._enviar({"tipo": "zak_limpar"})

    # ── voz ─────────────────────────────────────────────────
    async def falar(self, texto: str) -> None:
        self._fala_id += 1
        ident = self._fala_id
        self.fala_atual = texto
        partes = frases(texto)
        self._enviar({"tipo": "zak_fala", "id": ident, "texto": texto, "audio": self.voz.pronta, "partes": len(partes)})
        if not self.voz.pronta:
            return
        for i, frase in enumerate(partes):
            try:
                amostras, taxa = await asyncio.to_thread(self.voz.sintetizar, frase)
            except Exception as e:  # noqa: BLE001
                log.warning("voz: %s", e)
                return
            if ident != self._fala_id:
                return                           # foi interrompido
            chave = f"{ident}-{i}"
            self.audios[chave] = wav(amostras, taxa)
            while len(self.audios) > 40:
                self.audios.popitem(last=False)
            self._enviar({"tipo": "zak_audio", "id": ident, "parte": i, "texto": frase, "ultima": i == len(partes) - 1,
                          "url": f"/api/zak/audio/{chave}.wav", "duracao": round(len(amostras) / taxa, 2)})

    def audio(self, chave: str) -> bytes | None:
        return self.audios.get(chave)

    # ── agenda (timers e lembretes sobrevivem a reiniciar o servidor) ──
    def _carregar_agenda(self) -> None:
        try:
            d = json.loads(AGENDA.read_text(encoding="utf-8"))
            agora = time.time()
            self.timers = [t for t in d.get("timers", []) if t["ate"] > agora]
            self.lembretes = [l for l in d.get("lembretes", []) if l["quando"] > agora - 3600]
            self._ids = itertools.count(1 + max([0] + [x["id"] for x in self.timers + self.lembretes]))
        except Exception:  # noqa: BLE001
            pass

    def _salvar_agenda(self) -> None:
        try:
            AGENDA.parent.mkdir(parents=True, exist_ok=True)
            AGENDA.write_text(json.dumps({"timers": self.timers, "lembretes": self.lembretes}, ensure_ascii=False),
                              encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            log.warning("agenda: %s", e)
