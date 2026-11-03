"""Catálogo de modelos (Whisper e Ollama) e preferências escolhidas na tela.

As escolhas feitas no painel de Ajustes ficam em `preferencias.json` (na raiz do projeto)
e têm prioridade sobre o config.toml.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path

import httpx

from .config import RAIZ

log = logging.getLogger("modelos")
ARQUIVO = RAIZ / "preferencias.json"

# Tamanho aproximado do download e uma descrição curta para a tela.
WHISPER = [
    {"nome": "tiny", "tamanho": "75 MB", "descricao": "Muito rápido, erra bastante. Só para PCs fracos."},
    {"nome": "base", "tamanho": "145 MB", "descricao": "Rápido, ainda impreciso em português."},
    {"nome": "small", "tamanho": "480 MB", "descricao": "Bom na CPU; perde palavras em conversas naturais."},
    {"nome": "medium", "tamanho": "1,5 GB", "descricao": "Preciso, porém lento sem GPU."},
    {"nome": "large-v3-turbo", "tamanho": "1,6 GB", "descricao": "Quase a precisão do large-v3, várias vezes mais rápido. Ideal com GPU.", "recomendado": True},
    {"nome": "large-v3", "tamanho": "3,1 GB", "descricao": "O mais preciso. Pesado: usa ~4 GB de VRAM."},
]
NOMES_WHISPER = {m["nome"] for m in WHISPER}


def ler() -> dict:
    try:
        return json.loads(ARQUIVO.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except Exception as e:  # noqa: BLE001
        log.warning("preferencias.json inválido (%s); ignorando", e)
        return {}


def gravar(**valores) -> None:
    dados = ler() | valores
    tmp = ARQUIVO.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, ARQUIVO)


def whisper_baixado(nome: str) -> bool:
    """O modelo já está no cache do Hugging Face (não precisa baixar)?"""
    try:
        from faster_whisper.utils import _MODELS
        from huggingface_hub.constants import HF_HUB_CACHE
    except Exception:  # noqa: BLE001
        return False
    repo = _MODELS.get(nome)
    if not repo:
        return False
    pasta = Path(HF_HUB_CACHE) / ("models--" + repo.replace("/", "--")) / "snapshots"
    return any(p.joinpath("model.bin").exists() for p in pasta.glob("*")) if pasta.exists() else False


def catalogo_whisper() -> list[dict]:
    return [m | {"baixado": whisper_baixado(m["nome"])} for m in WHISPER]


def _tamanho(b: int) -> str:
    return f"{b / 1e9:.1f} GB".replace(".", ",") if b >= 1e9 else f"{b / 1e6:.0f} MB"


async def listar_ollama(cliente: httpx.AsyncClient, url: str) -> dict:
    url = url.rstrip("/")
    try:
        r = await cliente.get(f"{url}/api/tags", timeout=5)
        r.raise_for_status()
    except Exception:  # noqa: BLE001
        return {"ok": False, "erro": f"Ollama não encontrado em {url}. Ele está aberto?", "modelos": []}
    modelos = []
    for m in r.json().get("models", []):
        det = m.get("details") or {}
        familia = det.get("family") or ""
        familias = det.get("families") or []
        nome = m.get("name") or m.get("model") or ""
        # modelos de embedding não conversam; aparecem na lista, mas marcados
        embedding = "embed" in nome.lower() or any("bert" in f for f in [familia, *familias])
        modelos.append({
            "nome": nome,
            "tamanho": _tamanho(int(m.get("size") or 0)),
            "parametros": det.get("parameter_size") or "",
            "quantizacao": det.get("quantization_level") or "",
            "familia": familia,
            "embedding": embedding,
        })
    modelos.sort(key=lambda m: (m["embedding"], m["nome"]))
    return {"ok": True, "erro": "", "modelos": modelos}
