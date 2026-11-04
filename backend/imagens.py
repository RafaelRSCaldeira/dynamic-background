"""Imagens bonitas para as cenas do Zak.

Busca fotos livres no Wikimedia Commons, descarta as que ficariam feias na tela
(fundo branco chapado, mapa, diagrama, logo, resolução baixa, escura ou estourada demais),
guarda a melhor em 4K no cache local e tira dela a paleta que tinge a cena inteira.
"""
from __future__ import annotations

import asyncio
import colorsys
import hashlib
import html
import io
import json
import logging
import re
import time
from pathlib import Path

import httpx
import numpy as np
from PIL import Image

from .config import RAIZ

log = logging.getLogger("imagens")
CACHE = RAIZ / "cache" / "imagens"
COMMONS = "https://commons.wikimedia.org/w/api.php"
LARGURA = 3840            # a tela é 4K: a foto já vem no tamanho dela
MIN_LARGURA, MIN_ALTURA = 1920, 1000   # a foto aparece suavizada por máscara e movimento: Full HD já fica bonita
SEM_RESULTADO_S = 24 * 3600
# a política do Wikimedia exige um User-Agent com contato (a página do projeto)
UA = {"User-Agent": "PainelAmbiente/1.0 (https://github.com/RafaelRSCaldeira/dynamic-background)"}

# títulos que quase sempre são imagens ruins para fundo de cena
RUINS = re.compile(
    r"\b(map|mapa|karte|carte|logo|diagram|diagrama|flag|bandeira|coat[ _]of[ _]arms|bras[aã]o|chart|"
    r"gr[aá]fico|floor[ _]?plan|planta|icon|[ií]cone|seal|selo|document|documento|scan|page|p[aá]gina|"
    r"signature|assinatura|stamp|selo|poster|cartaz|screenshot|captura|infographic|location|localiza)",
    re.I,
)

_travas: dict[str, asyncio.Lock] = {}


def _chave(consulta: str) -> str:
    # "v2": a busca passou a exigir relevância; as escolhas antigas (às vezes sem relação com o assunto) são ignoradas
    return hashlib.sha1(("v2|" + consulta.strip().lower()).encode()).hexdigest()[:16]


def _limpar_html(s: str | None) -> str:
    s = re.sub(r"<[^>]+>", "", s or "")
    return re.sub(r"\s+", " ", html.unescape(s)).strip()


# ── qualidade ───────────────────────────────────────────────
def avaliar(img: Image.Image) -> tuple[float, list[str]]:
    """Nota de 'beleza para fundo de cena' (maior = melhor) e os motivos de recusa."""
    w, h = img.size
    a = np.asarray(img.convert("RGB").resize((256, max(1, round(256 * h / w)))), dtype=np.float32) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    mx, mn = a.max(2), a.min(2)
    sat = (mx - mn) / (mx + 1e-6)

    b = max(3, int(min(lum.shape) * 0.06))
    borda_l = np.concatenate([lum[:b].ravel(), lum[-b:].ravel(), lum[:, :b].ravel(), lum[:, -b:].ravel()])
    borda_s = np.concatenate([sat[:b].ravel(), sat[-b:].ravel(), sat[:, :b].ravel(), sat[:, -b:].ravel()])
    branco = float(np.mean((borda_l > 0.86) & (borda_s < 0.12)))

    g = np.abs(np.diff(lum, axis=1))[:-1] + np.abs(np.diff(lum, axis=0))[:, :-1]
    chapado = float(np.mean(g < 0.003))
    lap = lum[1:-1, 1:-1] * 4 - lum[:-2, 1:-1] - lum[2:, 1:-1] - lum[1:-1, :-2] - lum[1:-1, 2:]
    nitidez = float(lap.var() * 1000)
    rg, yb = a[..., 0] - a[..., 1], (a[..., 0] + a[..., 1]) / 2 - a[..., 2]
    cor = float(np.hypot(rg.std(), yb.std()) + 0.3 * np.hypot(rg.mean(), yb.mean()))
    media = float(lum.mean())

    motivos = []
    if branco > 0.25:
        motivos.append("fundo branco")
    if chapado > 0.5:
        motivos.append("chapada (ilustração/mapa)")
    if media > 0.74:
        motivos.append("clara demais")
    if media < 0.07:
        motivos.append("escura demais")
    if nitidez < 0.6:
        motivos.append("sem nitidez")
    if cor < 0.04:
        motivos.append("sem cor")
    nota = cor * 3 + min(nitidez, 8) * 0.08 - chapado - branco * 2 - abs(media - 0.38)
    return nota, motivos


