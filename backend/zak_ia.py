"""Cérebro do Zak: transforma conversa em cenas (modo ambiente) e pedidos em ações + resposta falada.

A IA nunca escreve a tela: ela só DESCREVE a cena em JSON, num vocabulário fixo de blocos.
Tudo o que volta do modelo é limpo aqui (tamanhos, tipos, campos) antes de ir para a tela.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime

import httpx

log = logging.getLogger("zak")

DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
TIPOS_IA = ["destaque", "numero", "fatos", "lista", "passos", "linha_tempo", "comparacao", "citacao"]

_ITEM = {"type": "object", "properties": {
    "texto": {"type": "string"}, "detalhe": {"type": "string"}, "quando": {"type": "string"},
    "feito": {"type": "boolean"}, "atual": {"type": "boolean"}, "rotulo": {"type": "string"}, "valor": {"type": "string"},
}}
_BLOCO = {"type": "object", "properties": {
    "tipo": {"type": "string", "enum": TIPOS_IA},
    **{c: {"type": "string"} for c in ("kicker", "titulo", "sub", "valor", "unidade", "rotulo", "detalhe", "texto", "autor")},
    "itens": {"type": "array", "items": _ITEM},
    "lados": {"type": "array", "items": {"type": "object", "properties": {
        "nome": {"type": "string"}, "valor": {"type": "string"}, "detalhe": {"type": "string"}}}},
}, "required": ["tipo"]}
_CENA = {"type": "object", "properties": {
    "foto": {"type": "string"}, "gerar": {"type": "string"}, "cor": {"type": "string"}, "lugar": {"type": "string"},
    "blocos": {"type": "array", "items": _BLOCO},
}, "required": ["blocos"]}

ESQUEMA_AMBIENTE = {"type": "object", "properties": {
    "mostrar": {"type": "boolean"}, "assunto": {"type": "string"}, "confianca": {"type": "number"},
    "sensivel": {"type": "boolean"}, "cena": _CENA,
}, "required": ["mostrar", "assunto", "confianca", "sensivel", "cena"]}

ACOES = ["responder", "timer", "lembrete", "cancelar_timer", "musica", "parar_musica", "volume",
         "limpar_tela", "parar_de_ouvir", "clima"]
ESQUEMA_PEDIDO = {"type": "object", "properties": {
    "acao": {"type": "string", "enum": ACOES},
    "segundos": {"type": "integer"}, "rotulo": {"type": "string"},
    "em_minutos": {"type": "integer"}, "horario": {"type": "string"}, "texto": {"type": "string"},
    "estilo": {"type": "string"}, "volume": {"type": "string", "enum": ["mais", "menos", ""]},
    "pesquisar": {"type": "string"},
    "fala": {"type": "string"}, "cena": _CENA,
}, "required": ["acao", "fala", "cena"]}

REGRAS_CENA = """Como descrever a CENA (a tela inteira é dela, uma TV 4K vista a uns 3 metros):
- "blocos": de 1 a 3. O primeiro é o principal: "destaque" (kicker: 1-3 palavras; titulo: 1-4 palavras; sub: até 12 palavras)
  ou "numero" (valor curto como "8.849", unidade, rotulo, detalhe de até 12 palavras).
  Os outros trazem informação útil e VERDADEIRA: "fatos" (2-4 itens {rotulo, valor} bem curtos), "lista" (titulo + 2-4 itens curtos),
  "passos" (itens), "linha_tempo" (itens {quando, texto, feito, atual}), "comparacao" (lados {nome, valor, detalhe}, 2 lados),
  "citacao" (texto, autor).
- Não repita a conversa: ACRESCENTE informação nova e útil sobre o assunto (o que um bom guia ou uma boa enciclopédia diria).
- Só fatos de que você tem certeza. Não invente números, datas nem nomes. Na dúvida, use menos blocos.
- "foto": SEMPRE preencha: 2-3 palavras-chave EM INGLÊS de algo concreto e fotografável que represente o assunto, como estaria
  no título de uma foto (ex.: "Lisbon tram", "espresso cup", "Mount Everest", "server room", "chess board", "hourglass").
  Para ideias abstratas, escolha um objeto ou lugar que as simbolize (prazo → "hourglass"; estratégia → "chess board").
- "gerar": SEMPRE preencha também (é a reserva se não houver foto boa): EM INGLÊS, uma imagem atmosférica e cinematográfica
  do assunto, sem texto, sem rostos (ex.: "glowing network of light threads in deep blue space, cinematic, soft bokeh").
