"""Carrega o config.toml e completa com os valores padrão."""
from __future__ import annotations

import copy
import tomllib
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
FRONTEND = RAIZ / "frontend"

PADRAO: dict = {
    "servidor": {"porta": 8765, "rede_local": False},
    "local": {"cidade": "São Paulo", "pais": "BR", "latitude": None, "longitude": None},
    "widgets": {
        "moedas": ["USD-BRL", "EUR-BRL", "BTC-BRL"],
        "feeds": [{"nome": "g1", "url": "https://g1.globo.com/rss/g1/"}],
    },
    "tela": {"fps_max": 60, "qualidade_fundo": 0.5},
    "camera": {"ativada": True, "ociosidade_minutos": 5, "distancia_gestos": 2.0, "campo_visao": 65},
    "audio": {
        "ativado": True,
        "iniciar_mutado": False,
        "microfone": "",
        "modelo_whisper": "auto",
        "dispositivo_whisper": "auto",
        "idioma": "pt",
        "ganho_db": 0.0,
        "retencao_minutos": 10,
        "mute_automatico": True,
        "sensibilidade": 1.0,
    },
    "zak": {
        "ativado": False,
        "protecao": True,          # proteção de informação (também liga/desliga em Ajustes)
        "ambiente_segundos": 20,   # a cada quanto tempo o modo ambiente olha a conversa
        "voz_motor": "kokoro",     # kokoro | nenhum
        "voz": "pm_alex",          # voz masculina pt-BR do Kokoro
        "voz_velocidade": 1.0,
        "imagem_modelo": "auto",   # auto | nenhum | id de um modelo do Hugging Face (diffusers)
    },
    "ia": {
        "ollama_url": "http://localhost:11434",
        "modelo": "gemma3:4b",
        "intervalo_segundos": 40,
        "janela_minutos": 6,
    },
}


def _mesclar(base: dict, extra: dict) -> dict:
    for chave, valor in extra.items():
        if isinstance(valor, dict) and isinstance(base.get(chave), dict):
            _mesclar(base[chave], valor)
        else:
            base[chave] = valor
    return base


def carregar() -> dict:
    cfg = copy.deepcopy(PADRAO)
    arquivo = RAIZ / "config.toml"
    if arquivo.exists():
        _mesclar(cfg, tomllib.loads(arquivo.read_text(encoding="utf-8")))
    return cfg


CONFIG = carregar()
