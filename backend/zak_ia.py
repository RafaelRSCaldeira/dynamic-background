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
# só nas telas de resposta longa (formato "painel"): várias seções, quantas forem necessárias
TIPOS_PAINEL = ["carrossel", "tabela", "texto", "barras"]

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
         "limpar_tela", "parar_de_ouvir", "clima", "galeria", "ignorar"]
ESQUEMA_PEDIDO = {"type": "object", "properties": {
    "acao": {"type": "string", "enum": ACOES},
    "segundos": {"type": "integer"}, "rotulo": {"type": "string"},
    "em_minutos": {"type": "integer"}, "horario": {"type": "string"}, "texto": {"type": "string"},
    "estilo": {"type": "string"}, "volume": {"type": "string", "enum": ["mais", "menos", ""]},
    "pesquisar": {"type": "string"}, "detalhar": {"type": "boolean"},
    "imagens": {"type": "array", "items": {"type": "string"}}, "gerar": {"type": "boolean"},
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
  · "clima" (tempo ou hora AGORA em OUTRA cidade: "lugar" = nome da cidade; o sistema busca os dados reais e monta a fala)
  · "galeria" (a pessoa quer VER imagens: "fica passando fotos de paisagens", "mostra imagens de praias", "põe umas fotos
  bonitas", "gera uma imagem de um dragão", "cria uma imagem de..."). A tela mostra só as imagens, em tela cheia, sem texto.
  "gerar": true SÓ se a pessoa disse gerar/criar/desenhar/imaginar; senão false (fotos reais).
  "imagens": com "gerar" false, 4 a 6 termos CURTOS (2-3 palavras) EM INGLÊS, variados dentro do tema, de coisas
  fotografáveis (paisagens → "mountain lake", "desert dunes", "misty forest", "fjord", "waterfall", "rice terraces").
  Com "gerar" true, 3 a 4 descrições EM INGLÊS da imagem pedida, detalhadas e cinematográficas (variações da mesma ideia).
  Na galeria, "cena" = {{"blocos": []}} e a "fala" só confirma o pedido em poucas palavras.
- "fala": o que você diz em voz alta. UMA frase curta e natural (até ~20 palavras), em português do Brasil, sem emojis, sem listas,
  sem markdown, só com letras do nosso alfabeto (escreva palavras estrangeiras como se pronunciam). Confirme ações em poucas palavras ("Pronto, 10 minutos."). Em perguntas, responda direto.
- "cena": a tela que acompanha a resposta. Em perguntas, mostre a resposta de forma visual (o dado principal grande).
  Em ações simples (timer, música, volume, limpar), devolva {{"blocos": []}}: a tela dessas ações é automática.
- "detalhar": true se a pergunta pede uma resposta LONGA ou com várias partes: explicar como algo funciona, a história
  de algo, comparar várias coisas, listar vários itens ("quais são os planetas", "me dá ideias de..."), roteiro de viagem,
  plano, passo a passo, prós e contras, resumo de um tema. Aí a tela vira um painel completo (montado depois) e a sua
  "fala" já RESPONDE em resumo, em uma ou duas frases (ex.: "A usina usa a força da água para girar turbinas que movem
  geradores. Pus os detalhes na tela."), nunca só "vou explicar". false para perguntas de um dado só (altura, capital, data).
- "pesquisar": se a resposta depende de um fato que você não sabe com certeza, ou que muda com o tempo (quem é o atual...,
  resultado recente), um termo para buscar na Wikipédia em português. Senão "".
Formato: {{"acao": "responder", "segundos": 0, "rotulo": "", "em_minutos": 0, "horario": "", "texto": "", "estilo": "",
"volume": "", "lugar": "", "pesquisar": "", "detalhar": false, "imagens": [], "gerar": false, "fala": "...", "cena": {{...}}}}
Se você não souber e não der para pesquisar, diga isso com simplicidade. Nunca invente.

{regras}"""

CONVERSA = """Conversa recente com você (a mais antiga primeiro). A frase nova pode continuar essa conversa:
"e a do K2?" depois de perguntarem a altura do Everest quer dizer "qual a altura do K2?". Use o contexto.
{turnos}"""

SEGUIMENTO = """ATENÇÃO: desta vez a pessoa NÃO disse "Ei, Zak". A frase foi captada logo depois da sua última resposta,
num escritório com várias pessoas conversando. Decida primeiro: ela é PARA VOCÊ?
- É para você: continua o assunto da conversa com você ("e a do K2?", "quanto tempo leva pra subir?", "mostra uma foto"),
  ou é claramente uma pergunta ou um pedido a um assistente ("qual a capital da Austrália?", "coloca um timer").
- NÃO é para você: comentário entre colegas, notícia do escritório, convite, fofoca, desabafo, assunto pessoal,
  algo dirigido a outra pessoa ("alguém quer café?", "o estacionamento vai fechar amanhã", "o João já mandou o relatório?",
  "hoje o almoço é no japonês"). Nesses casos responda só {"acao": "ignorar", "fala": "", "cena": {"blocos": []}}.
Responder a quem não falou com você é intrometido: na dúvida entre um comentário solto e uma pergunta, ignore."""

COM_PESQUISA = """Resultado da pesquisa na Wikipédia sobre "{termo}":
{trecho}

Use isso para responder. Se o trecho não responder à pergunta, diga que não encontrou."""

PAINEL = """Você monta a tela de uma resposta completa do Zak, o assistente de voz de um escritório. A tela é uma TV 4K vista
a uns 3 metros: ela é a resposta inteira, organizada para ser lida de longe. Português do Brasil, sem emojis.
Agora: {agora}.

Responda em JSON: {{"foto": "...", "cor": "#hex", "blocos": [...]}}
- "foto": 2-3 palavras EM INGLÊS de algo concreto e fotografável do tema (vira o fundo). "cor": hex que combine.
- "blocos": de 3 a 8 seções, QUANTAS FOREM NECESSÁRIAS para responder bem (sem enrolar). O primeiro é sempre
  {{"tipo": "destaque", "kicker": "1-3 palavras", "titulo": "1-5 palavras", "sub": "a resposta em uma frase, até 20 palavras"}}.
  Depois, escolha os formatos que melhor mostram cada parte:
  · "carrossel": vários itens do mesmo tipo, que passam sozinhos na tela (planetas, cidades de um roteiro, ideias, tipos de algo,
    etapas de uma história). {{"tipo": "carrossel", "titulo": "...", "itens": [{{"titulo": "1-4 palavras", "valor": "dado curto opcional",
    "texto": "até 22 palavras", "foto": "..."}}]}} — de 3 a 8 itens. "foto": o nome do item EM INGLÊS como estaria no título
    de uma foto ("Belem Tower", "Jeronimos Monastery", "Saturn", "red panda") sempre que o item for um lugar, bicho, objeto,
    obra ou coisa fotografável; vazio só para ideias abstratas.
    Use um carrossel para cada grupo diferente (ex.: "Planetas rochosos" e "Gigantes gasosos"; "Dia 1", "Dia 2"...).
  · "tabela": comparar TRÊS ou mais coisas em vários critérios (para três ou mais, use tabela, não "comparacao"). {{"tipo": "tabela", "titulo": "...", "colunas": ["", "critério 1", ...],
    "linhas": [["item", "valor", ...], ...]}} — até 4 colunas e 7 linhas, células curtas.
  · "barras": comparar UM número entre vários itens (tamanhos, populações, preços). {{"tipo": "barras", "titulo": "...",
    "itens": [{{"rotulo": "item", "valor": "1.234 km", "numero": 1234}}]}} — até 8 itens; "numero" é o valor puro, para a barra.
  · "texto": explicação corrida. {{"tipo": "texto", "titulo": "...", "paragrafos": ["até 45 palavras", ...]}} — de 1 a 3 parágrafos.
  · "passos": como fazer, em ordem. {{"tipo": "passos", "titulo": "...", "itens": [{{"texto": "até 12 palavras"}}]}} — até 6.
  · "linha_tempo": datas. {{"tipo": "linha_tempo", "titulo": "...", "itens": [{{"quando": "1969", "texto": "até 6 palavras"}}]}} — até 6.
  · "fatos": números-chave. {{"tipo": "fatos", "titulo": "...", "itens": [{{"rotulo": "1-3 palavras", "valor": "curto"}}]}} — 2 a 4.
  · "lista": pontos soltos (prós, contras, dicas). {{"tipo": "lista", "titulo": "...", "itens": [{{"texto": "até 8 palavras", "detalhe": "até 12"}}]}}.
  · "comparacao": exatamente dois lados. {{"tipo": "comparacao", "titulo": "...", "lados": [{{"nome": "...", "valor": "...", "detalhe": "..."}}]}}.
- Cada seção traz informação NOVA (não repita a mesma coisa em dois formatos). Títulos de seção curtos.
- Só fatos de que você tem certeza. Não invente números, datas nem nomes.
{protecao}
Exemplo (pergunta: "me fala dos planetas do sistema solar"):
{{"foto": "Saturn rings", "cor": "#6f8cff", "blocos": [
  {{"tipo": "destaque", "kicker": "Astronomia", "titulo": "Sistema Solar", "sub": "Oito planetas giram em volta do Sol: quatro rochosos e quatro gigantes"}},
  {{"tipo": "carrossel", "titulo": "Planetas rochosos", "itens": [{{"titulo": "Mercúrio", "valor": "88 dias", "texto": "O menor e mais próximo do Sol, sem atmosfera para segurar o calor", "foto": "Mercury planet"}},
    {{"titulo": "Vênus", "valor": "462 °C", "texto": "O mais quente, coberto por nuvens de ácido sulfúrico", "foto": "Venus planet"}},
    {{"titulo": "Terra", "valor": "365 dias", "texto": "O único com água líquida na superfície e vida conhecida", "foto": "Earth planet"}},
    {{"titulo": "Marte", "valor": "687 dias", "texto": "O planeta vermelho, com o maior vulcão do Sistema Solar", "foto": "Mars planet"}}]}},
  {{"tipo": "carrossel", "titulo": "Gigantes", "itens": [{{"titulo": "Júpiter", "valor": "95 luas", "texto": "O maior de todos, com uma tempestade maior que a Terra", "foto": "Jupiter planet"}},
    {{"titulo": "Saturno", "valor": "146 luas", "texto": "Os anéis mais famosos, feitos de gelo e rocha", "foto": "Saturn planet"}},
    {{"titulo": "Urano", "valor": "98°", "texto": "Gira deitado, com o eixo quase paralelo à órbita", "foto": "Uranus planet"}},
    {{"titulo": "Netuno", "valor": "2.100 km/h", "texto": "Os ventos mais rápidos do Sistema Solar", "foto": "Neptune planet"}}]}},
  {{"tipo": "barras", "titulo": "Diâmetro", "itens": [{{"rotulo": "Júpiter", "valor": "139.820 km", "numero": 139820}}, {{"rotulo": "Saturno", "valor": "116.460 km", "numero": 116460}},
    {{"rotulo": "Terra", "valor": "12.742 km", "numero": 12742}}, {{"rotulo": "Mercúrio", "valor": "4.879 km", "numero": 4879}}]}},
  {{"tipo": "fatos", "titulo": "Em números", "itens": [{{"rotulo": "Idade", "valor": "4,6 bilhões de anos"}}, {{"rotulo": "Luz do Sol à Terra", "valor": "8 min 20 s"}}]}}]}}"""

PAINEL_PEDIDO = """Pergunta: "{frase}"
O Zak já respondeu em voz alta: "{fala}"
{extra}Monte agora a tela completa dessa resposta."""

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


def _normalizar_bloco(b, tipos: list[str] = TIPOS_IA) -> dict | None:
    """Modelos pequenos às vezes escrevem {"destaque": {...}} ou {"fatos": [...]} em vez de {"tipo": ...}."""
    if not isinstance(b, dict):
        return None
    if b.get("tipo") not in tipos:
        chave = next((k for k in b if k in tipos), None)
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


def _numero(v) -> float | None:
    """ "139.820 km" → 139820; "4,6 bi" → 4.6 (para o tamanho das barras)."""
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"-?\d[\d.,]*", str(v or ""))
    if not m:
        return None
    t = m.group(0).rstrip(".,")
    if "," in t:
        t = t.replace(".", "").replace(",", ".")
    elif t.count(".") > 1 or re.fullmatch(r"-?\d{1,3}\.\d{3}", t):
        t = t.replace(".", "")
    try:
        return float(t)
    except ValueError:
        return None


def _limpar_painel(b: dict) -> dict | None:
    t = b["tipo"]
    lb: dict = {"tipo": t}
    if b.get("titulo"):
        lb["titulo"] = _s(b["titulo"], 50)
    if t == "carrossel":
        itens = []
        for i in (b.get("itens") or [])[:8]:
            if isinstance(i, str):
                i = {"titulo": i}
            if not isinstance(i, dict) or not (i.get("titulo") or i.get("texto")):
                continue
            li = {k: _s(i[k], n) for k, n in (("titulo", 40), ("valor", 24), ("rotulo", 30), ("texto", 170), ("foto", 60))
                  if i.get(k)}
            itens.append(li)
        if len(itens) < 2:
            return None
        lb["itens"] = itens
    elif t == "tabela":
        colunas = [_s(c, 30) for c in (b.get("colunas") or [])[:4] if isinstance(c, (str, int, float))]
        linhas = []
        for linha in (b.get("linhas") or [])[:7]:
            if isinstance(linha, dict):
                linha = list(linha.values())
            if not isinstance(linha, list):
                continue
            celulas = [_s(c, 40) for c in linha[:4]]
            if any(celulas):
                linhas.append(celulas)
        if len(linhas) < 2:
            return None
        n = max(len(colunas), max(len(l) for l in linhas))
        if n < 2:
            return None
        lb["colunas"] = (colunas + [""] * n)[:n] if colunas else []
        lb["linhas"] = [(l + [""] * n)[:n] for l in linhas]
    elif t == "texto":
        paragrafos = b.get("paragrafos") or ([b["texto"]] if b.get("texto") else [])
        if isinstance(paragrafos, str):
            paragrafos = [paragrafos]
        lb["paragrafos"] = [_s(p, 360) for p in paragrafos[:3] if isinstance(p, str) and p.strip()]
        if not lb["paragrafos"]:
            return None
    elif t == "barras":
        itens = []
        for i in (b.get("itens") or [])[:8]:
            if not isinstance(i, dict) or not i.get("rotulo"):
                continue
            numero = _numero(i.get("numero")) if i.get("numero") is not None else _numero(i.get("valor"))
            if numero is None or numero < 0:
                continue
            itens.append({"rotulo": _s(i["rotulo"], 30), "valor": _s(i.get("valor") or f"{numero:g}", 24), "numero": numero})
        if len(itens) < 2 or not max(i["numero"] for i in itens):
            return None
        lb["itens"] = itens
    return lb


def limpar_cena(cena: dict | None, painel: bool = False) -> dict:
    """Só o vocabulário conhecido, com tamanhos que cabem na tela.
    painel: tela de resposta longa (até 8 seções, carrosséis, tabelas, textos e barras)."""
    cena = cena if isinstance(cena, dict) else {}
    tipos = TIPOS_IA + (TIPOS_PAINEL if painel else [])
    brutos = [_normalizar_bloco(b, tipos) for b in (cena.get("blocos") or [])]
    # fatos soltos (um por bloco) viram um bloco só
    juntos: list[dict] = []
    for b in brutos:
        if b and b["tipo"] == "fatos" and juntos and juntos[-1]["tipo"] == "fatos":
            juntos[-1]["itens"] = list(juntos[-1].get("itens") or []) + list(b.get("itens") or [])
        elif b:
            juntos.append(b)
    blocos = []
    for b in juntos[:8 if painel else 3]:
        if not isinstance(b, dict) or b.get("tipo") not in tipos:
            continue
        t = b["tipo"]
        if t in TIPOS_PAINEL:
            if lb := _limpar_painel(b):
                blocos.append(lb)
            continue
        lb: dict = {"tipo": t}
        for campo, n in (("kicker", 40), ("titulo", 60), ("sub", 140), ("valor", 16), ("unidade", 12),
                         ("rotulo", 50), ("detalhe", 140), ("texto", 220), ("autor", 50)):
            if b.get(campo):
                lb[campo] = _s(b[campo], n)
        if t in ("fatos", "lista", "passos", "linha_tempo"):
            itens = []
            for i in (b.get("itens") or [])[:6 if painel else 5]:
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
        **({"formato": "painel"} if painel else {}),
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
        partes += b.get("paragrafos", []) + b.get("colunas", []) + [c for l in b.get("linhas", []) for c in l]
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
                     pesquisa: tuple[str, str] | None = None, historico: list[tuple[str, str]] | None = None,
                     seguimento: bool = False) -> dict:
        d = datetime.now()
        agora = f"{DIAS[d.weekday()]}, {d:%d/%m/%Y}, {d:%H:%M}"
        sistema = PEDIDO.format(agora=agora, cidade=cidade, clima=clima, regras=REGRAS_CENA)
        usuario = ""
        if historico:
            turnos = "\n".join(f'Pessoa: "{p}"\nZak: "{z}"' for p, z in historico)
            usuario += CONVERSA.format(turnos=turnos) + "\n\n"
        if seguimento:
            usuario += SEGUIMENTO + "\n\n"
        usuario += f'Frase dita para você: "{frase}"'
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
            "detalhar": bool(dados.get("detalhar")),
            "imagens": [_s(i, 200) for i in dados["imagens"] if isinstance(i, str) and i.strip()][:8]
                       if isinstance(dados.get("imagens"), list) else [],
            "gerar": bool(dados.get("gerar")),
            "fala": _s(re.sub(r"[*_#`]", "", str(dados.get("fala") or "")), 300),
            "cena": limpar_cena(dados.get("cena")),
        }

    async def painel(self, http: httpx.AsyncClient, modelo: str, frase: str, fala: str, protecao: bool,
                     pesquisa: tuple[str, str] | None = None, historico: list[tuple[str, str]] | None = None) -> dict:
        """A tela completa de uma resposta longa (várias seções: carrosséis, tabela, barras, texto...)."""
        d = datetime.now()
        sistema = PAINEL.format(agora=f"{DIAS[d.weekday()]}, {d:%d/%m/%Y}",
                                protecao="- Nada de nomes de colegas nem assuntos pessoais." if protecao else "")
        extra = ""
        if historico:
            extra += "Conversa antes (contexto): " + " | ".join(f'"{p}" → "{z}"' for p, z in historico[-3:]) + "\n"
        if pesquisa:
            extra += f'Wikipédia sobre "{pesquisa[0]}" (use como fonte):\n{pesquisa[1]}\n'
        dados = await self._chat(http, modelo, sistema, PAINEL_PEDIDO.format(frase=frase, fala=fala, extra=extra), {}, 0.4)
        return limpar_cena(dados, painel=True)