# ── paleta ──────────────────────────────────────────────────
def _hex(rgb) -> str:
    return "#" + "".join(f"{round(max(0, min(1, v)) * 255):02x}" for v in rgb)


def paleta(img: Image.Image) -> list[str]:
    """4 cores (escura → viva) no mesmo formato das paletas do fundo animado."""
    a = np.asarray(img.convert("RGB").resize((64, 36)), dtype=np.float32).reshape(-1, 3) / 255
    lum = a @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    k = 6
    centros = a[np.argsort(lum)[np.linspace(0, len(a) - 1, k).astype(int)]].copy()
    for _ in range(10):
        rotulo = np.argmin(((a[:, None] - centros[None]) ** 2).sum(2), 1)
        for i in range(k):
            if np.any(rotulo == i):
                centros[i] = a[rotulo == i].mean(0)
    peso = np.bincount(rotulo, minlength=k) / len(a)
    hsv = [colorsys.rgb_to_hsv(*c) for c in centros]
    # tom de fundo: o mais presente entre os escuros/médios; acento: o mais vivo e presente
    fundo = max(range(k), key=lambda i: peso[i] * (1.2 - hsv[i][2]) * (0.3 + hsv[i][1]))
    acento = max(range(k), key=lambda i: peso[i] ** 0.5 * hsv[i][1] ** 1.5 * (0.4 + hsv[i][2]))
    hf, sf, _ = hsv[fundo]
    ha, sa, _ = hsv[acento]
    if sa < 0.15:          # foto quase sem cor: herda o tom do fundo
        ha, sa = hf, max(sf, 0.25)
    dh = ((ha - hf + 0.5) % 1) - 0.5
    meio = (hf + dh * 0.5) % 1
    cores = [
        colorsys.hsv_to_rgb(hf, min(0.75, sf * 0.9 + 0.1), 0.055),
        colorsys.hsv_to_rgb(hf, min(0.8, sf * 0.9 + 0.15), 0.22),
        colorsys.hsv_to_rgb(meio, min(0.75, (sf + sa) / 2 + 0.1), 0.42),
        colorsys.hsv_to_rgb(ha, min(0.8, max(0.42, sa)), 0.8),
    ]
    return [_hex(c) for c in cores]


def brilho(img: Image.Image) -> float:
    """Luminância média (0–1): fotos claras recebem um véu mais escuro para o texto continuar legível."""
    a = np.asarray(img.convert("L").resize((64, 36)), dtype=np.float32) / 255
    return round(float(a.mean()), 3)


# ── busca ───────────────────────────────────────────────────
# primeiro só entre as fotos que a comunidade do Commons já avaliou como de qualidade/destaque
CURADAS = "incategory:Featured_pictures_on_Wikimedia_Commons|Quality_images|Valued_images_sorted_by_promotion_date"
OPENVERSE = "https://api.openverse.org/v1/images/"
_VAZIAS = {"the", "and", "with", "for", "from", "of", "in", "on", "at", "a", "an", "to", "photo", "image", "picture",
           "cinematic", "beautiful", "view"}


def _palavras(s: str) -> list[str]:
    import unicodedata
    s = "".join(c for c in unicodedata.normalize("NFD", s.lower()) if unicodedata.category(c) != "Mn")
    return [w for w in re.findall(r"[a-z0-9]+", s) if len(w) > 2 and w not in _VAZIAS]


def relevancia(consulta: str, titulo: str) -> float:
    """Fração das palavras da consulta que aparecem no título da foto (comparando o começo das palavras:
    "trams" casa com "tram"). Fotos de destaque sem relação com o assunto ficavam no topo da busca."""
    q = _palavras(consulta)
    if not q:
        return 0.0
    t = _palavras(titulo.removeprefix("File:"))
    achou = sum(any(w[:5] == x[:5] for x in t) for w in q)
    return achou / len(q)


