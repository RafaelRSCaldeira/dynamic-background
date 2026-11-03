"""Coleta de dados externos (todos gratuitos e sem chave), com cache em memória."""
from __future__ import annotations

import asyncio
import html
import logging
import re
import time
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree as ET

import httpx

log = logging.getLogger("dados")


class Cache:
    def __init__(self) -> None:
        self._dados: dict[str, tuple[float, object]] = {}
        self._travas: dict[str, asyncio.Lock] = {}

    async def obter(self, chave: str, ttl: float, fabrica):
        trava = self._travas.setdefault(chave, asyncio.Lock())
        async with trava:
            item = self._dados.get(chave)
            if item and time.time() - item[0] < ttl:
                return item[1]
            try:
                valor = await fabrica()
            except Exception as e:  # noqa: BLE001
                if item:  # devolve o último valor conhecido se a fonte falhar
                    log.warning("%s falhou (%s); usando cache antigo", chave, e)
                    return item[1]
                raise
            self._dados[chave] = (time.time(), valor)
            return valor


cache = Cache()


# ── Localização ──────────────────────────────────────────────
async def localizar(cliente: httpx.AsyncClient, local: dict) -> dict:
    if local.get("latitude") is not None and local.get("longitude") is not None:
        return {"nome": local.get("cidade") or "", "lat": float(local["latitude"]), "lon": float(local["longitude"])}

    async def buscar():
        params = {"name": local["cidade"], "count": 1, "language": "pt"}
        if local.get("pais"):
            params["countryCode"] = local["pais"]
        r = await cliente.get("https://geocoding-api.open-meteo.com/v1/search", params=params)
        r.raise_for_status()
        res = (r.json().get("results") or [None])[0]
        if not res:
            raise RuntimeError(f"Cidade não encontrada: {local['cidade']}")
        return {"nome": res["name"], "lat": res["latitude"], "lon": res["longitude"]}

    return await cache.obter(f"geo:{local['cidade']}", 7 * 86400, buscar)


# ── Clima ────────────────────────────────────────────────────
async def clima(cliente: httpx.AsyncClient, loc: dict) -> dict:
    async def buscar():
        base = {"latitude": loc["lat"], "longitude": loc["lon"], "timezone": "auto"}
        previsao = cliente.get(
            "https://api.open-meteo.com/v1/forecast",
            params=base | {
                "current": "temperature_2m,apparent_temperature,relative_humidity_2m,is_day,weather_code,"
                           "wind_speed_10m,wind_direction_10m,precipitation,cloud_cover,uv_index",
                "hourly": "temperature_2m,precipitation_probability,weather_code,is_day",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,"
                         "precipitation_probability_max,uv_index_max",
                "forecast_days": 8,
            },
        )
        ar = cliente.get(
            "https://air-quality-api.open-meteo.com/v1/air-quality",
            params=base | {"current": "us_aqi,pm2_5,pm10"},
        )
        r1, r2 = await asyncio.gather(previsao, ar, return_exceptions=True)
        if isinstance(r1, Exception):
            raise r1
        r1.raise_for_status()
        dados = r1.json()
        dados["ar"] = None
        if not isinstance(r2, Exception) and r2.status_code == 200:
            dados["ar"] = r2.json().get("current")
        dados["local"] = loc["nome"]
        return dados

    return await cache.obter("clima", 600, buscar)


# ── Moedas ───────────────────────────────────────────────────
NOMES_MOEDA = {"USD": "Dólar", "EUR": "Euro", "BTC": "Bitcoin", "GBP": "Libra", "ARS": "Peso arg.", "JPY": "Iene"}


async def mercado(cliente: httpx.AsyncClient, moedas: list[str]) -> list[dict]:
    async def uma(par: str):
        r = await cliente.get(f"https://economia.awesomeapi.com.br/json/daily/{par}/15")
        r.raise_for_status()
        serie = r.json()
        atual = serie[0]
        historico = [float(p["bid"]) for p in reversed(serie) if p.get("bid")]
        codigo = par.split("-")[0]
        return {
            "par": par,
            "codigo": codigo,
            "nome": NOMES_MOEDA.get(codigo, atual.get("name", codigo).split("/")[0]),
            "valor": float(atual["bid"]),
            "variacao": float(atual.get("pctChange") or 0),
            "historico": historico,
        }

    async def buscar():
        res = await asyncio.gather(*(uma(p) for p in moedas), return_exceptions=True)
        validos = [r for r in res if not isinstance(r, Exception)]
        if not validos:
            raise RuntimeError("Nenhuma cotação disponível")
        return validos

    return await cache.obter("mercado", 900, buscar)


# ── Feriados ─────────────────────────────────────────────────
async def feriados(cliente: httpx.AsyncClient) -> list[dict]:
    async def buscar():
        ano = date.today().year
        lista = []
        for a in (ano, ano + 1):
            r = await cliente.get(f"https://brasilapi.com.br/api/feriados/v1/{a}")
            if r.status_code == 200:
                lista += r.json()
        hoje = date.today().isoformat()
        return [{"data": f["date"], "nome": f["name"]} for f in sorted(lista, key=lambda f: f["date"]) if f["date"] >= hoje][:5]

    return await cache.obter("feriados", 6 * 3600, buscar)


# ── Notícias (RSS) ───────────────────────────────────────────
_TAG = re.compile(r"<[^>]+>")
ATOM = "{http://www.w3.org/2005/Atom}"


def _texto(el) -> str:
    return html.unescape(_TAG.sub("", (el.text or "") if el is not None else "")).strip()


def _data(s: str | None) -> float:
    if not s:
        return 0
    try:
        return parsedate_to_datetime(s).timestamp()
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
        except ValueError:
            return 0


async def noticias(cliente: httpx.AsyncClient, feeds: list[dict]) -> list[dict]:
    async def um(feed: dict):
        r = await cliente.get(feed["url"], follow_redirects=True)
        r.raise_for_status()
        raiz = ET.fromstring(r.content)
        itens = []
        for item in raiz.iter("item"):
            itens.append({"titulo": _texto(item.find("title")), "t": _data(item.findtext("pubDate"))})
        for item in raiz.iter(ATOM + "entry"):
            itens.append({"titulo": _texto(item.find(ATOM + "title")), "t": _data(item.findtext(ATOM + "updated"))})
        return [i | {"fonte": feed["nome"]} for i in itens[:15] if i["titulo"]]

    async def buscar():
        res = await asyncio.gather(*(um(f) for f in feeds), return_exceptions=True)
        todos = [i for r in res if not isinstance(r, Exception) for i in r]
        for r, f in zip(res, feeds):
            if isinstance(r, Exception):
                log.warning("Feed %s falhou: %s", f["nome"], r)
        if not todos:
            raise RuntimeError("Nenhuma notícia disponível")
        agora = datetime.now(timezone.utc).timestamp()
        todos.sort(key=lambda i: i["t"] or agora - 86400, reverse=True)
        return todos[:30]

    return await cache.obter("noticias", 600, buscar)