- "cor": uma cor hex que combine com o assunto (ex.: "#e08a5f").
- "lugar": se o assunto é uma cidade, o nome da cidade (a tela acrescenta sozinha hora local e clima); senão "".
- Português do Brasil, textos curtos, sem emojis.

Exemplos de cena (siga exatamente este formato, com "tipo" em cada bloco):
{"foto": "Lisbon tram", "gerar": "yellow tram on a steep cobblestone street at golden hour, cinematic", "cor": "#e08a5f", "lugar": "Lisboa", "blocos": [
  {"tipo": "destaque", "kicker": "Portugal", "titulo": "Lisboa", "sub": "A capital das sete colinas e dos bondes amarelos"},
  {"tipo": "fatos", "itens": [{"rotulo": "Moeda", "valor": "Euro"}, {"rotulo": "Voo de SP", "valor": "≈ 10 h"}, {"rotulo": "Idioma", "valor": "Português"}]}]}
{"foto": "server room", "gerar": "glowing neural network of light threads in deep blue space, cinematic", "cor": "#5b7cff", "lugar": "", "blocos": [
  {"tipo": "destaque", "kicker": "Tecnologia", "titulo": "IA local", "sub": "Modelos que rodam na própria placa de vídeo, sem nuvem"},
  {"tipo": "lista", "titulo": "Bons usos", "itens": [{"texto": "Resumir reuniões"}, {"texto": "Buscar em documentos"}, {"texto": "Automatizar tarefas"}]}]}
{"foto": "Mount Everest", "gerar": "snowy Himalayan summit above the clouds at dawn, cinematic", "cor": "#4aa3ff", "lugar": "", "blocos": [
  {"tipo": "numero", "rotulo": "Monte Everest", "valor": "8.849", "unidade": "m", "detalhe": "O ponto mais alto da Terra"},
  {"tipo": "comparacao", "lados": [{"nome": "Everest", "valor": "8.849 m"}, {"nome": "Pico da Neblina", "valor": "2.995 m", "detalhe": "o mais alto do Brasil"}]}]}"""

AMBIENTE = """Você escolhe o que a tela de um escritório mostra, a partir da transcrição automática (pode ter erros)
do que as pessoas falam perto dela. A tela é bonita e discreta: ela ilustra o ASSUNTO, nunca repete as falas.

A tela deve ACOMPANHAR a conversa de perto: mudar sempre que o assunto muda. Olhe principalmente as ÚLTIMAS falas:
se o assunto mudou, ilustre o assunto NOVO (o antigo já passou).

Responda em JSON:
- "mostrar": true sempre que der para identificar um assunto, mesmo simples ou de trabalho (viagem, lugar, comida, clima,
  esporte, tecnologia, um projeto, uma reunião, um produto, um filme, um bicho, um hobby, um problema técnico...).
  false só para ruído, cumprimentos sem assunto ("bom dia", "tudo bem?") ou frases sem nenhum tema.
- "assunto": 2 a 5 palavras que identificam o tema (ex.: "viagem a Lisboa").
- "confianca": de 0 a 1, o quanto o assunto está claro nas últimas falas.
- "sensivel": true se o assunto for pessoal ou delicado (RH, salário, demissão, saúde, doença, vida amorosa, família,
  conflito entre colegas, política, religião, finanças pessoais, segredo da empresa).
- "cena": a cena (se "mostrar" for false, devolva {{"blocos": []}}).
Formato: {{"mostrar": true, "assunto": "...", "confianca": 0.8, "sensivel": false, "cena": {{...}}}}

{regras}
{protecao}"""

PROTECAO_ATIVA = """PROTEÇÃO DE INFORMAÇÃO ATIVA (a tela é vista por todo o escritório):
- Nunca escreva nomes de pessoas, falas, citações do que foi dito, nomes de clientes, valores de contratos ou números internos.
- Mostre o TEMA de forma genérica ("Viagem a Lisboa", e não "A viagem do Pedro"; "Lançamento do produto", e não o que fulano disse).
- Se o assunto for sensível: "mostrar" = false."""
PROTECAO_DESLIGADA = """A proteção de informação está desligada: pode listar pontos citados na conversa ("Vocês citaram"),
mas continue sem nomes de pessoas e sem assuntos sensíveis."""

PEDIDO = """Você é o Zak, o assistente de voz de um escritório. Personalidade: masculino, amigável, leve, direto e prestativo.
Alguém falou com você (a frase veio de reconhecimento de voz e pode ter pequenos erros).
Agora: {agora}. Cidade: {cidade}. {clima}