async def _candidatos(http: httpx.AsyncClient, consulta: str) -> list[dict]:
    curadas, gerais, abertas = await asyncio.gather(
        _pesquisar(http, f"{consulta} {CURADAS}"), _pesquisar(http, consulta), _openverse(http, consulta),
        return_exceptions=True)
    todas, vistos = [], set()
    for lote, curada in ((curadas, True), (abertas, False), (gerais, False)):
        if isinstance(lote, Exception):
            log.info("busca de foto %r: %s", consulta, lote)
            continue
        for c in lote:
            chave = c["original"].rsplit("/", 1)[-1].lower()
            if chave in vistos:
                continue
            vistos.add(chave)
            c["relevancia"] = relevancia(consulta, c["titulo"])
            c["curada"] = curada
            todas.append(c)
    # só fotos que são DO assunto; as curadas e as mais relevantes primeiro
    relevantes = [c for c in todas if c["relevancia"] >= 0.5 or (c["relevancia"] > 0 and len(_palavras(consulta)) > 2)]
    relevantes.sort(key=lambda c: (-c["relevancia"], not c["curada"]))
    return relevantes


_openverse_pausa = 0.0


async def _openverse(http: httpx.AsyncClient, termos: str) -> list[dict]:
    """Openverse: fotos com licença aberta (Flickr, Commons e outras), sem chave. Bom para assuntos abstratos.
    Sem chave, o limite de pedidos é baixo: quando ele recusa (429/401), a fonte descansa um tempo."""
    global _openverse_pausa
    if time.time() < _openverse_pausa:
        return []
    r = await http.get(OPENVERSE, headers=UA, timeout=12, params={
        "q": termos, "page_size": 30, "aspect_ratio": "wide", "size": "large", "mature": "false",
        "license_type": "all", "extension": "jpg"})
    if r.status_code in (401, 403, 429):
        _openverse_pausa = time.time() + 15 * 60
        log.info("Openverse recusou (%s): pausado por 15 min, seguindo só com o Wikimedia Commons", r.status_code)
        return []
    r.raise_for_status()
    bons = []
    for p in r.json().get("results", []):
        w, h = int(p.get("width") or 0), int(p.get("height") or 0)
        if w < MIN_LARGURA or h < MIN_ALTURA or not 1.25 <= w / h <= 2.6:
            continue
        if not p.get("url") or RUINS.search(p.get("title") or "") or (p.get("filesize") or 0) > 25_000_000:
            continue
        licenca = f"CC {p.get('license', '').upper()} {p.get('license_version', '')}".strip()
        bons.append({
            "titulo": p.get("title") or "", "w": w, "h": h, "miniatura": p.get("thumbnail"), "original": p["url"],
            "pagina": p.get("foreign_landing_url"), "autor": (p.get("creator") or "")[:80],
            "licenca": "Domínio público" if p.get("license") in ("cc0", "pdm") else licenca, "fonte": "Openverse",
        })
    return bons


async def _pesquisar(http: httpx.AsyncClient, termos: str) -> list[dict]:
    r = await http.get(COMMONS, headers=UA, params={
        "action": "query", "format": "json", "formatversion": 2,
        "generator": "search", "gsrsearch": f"{termos} filetype:bitmap", "gsrnamespace": 6, "gsrlimit": 40,
        "prop": "imageinfo", "iiprop": "url|size|mime|extmetadata", "iiurlwidth": 500,
        "iiextmetadatafilter": "Artist|LicenseShortName|ObjectName",
    })
    r.raise_for_status()
    paginas = sorted(r.json().get("query", {}).get("pages", []), key=lambda p: p.get("index", 99))
    bons = []
    for p in paginas:
        info = (p.get("imageinfo") or [{}])[0]
        w, h = info.get("width", 0), info.get("height", 0)
        if info.get("mime") != "image/jpeg" or w < MIN_LARGURA or h < MIN_ALTURA:
            continue
        if not 1.25 <= w / h <= 2.6 or RUINS.search(p.get("title", "")):
            continue
        meta = info.get("extmetadata", {})
        bons.append({
            "titulo": p["title"], "w": w, "h": h, "miniatura": info.get("thumburl"), "original": info["url"],
            "pagina": info.get("descriptionurl"),
            "autor": _limpar_html(meta.get("Artist", {}).get("value"))[:80],
            "licenca": _limpar_html(meta.get("LicenseShortName", {}).get("value")),
        })
    return bons


