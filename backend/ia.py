"""Gera insights a partir da transcrição recente usando um modelo local no Ollama."""
from __future__ import annotations

import asyncio
import json
import logging

import httpx

from .sala import Sala

log = logging.getLogger("ia")

SISTEMA = """Você é o assistente de um painel exibido numa sala de estar/escritório.
Você recebe a transcrição automática (pode conter erros) do que as pessoas estão falando no ambiente
e produz informações curtas e úteis para mostrar na tela, sempre em português do Brasil.

Responda em JSON com:
- "resumo": 1 ou 2 frases sobre o assunto atual da conversa (o trecho mais recente pesa mais).
- "topicos": até 5 palavras-chave curtas.
- "cards": até 4 cards. Cada card tem "tipo", "titulo" (até 6 palavras) e "texto" (até 30 palavras).
  Tipos:
  * "contexto": explica algo mencionado (lugar, pessoa, termo, obra, evento).
  * "curiosidade": um fato interessante relacionado ao assunto.
  * "tarefa": um compromisso, lembrete ou combinado que alguém mencionou.
  * "pergunta": responde de forma breve uma pergunta feita na conversa.

Regras: seja factual; se não tiver certeza de um fato, não o inclua. Não invente falas.
Não comente sobre as pessoas nem julgue a conversa. Se a transcrição não tiver conteúdo útil,
devolva resumo vazio e listas vazias."""

ESQUEMA = {
    "type": "object",
    "properties": {
        "resumo": {"type": "string"},
        "topicos": {"type": "array", "items": {"type": "string"}},
        "cards": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "tipo": {"type": "string", "enum": ["contexto", "curiosidade", "tarefa", "pergunta"]},
                    "titulo": {"type": "string"},
                    "texto": {"type": "string"},
                },
                "required": ["tipo", "titulo", "texto"],
            },
        },
    },
    "required": ["resumo", "topicos", "cards"],
}


def _limpar(dados: dict) -> dict:
    cards = []
    for c in (dados.get("cards") or [])[:4]:
        if isinstance(c, dict) and c.get("titulo") and c.get("texto"):
            tipo = c.get("tipo") if c.get("tipo") in ("contexto", "curiosidade", "tarefa", "pergunta") else "contexto"
            cards.append({"tipo": tipo, "titulo": str(c["titulo"])[:80], "texto": str(c["texto"])[:280]})
    return {
        "resumo": str(dados.get("resumo") or "")[:400],
        "topicos": [str(t)[:40] for t in (dados.get("topicos") or [])[:5] if t],
        "cards": cards,
    }


async def _verificar(cliente: httpx.AsyncClient, url: str, modelo: str) -> tuple[bool, str]:
    try:
        r = await cliente.get(f"{url}/api/tags", timeout=5)
        r.raise_for_status()
    except Exception:  # noqa: BLE001
        return False, f"Ollama não encontrado em {url}"
    nomes = {m.get("name", "") for m in r.json().get("models", [])}
    base = modelo if ":" in modelo else f"{modelo}:latest"
    if modelo not in nomes and base not in nomes:
        return False, f"Modelo ausente — rode: ollama pull {modelo}"
    return True, ""


async def executar(sala: Sala, cfg: dict) -> None:
    url = cfg["ollama_url"].rstrip("/")
    modelo = cfg["modelo"]
    intervalo = max(10, int(cfg["intervalo_segundos"]))
    janela = float(cfg["janela_minutos"])
    ultima_versao = -1

    async with httpx.AsyncClient(timeout=180) as cliente:
        while True:
            sala.podar()
            ok, detalhe = await _verificar(cliente, url, modelo)
            if not ok:
                sala.definir_ia("indisponivel", detalhe)
                await asyncio.sleep(15)
                continue
            if sala.ia in ("verificando", "indisponivel"):
                sala.definir_ia("pronta")

            versao, texto = sala.texto_recente(janela)
            if versao != ultima_versao and len(texto.split()) >= 12:
                sala.definir_ia("pensando")
                try:
                    r = await cliente.post(
                        f"{url}/api/chat",
                        json={
                            "model": modelo,
                            "stream": False,
                            "format": ESQUEMA,
                            "keep_alive": "30m",
                            "options": {"temperature": 0.3, "num_ctx": 4096},
                            "messages": [
                                {"role": "system", "content": SISTEMA},
                                {"role": "user", "content": "Transcrição (a mais recente por último):\n\n" + texto},
                            ],
                        },
                    )
                    r.raise_for_status()
                    dados = _limpar(json.loads(r.json()["message"]["content"]))
                    # só publica se ninguém pediu "esquecer" enquanto o modelo pensava
                    if sala.versao >= versao and sala.texto_recente(janela)[1]:
                        sala.definir_insights(dados)
                    ultima_versao = versao
                    sala.definir_ia("pronta")
                except Exception as e:  # noqa: BLE001
                    log.warning("Falha ao gerar insights: %s", e)
                    sala.definir_ia("indisponivel", f"Erro no modelo: {e}"[:160])
            await asyncio.sleep(intervalo)