Responda em JSON:
- "acao": o que fazer.
  "responder" (pergunta ou conversa) · "timer" (segundos, rotulo) · "lembrete" (texto; se a pessoa disse um horário,
  horario "HH:MM" — ex.: "às 15h" → "15:00"; se disse "daqui a X minutos", em_minutos)
  · "cancelar_timer" · "musica" (estilo: gênero ou clima em poucas palavras, ex.: "lofi", "jazz", "bossa nova", "rock clássico")
  · "parar_musica" · "volume" ("mais" ou "menos") · "limpar_tela" · "parar_de_ouvir" (quando pedem para você parar de escutar)
  · "clima" (tempo ou hora AGORA em OUTRA cidade: "lugar" = nome da cidade; o sistema busca os dados reais e monta a fala).
- "fala": o que você diz em voz alta. UMA frase curta e natural (até ~20 palavras), em português do Brasil, sem emojis, sem listas,
  sem markdown, só com letras do nosso alfabeto (escreva palavras estrangeiras como se pronunciam). Confirme ações em poucas palavras ("Pronto, 10 minutos."). Em perguntas, responda direto.
- "cena": a tela que acompanha a resposta. Em perguntas, mostre a resposta de forma visual (o dado principal grande).
  Em ações simples (timer, música, volume, limpar), devolva {{"blocos": []}}: a tela dessas ações é automática.
- "pesquisar": se a resposta depende de um fato que você não sabe com certeza, ou que muda com o tempo (quem é o atual...,
  resultado recente), um termo para buscar na Wikipédia em português. Senão "".
Formato: {{"acao": "responder", "segundos": 0, "rotulo": "", "em_minutos": 0, "horario": "", "texto": "", "estilo": "",
"volume": "", "lugar": "", "pesquisar": "", "fala": "...", "cena": {{...}}}}
Se você não souber e não der para pesquisar, diga isso com simplicidade. Nunca invente.

{regras}"""

COM_PESQUISA = """Resultado da pesquisa na Wikipédia sobre "{termo}":
{trecho}