async def _baixar(http: httpx.AsyncClient, url: str) -> Image.Image:
    r = await http.get(url, headers=UA, follow_redirects=True, timeout=30)
    r.raise_for_status()
    img = Image.open(io.BytesIO(r.content))
    img.load()
    return img


async def buscar(http: httpx.AsyncClient, consulta: str) -> dict | None:
    """Melhor imagem para a consulta, já no cache local. None se nada for bonito o bastante."""
    consulta = consulta.strip()[:120]
    if not consulta:
        return None
    chave = _chave(consulta)
    CACHE.mkdir(parents=True, exist_ok=True)
    meta_arq = CACHE / f"{chave}.json"
    async with _travas.setdefault(chave, asyncio.Lock()):
        if meta_arq.exists():
            meta = json.loads(meta_arq.read_text(encoding="utf-8"))
            if meta.get("arquivo") and (CACHE / meta["arquivo"]).exists():
                if "brilho" not in meta:   # cache de uma versão anterior
                    meta["brilho"] = brilho(Image.open(CACHE / meta["arquivo"]))
                return meta
            if not meta.get("arquivo") and time.time() - meta.get("t", 0) < SEM_RESULTADO_S:
                return None

        t0 = time.perf_counter()
        candidatos = (await _candidatos(http, consulta))[:10]
        notas = []
        miniaturas = await asyncio.gather(*(_baixar(http, c["miniatura"]) for c in candidatos), return_exceptions=True)
        for c, mini in zip(candidatos, miniaturas):
            if isinstance(mini, Exception):
                continue
            nota, motivos = avaliar(mini)
            if motivos:
                log.debug("descartada %s: %s", c["titulo"], ", ".join(motivos))
                continue
            notas.append((nota + c["relevancia"] * 1.5 + (0.3 if c["curada"] else 0), c))
        if not notas:
            meta_arq.write_text(json.dumps({"consulta": consulta, "t": time.time()}), encoding="utf-8")
            log.info("sem imagem boa para %r (%d candidatas)", consulta, len(candidatos))
            return None

        _, melhor = max(notas, key=lambda n: n[0])
        url = melhor["original"]
        if melhor["w"] > LARGURA and re.search(r"/\d+px-", melhor["miniatura"] or ""):   # Commons: miniatura em 4K
            url = re.sub(r"/\d+px-", f"/{LARGURA}px-", melhor["miniatura"])
        img = await _baixar(http, url)
        img = img.convert("RGB")
        if img.width > LARGURA:
            img = img.resize((LARGURA, round(LARGURA * img.height / img.width)), Image.LANCZOS)
        arquivo = f"{chave}.jpg"
        await asyncio.to_thread(img.save, CACHE / arquivo, "JPEG", quality=88, optimize=True, progressive=True)
        meta = {
            "consulta": consulta, "t": time.time(), "arquivo": arquivo,
            "url": f"/api/imagem/arquivo/{arquivo}", "w": img.width, "h": img.height,
            "paleta": paleta(img), "brilho": brilho(img), "titulo": melhor["titulo"].removeprefix("File:").rsplit(".", 1)[0],
            "autor": melhor["autor"], "licenca": melhor["licenca"], "pagina": melhor["pagina"],
            "fonte": melhor.get("fonte", "Wikimedia Commons"),
        }
        meta_arq.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        log.info("imagem para %r: %s (%.1fs, %d/%d aprovadas)", consulta, meta["titulo"][:60],
                 time.perf_counter() - t0, len(notas), len(candidatos))
        return meta


def arquivo(nome: str) -> Path | None:
    if not re.fullmatch(r"[0-9a-f]{16}\.jpg", nome):
        return None
    p = CACHE / nome
    return p if p.exists() else None