Use isso para responder. Se o trecho não responder à pergunta, diga que não encontrou."""

# palavras que, se aparecerem na cena gerada no modo ambiente com a proteção ativa, derrubam a cena
SENSIVEIS = re.compile(
    r"\b(sal[aá]rio|demiss|demitid|rescis|aumento de sal|promo[cç][aã]o d[eo] |advert[eê]ncia|processo trabalhista|rh\b|"
    r"recursos humanos|doen[cç]a|diagn[oó]stic|exame m[eé]dic|gravidez|gr[aá]vida|c[aâ]ncer|depress|ansiedade|terapia|"
    r"div[oó]rcio|namor|trai[cç][aã]o|briga|fofoca|pol[ií]tic|elei[cç]|partido|religi|igreja|d[ií]vida|empr[eé]stimo|"
    r"senha|confidencial|sigilo)",
    re.I,
)


def _sem_acento(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def _s(v, n: int) -> str:
    return " ".join(str(v or "").split())[:n]


def _normalizar_bloco(b) -> dict | None:
    """Modelos pequenos às vezes escrevem {"destaque": {...}} ou {"fatos": [...]} em vez de {"tipo": ...}."""
    if not isinstance(b, dict):
        return None
    if b.get("tipo") not in TIPOS_IA:
        chave = next((k for k in b if k in TIPOS_IA), None)
        if not chave:
            return None
        valor = b.pop(chave)
        b["tipo"] = chave
        if isinstance(valor, dict):
            b = {**valor, **b}
        elif isinstance(valor, list):
            b["lados" if chave == "comparacao" else "itens"] = valor
    if b["tipo"] == "fatos" and not b.get("itens") and b.get("rotulo") and (b.get("valor") or b.get("detalhe")):
        b["itens"] = [{"rotulo": b["rotulo"], "valor": b.get("valor") or b.get("detalhe")}]
    return b


def limpar_cena(cena: dict | None) -> dict:
    """Só o vocabulário conhecido, com tamanhos que cabem na tela."""
    cena = cena if isinstance(cena, dict) else {}
    brutos = [_normalizar_bloco(b) for b in (cena.get("blocos") or [])]
    # fatos soltos (um por bloco) viram um bloco só
    juntos: list[dict] = []
    for b in brutos:
        if b and b["tipo"] == "fatos" and juntos and juntos[-1]["tipo"] == "fatos":
            juntos[-1]["itens"] = list(juntos[-1].get("itens") or []) + list(b.get("itens") or [])
        elif b:
            juntos.append(b)
    blocos = []
    for b in juntos[:3]:
        if not isinstance(b, dict) or b.get("tipo") not in TIPOS_IA:
            continue
        t = b["tipo"]
        lb: dict = {"tipo": t}
        for campo, n in (("kicker", 40), ("titulo", 60), ("sub", 140), ("valor", 16), ("unidade", 12),
                         ("rotulo", 50), ("detalhe", 140), ("texto", 220), ("autor", 50)):
            if b.get(campo):
                lb[campo] = _s(b[campo], n)
        if t in ("fatos", "lista", "passos", "linha_tempo"):
            itens = []
            for i in (b.get("itens") or [])[:5]:
                if isinstance(i, str):
                    i = {"texto": i}
                if not isinstance(i, dict):
                    continue
                li = {k: _s(i[k], 60) for k in ("texto", "detalhe", "quando", "rotulo", "valor") if i.get(k)}
                li.update({k: bool(i[k]) for k in ("feito", "atual") if i.get(k)})
                if t == "fatos" and not (li.get("rotulo") and li.get("valor")):
                    continue
                if t != "fatos" and not li.get("texto"):
                    continue
                itens.append(li)
            if len(itens) < (2 if t in ("fatos", "lista") else 1):
                continue
            lb["itens"] = itens
        if t == "comparacao":
            lados = [{k: _s(l[k], 40) for k in ("nome", "valor", "detalhe") if l.get(k)}
                     for l in (b.get("lados") or [])[:3] if isinstance(l, dict) and l.get("nome") and l.get("valor")]
            if len(lados) < 2:
                continue
            lb["lados"] = lados
        if t == "destaque" and not lb.get("titulo"):
            continue
        if t == "numero" and not lb.get("valor"):
            continue
        if t == "citacao" and not lb.get("texto"):
            continue
        blocos.append(lb)
    # o primeiro bloco precisa ser um "principal"
    if blocos and blocos[0]["tipo"] not in ("destaque", "numero", "citacao"):
        principal = next((b for b in blocos if b["tipo"] in ("destaque", "numero")), None)
        if principal:
            blocos.remove(principal)
            blocos.insert(0, principal)
    cor = _s(cena.get("cor"), 7)
    return {
        "foto": _s(cena.get("foto"), 80),
        "gerar": _s(cena.get("gerar"), 300),
        "cor": cor if re.fullmatch(r"#[0-9a-fA-F]{6}", cor) else "",
        "lugar": _s(cena.get("lugar"), 60),
        "blocos": blocos,
    }


def texto_da_cena(cena: dict) -> str:
    partes = []
    for b in cena.get("blocos", []):
        partes += [str(v) for k, v in b.items() if isinstance(v, str) and k != "tipo"]
        for i in b.get("itens", []) + b.get("lados", []):
            partes += [str(v) for v in i.values() if isinstance(v, str)]
    return " ".join(partes)


# no texto da cena, só o que é pessoal de verdade: uma cena sobre Lisboa pode citar uma igreja ou um partido histórico
PESSOAIS = re.compile(
    r"\b(sal[aá]rio|demiss|demitid|rescis|advert[eê]ncia|processo trabalhista|doen[cç]a|diagn[oó]stic|exame m[eé]dic|"
    r"gravidez|gr[aá]vida|c[aâ]ncer|depress|div[oó]rcio|namor|trai[cç][aã]o|fofoca|senha|confidencial|sigilo)",
    re.I,
)


def sensivel(texto: str, padrao: re.Pattern = SENSIVEIS) -> bool:
    return bool(padrao.search(texto) or padrao.search(_sem_acento(texto)))


class Cerebro:
    def __init__(self, cfg_ia: dict) -> None:
        self.url = cfg_ia["ollama_url"].rstrip("/")
        self._sem_pensar: dict[str, bool] = {}   # modelo aceita "think": false?

    async def _chat(self, http: httpx.AsyncClient, modelo: str, sistema: str, usuario: str, esquema: dict,
                    temperatura: float = 0.4) -> dict:
        # "json" livre (com exemplo no prompt) é ~2x mais rápido que forçar o esquema, e o resultado é limpo aqui
        corpo = {
            "model": modelo, "stream": False, "format": "json", "keep_alive": "30m",
            "options": {"temperature": temperatura, "num_ctx": 4096},   # igual ao ia.py: trocar o contexto recarrega o modelo
            "messages": [{"role": "system", "content": sistema}, {"role": "user", "content": usuario}],
        }
        if self._sem_pensar.get(modelo, True):
            corpo["think"] = False   # modelos que "pensam" (qwen3...) respondem bem mais rápido sem isso
        r = await http.post(f"{self.url}/api/chat", json=corpo, timeout=300)
        if r.status_code == 400 and "think" in r.text.lower() and "think" in corpo:
            self._sem_pensar[modelo] = False
            corpo.pop("think")
            r = await http.post(f"{self.url}/api/chat", json=corpo, timeout=300)
        r.raise_for_status()
        conteudo = r.json()["message"]["content"]
        conteudo = re.sub(r"^\s*<think>.*?</think>", "", conteudo, flags=re.S)
        return json.loads(conteudo)

    async def ambiente(self, http: httpx.AsyncClient, modelo: str, transcricao: str, protecao: bool,
                       assunto: str = "", mostrado: str = "") -> dict | None:
        sistema = AMBIENTE.format(regras=REGRAS_CENA, protecao=PROTECAO_ATIVA if protecao else PROTECAO_DESLIGADA)
        extra = ""
        if mostrado:
            extra = (f"\n\nA tela já mostra: {mostrado}.\nSe as últimas falas continuam nesse assunto, repita o mesmo "
                     '"assunto", mas monte a cena com OUTRO ângulo dele (outros blocos, outros fatos, outra "foto"). '
                     "Se o assunto mudou, ilustre o novo.")
        elif assunto:
            extra = f'\n\nAssunto mostrado antes: "{assunto}". Se o assunto mudou, ilustre o novo.'
        dados = await self._chat(http, modelo, sistema, "Transcrição (a mais recente por último):\n\n" + transcricao + extra,
                                 ESQUEMA_AMBIENTE, 0.3)
        cena = limpar_cena(dados.get("cena"))
        r = {
            "mostrar": bool(dados.get("mostrar")) and bool(cena["blocos"]),
            "assunto": _s(dados.get("assunto"), 60),
            "confianca": max(0.0, min(1.0, float(dados.get("confianca") or 0))),
            "sensivel": bool(dados.get("sensivel")),
            "cena": cena,
        }
        if r["sensivel"] or (protecao and (sensivel(r["assunto"]) or sensivel(texto_da_cena(cena), PESSOAIS))):
            r["mostrar"] = False
            r["sensivel"] = True
        return r

    async def pedido(self, http: httpx.AsyncClient, modelo: str, frase: str, cidade: str, clima: str,
                     pesquisa: tuple[str, str] | None = None) -> dict:
        d = datetime.now()
        agora = f"{DIAS[d.weekday()]}, {d:%d/%m/%Y}, {d:%H:%M}"
        sistema = PEDIDO.format(agora=agora, cidade=cidade, clima=clima, regras=REGRAS_CENA)
        usuario = f'Frase dita para você: "{frase}"'
        if pesquisa:
            usuario += "\n\n" + COM_PESQUISA.format(termo=pesquisa[0], trecho=pesquisa[1])
        dados = await self._chat(http, modelo, sistema, usuario, ESQUEMA_PEDIDO, 0.4)
        acao = dados.get("acao") if dados.get("acao") in ACOES else "responder"
        return {
            "acao": acao,
            "segundos": max(0, min(24 * 3600, int(dados.get("segundos") or 0))),
            "rotulo": _s(dados.get("rotulo"), 30),
            "em_minutos": max(0, min(7 * 24 * 60, int(dados.get("em_minutos") or 0))),
            "horario": _s(dados.get("horario"), 5),
            "texto": _s(dados.get("texto"), 120),
            "estilo": _s(dados.get("estilo"), 40),
            "lugar": _s(dados.get("lugar") or (dados.get("cena") or {}).get("lugar"), 60),
            "volume": dados.get("volume") if dados.get("volume") in ("mais", "menos") else "",
            "pesquisar": "" if pesquisa else _s(dados.get("pesquisar"), 80),
            "fala": _s(re.sub(r"[*_#`]", "", str(dados.get("fala") or "")), 300),
            "cena": limpar_cena(dados.get("cena")),
        }
