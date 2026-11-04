# Painel Ambiente

Tela cheia com widgets informativos sobre um fundo animado que reage ao mouse, à câmera, aos cliques e à voz.
Ouve a sala e mostra destaques da conversa gerados **localmente** (Whisper + Ollama), com mute de verdade.

- **Widgets:** relógio com saudação e próximo feriado, clima atual, próximas 24 h (interativo), próximos 7 dias, sol e lua, câmbio, notícias, sala.
- **Sala:** os destaques da IA vão se **acumulando numa lista** (o mais novo no topo). Arraste para cima ou para baixo com o mouse ou o dedo, use a roda do mouse ou a mão aberta na câmera. Se chegar coisa nova enquanto você lê, a lista não pula: aparece um aviso "↑ novos".
- **Fundo:** aurora em WebGL que muda de cor com a hora real do nascer e do pôr do sol e com o clima. Chuva, neve, névoa, estrelas cadentes e relâmpagos de acordo com a previsão.
- **Interação:** o mouse "mexe" a aurora e afasta as partículas, um clique solta uma onda, e os cards se inclinam e brilham sob o cursor. Na câmera, o movimento vira um segundo ponteiro e um aceno amplo vale como clique. A voz acelera o fluxo.
- **Responsivo:** tudo é medido em `rem` proporcional ao menor lado da tela, então o painel fica idêntico em HD, Full HD e 4K. Há layouts para horizontal, vertical, telas quadradas (4:3, 5:4) e ultrawide.

## Como rodar

1. **Ollama.** Instale pelo site oficial e baixe um modelo (veja os recomendados na seção do Zak):
   ```powershell
   ollama pull qwen3:8b
   ```
2. **Dependências.** Não rode `pip install` direto no terminal: o comando `pip` desta máquina aponta para o Python global (`C:\Python314`), que já tem outras versões de `onnxruntime` e `ctranslate2`. O `iniciar.bat` cria e confere sozinho o ambiente isolado `.venv`, com as versões compatíveis de `requirements.txt` (e as libs CUDA se houver placa NVIDIA). Se ele encontrar algo faltando ou em conflito, reinstala. Para instalar manualmente, use sempre `.venv\Scripts\python -m pip install -r requirements.txt`.
3. **Iniciar.** Dê dois cliques em `iniciar.bat`. Ele sobe o servidor e abre o Edge em modo quiosque (tela cheia).
   Para sair, use **Alt+F4**.

   Se preferir abrir manualmente, rode `.venv\Scripts\python -m backend.main` e acesse `http://localhost:8765`.

**Se algo der errado:** a janela do `iniciar.bat` fica aberta mostrando o erro. O log do servidor fica em `logs\servidor-erros.log`.
- `iniciar.bat -Reinstalar` recria o `.venv` do zero.
- `iniciar.bat -SemNavegador` sobe só o servidor (abra `http://127.0.0.1:8765`).
- O script escolhe sozinho um Python compatível (3.10 a 3.14, 64 bits) e prefere o 3.13. Se nenhum servir, ele avisa qual instalar.

Para iniciar junto com o Windows, crie um atalho para `iniciar.bat` em `shell:startup` (digite isso em Win+R).

## Atalhos

| Tecla | Ação |
|---|---|
| `M` | Mutar / ativar microfone |
| `Z` | Digitar um pedido para o Zak (no modo Zak) |
| `A` | Ajustes: modelo de transcrição, modelo do Ollama e câmera |
| `C` | Ligar / desligar câmera |
| `G` | Mostra o guia de gestos |
| `←` `→` / `Esc` | Troca o card em destaque / sai do destaque |
| `F` | Tela cheia (fora do modo quiosque) |
| Clique | Onda no fundo |
| Hover no gráfico de 24 h | Detalhes da hora |
| Clique nas notícias | Próxima manchete (o hover pausa a rotação) |

## Ajustes (botão ⚙ ou tecla `A`)

- **Microfone e retorno:** escolha o microfone (pelo WASAPI, na taxa nativa do aparelho) veja o volume real em dB e ajuste o **ganho** (de −12 a +24 dB; vale para a detecção de fala, para o Whisper e para o retorno). **Ouvir ao vivo** toca o que o microfone capta (use fone de ouvido). Em **O que o Whisper ouviu**, cada uma das últimas frases pode ser ouvida exatamente como chegou à transcrição, ao lado do texto que saiu e de avisos como "muito baixo" ou "saturado". É o primeiro lugar para olhar quando a transcrição erra.
- **Idioma:** Português (pt-BR), English (en-US) ou Detectar automaticamente. Os destaques da IA continuam em português.
- **Transcrição da fala:** escolha o modelo do Whisper, de `tiny` a `large-v3`. Se o modelo ainda não foi baixado, ele baixa em segundo plano enquanto o atual continua transcrevendo, e a troca acontece sozinha quando o download termina.
- **IA da sala:** lista **todos** os modelos instalados no Ollama. Basta clicar para trocar. O modelo anterior é descarregado da VRAM, e os destaques são gerados de novo com o modelo escolhido. Modelos de embedding aparecem na lista, mas não podem ser escolhidos.
- **Câmera:** liga e desliga a câmera, explica o que ela faz e mostra um medidor do movimento detectado no momento.
- As escolhas ficam salvas em `preferencias.json` e valem mais que o `config.toml`. Apague o arquivo para voltar ao que está no `config.toml`.
- Só o próprio computador pode trocar modelos; o celular em `/remote` continua apenas mutando.

## Câmera e gestos

Com a câmera ligada, a mão de quem está na frente da tela vira uma **constelação de estrelas** que segue os dedos, e alguns gestos fazem coisas:

| Gesto | O que acontece |
|---|---|
| 👋 Acenar | O painel dá oi e mostra o guia de gestos |
| 🫲 Parar a mão e deslizar para o lado | **Modo destaque:** traz um card grande para o centro; cada deslize mostra o próximo |
| 🖐️ Mão aberta para cima ou para baixo | Rola a lista da Sala |
| ✊ Fechar a mão… ✋ e abrir | Junta energia (as partículas são puxadas para a mão) e solta uma explosão |
| ☝️ Apontar ou fazer pinça | Desenha com luz no ar (o traço some em 4 s) |
| 👍 Joinha | Fogos de artifício |
| ✌️ Paz e amor | Troca a cena do fundo: noite estrelada, neve, tempestade, vaga-lumes, magia, clima real |
| 🤟 Te amo | Chuva de corações |
| 👎 Polegar para baixo | Limpa tudo e volta ao normal |

- Os gestos só valem para quem está a **menos de 2 m** da câmera (`distancia_gestos` no `config.toml`); quem passa ao fundo é ignorado, e quem tenta de longe recebe um aviso para chegar mais perto. A distância é estimada pelo tamanho real da mão e aparece em Ajustes; se não bater com a real, ajuste `campo_visao` (o ângulo da webcam).
- **As duas mãos brincam:** cada mão faz gestos por conta própria. Uma mão parada não dispara nada (fica um pouco mais apagada na tela), e as mãos não trocam de identidade quando passam perto uma da outra.
- **Contra falsos positivos:** deslizar e rolar só valem depois de a mão parar por um instante (~0,3 s; o tremor natural da mão não atrapalha), e a volta para a posição neutra logo depois de um deslize é ignorada. Para deslizar de propósito para o outro lado, segure a mão parada por ~1 s antes. Gestos como 👍 e ✌️ precisam ser segurados com a mão parada (uma pose que aparece de passagem não conta). Um gesto de cada vez, com um pequeno intervalo entre eles, e baixar a mão para descansar não rola a lista.
- **Diagnóstico:** em Ajustes → Brincar com as mãos, aparece ao vivo o que cada mão está fazendo: gesto reconhecido, distância, se está parada (pronta) ou em movimento, e quantos quadros por segundo a análise consegue. Ajuda a entender por que um gesto não disparou.
- Com a mão bem visível e o ambiente iluminado, o reconhecimento fica mais firme.
- O reconhecimento roda num *worker* (fora da thread da página), então a animação não trava enquanto as mãos são analisadas.
- A cena escolhida com ✌️ volta sozinha ao clima real depois de 4 minutos, e o destaque se fecha sozinho depois de pouco mais de 1 minuto.
- Os gestos podem ser desligados em Ajustes. Sem eles, a câmera continua detectando movimento: quem se mexe "mexe" na aurora, e sem ninguém por `ociosidade_minutos` o painel entra em **modo ambiente**.
- O reconhecimento de mãos usa o MediaPipe e roda **dentro do navegador**. Na primeira vez, o servidor baixa o modelo (~18 MB) para `cache/visao`; depois funciona offline.

## Zak, o assistente da sala

Em vez de acrescentar mais cards, **a tela inteira vira a cena do assunto** da conversa. Quando não há nada a mostrar, ela volta a um repouso quase vazio (hora, clima e o orbe do Zak). Tudo o que é IA roda neste computador: Whisper (ouvir), Ollama (pensar), Kokoro (falar) e, com GPU de 12 GB ou mais, Z-Image (imagens). A internet só é usada para buscar dados: fotos, Wikipédia, clima e rádio.

Para usar: `[zak] ativado = true` no `config.toml`, ou abra `http://localhost:8765/?zak`.

**Modo ambiente (sem ninguém chamar)**
- A cada ~20 s, o Zak lê a conversa recente. Se houver um assunto claro e interessante (uma viagem, um projeto, uma tecnologia), a tela se transforma devagar na cena desse assunto: foto ou imagem gerada, cores tiradas dela e até 4 blocos de informação útil.
- O assunto precisa aparecer em duas leituras seguidas (ou ser muito claro) para a tela mudar, e cada cena fica pelo menos 45 s. Assim a tela não fica pulando a cada frase. Se o assunto continua o mesmo, a cena continua; quando a conversa acaba, ela volta sozinha ao repouso.
- Se a conversa é sobre um lugar, a cena ganha a hora local, que fica sempre certa, e o clima de lá agora (Open-Meteo).

**Proteção de informação** (liga e desliga em Ajustes → Zak; ligada por padrão)
- A tela mostra só o **tema**, nunca falas, nomes de pessoas, clientes ou números internos.
- Assuntos pessoais ou delicados (RH, salário, demissão, saúde, vida pessoal, política, religião, finanças pessoais, segredos da empresa) **não aparecem**. A regra é aplicada duas vezes: a IA marca o assunto como sensível, e um filtro de palavras no servidor derruba a cena se algo escapar.
- Ligar a proteção limpa na hora uma cena do ambiente que já estava na tela.
- Com a proteção desligada, a cena pode listar pontos citados na conversa, mas continua sem nomes e sem assuntos sensíveis.

**"Ei, Zak" (pedidos)**
- Chame e faça o pedido na mesma frase: *"Ei, Zak, qual a altura do Everest?"*. Também dá para dizer só *"Ei, Zak"* e pedir na frase seguinte (ele espera 8 s, e o orbe mostra que está ouvindo). Ou digite: tecla `Z` ou clique no orbe.
- O que ele faz:
  - responde perguntas (com a cena da resposta na tela; quando não tem certeza, consulta a Wikipédia antes);
  - **timer** ("coloca um timer de 10 minutos pro chá");
  - **lembrete** ("me lembra às 15h de ligar pro fornecedor");
  - **música** ("toca um jazz": uma rádio online gratuita do estilo, pela base aberta radio-browser.info), "para a música", "mais alto"/"mais baixo";
  - **limpa a tela**;
  - **para de ouvir** (é o mesmo que mutar).
- Timers e lembretes sobrevivem a reiniciar o servidor (`cache/zak_agenda.json`) e aparecem como pílulas no canto, junto com a rádio tocando. Clique numa pílula para cancelar.
- **Voz:** masculina pt-BR (Kokoro, voz `pm_alex`), gerada frase a frase para ele começar a falar logo. A legenda acende palavra por palavra no ritmo do áudio, e a música abaixa enquanto ele fala.
- **Eco e interrupção:** enquanto o Zak fala, o que o microfone capta é descartado (é a voz dele saindo da caixa de som). Para interromper, chame pelo nome: *"Zak, para"*. Um viva-voz de conferência com cancelamento de eco ajuda muito.
- O Whisper recebe "Ei, Zak" como palavra-chave (`hotwords`), o que faz ele escrever o nome certo. A detecção também aceita as grafias que ele costuma errar (Zack, Zeck, Eizek…), mas não reage a "zap".

**Imagens**
- **Fotos reais (coisas concretas):** o servidor busca no Wikimedia Commons, primeiro entre as fotos avaliadas como de qualidade pela comunidade. Ele descarta fundo branco chapado, mapas, diagramas, logos e fotos de baixa resolução, escuras ou estouradas demais. A foto fica em 4K em `cache/imagens`, se dissolve no fundo animado e tinge a cena com a paleta dela. O crédito (autor e licença) aparece no canto.
- **Imagens geradas (ideias e atmosferas):** com o `requirements-imagem.txt` instalado e uma GPU de 12 GB ou mais, o Zak gera a imagem localmente com o **Z-Image-Turbo** (licença Apache 2.0, pode ser usado na empresa). O modelo roda num processo à parte, aberto na primeira imagem e fechado depois de 10 min sem uso, para devolver a VRAM ao Whisper e ao Ollama. Sem GPU suficiente, essas cenas ficam só com o fundo animado. Outro modelo: `[zak] imagem_modelo`.
- O `iniciar.bat` instala a geração de imagens sozinho quando encontra uma placa com 12 GB ou mais.

**Modelos recomendados**
- **RTX 5090 (32 GB):** `qwen3:14b` (ou `gemma3:12b`) no Ollama + Whisper `large-v3-turbo` + Z-Image-Turbo cabem juntos. Com um modelo de ~30B (ex.: `qwen3:30b-a3b`), o gerador de imagens passa a dividir a VRAM com a RAM e fica mais lento.
- **8 GB de VRAM:** `qwen3:8b` responde em ~10–20 s nesta configuração; as imagens geradas ficam desligadas.
- O modelo é o mesmo da IA da Sala (Ajustes → IA da sala). Com só telas do Zak abertas, os cards da Sala não são gerados, e a GPU fica para ele.

**Demonstração sem IA:** `http://localhost:8765/?zak&demo` mostra cenas de exemplo. Teclas: `1`–`5` mostram uma cena, `0` volta ao repouso e `espaço` pausa o ciclo; `?zak&demo=manual` só muda pelas teclas. Em qualquer modo, `←`/`→` (ou deslizar a mão) andam pelo histórico de cenas e `Esc` limpa a tela.

## Privacidade

- **Mute fecha o microfone** de verdade, e o Windows deixa de mostrar o ícone de mic em uso. Se você mutar durante uma transcrição, o texto é descartado.
- **Mute automático:** quando Teams, Zoom, Meet (no navegador), Discord etc. estão usando o microfone, o painel muta sozinho. A detecção usa o registro de uso de microfone do próprio Windows.
- **Nada é gravado em disco.** O áudio existe só na memória até ser transcrito. A transcrição fica na memória por `retencao_minutos` (10 por padrão). O botão **Esquecer** apaga tudo na hora.
- **Retorno do microfone:** só existe na própria tela (o `/remote` não tem acesso) e só enquanto os Ajustes estão abertos. As últimas 6 frases ficam na memória para você ouvir e são apagadas ao fechar os Ajustes, mutar ou clicar em Esquecer.
- **Câmera:** o movimento é detectado em 64×48 pixels em tons de cinza, e as mãos são reconhecidas pelo MediaPipe, tudo dentro do navegador. Nenhuma imagem é gravada nem sai do computador.
- **Controle pelo celular:** com `rede_local = true` no `config.toml`, abra `http://<ip-do-pc>:8765/remote`. Clientes remotos recebem **apenas** o estado do microfone, nunca a transcrição nem os insights.
- **Zak:** pedidos, respostas, cenas e a voz dele só vão para a própria tela (o `/remote` não recebe nada disso). A voz gerada fica só na memória. O que ele ouve segue as mesmas regras da transcrição: nada é gravado, e o mute fecha o microfone. Para a internet saem apenas termos de busca curtos (foto, Wikipédia, cidade do clima, estilo de rádio), nunca a conversa.
- Avise as pessoas da sala de que existe escuta ativa. O indicador "Ouvindo" fica sempre visível.

## Configuração (`config.toml`)

Os principais itens:
- `[local] cidade`: a cidade é localizada automaticamente; também aceita `latitude`/`longitude`.
- `[audio] modelo_whisper`: o padrão `auto` usa o `large-v3-turbo` com GPU NVIDIA e o `small` só com CPU. Também dá para trocar em Ajustes.
- `[audio] sensibilidade`: aumente se falas baixas não forem captadas; diminua se ruído virar texto.
- `[ia] modelo`: o modelo inicial do Ollama; em Ajustes dá para escolher qualquer modelo instalado. Com 8 GB de VRAM, prefira modelos de até ~8B, porque o Whisper também usa a GPU (o `large-v3-turbo` ocupa ~1,6 GB).
- `[tela] fps_max` / `qualidade_fundo`: reduza para economizar energia num painel 24/7.
- `[camera] distancia_gestos` / `campo_visao`: até quantos metros os gestos valem e o ângulo de visão da webcam usado para estimar a distância.
- `[audio] microfone`: parte do nome do microfone; o escolhido em Ajustes vale mais.
- `[audio] idioma` / `ganho_db`: idioma falado (`pt`, `en` ou `auto`) e ganho do microfone em dB; ambos também em Ajustes.
- `[camera] ociosidade_minutos`: sem movimento por esse tempo, o painel entra em **modo ambiente** (só relógio e sala em destaque). Volta assim que alguém se mexe.

## GPU

As bibliotecas CUDA (`requirements-gpu.txt`) já estão instaladas no `.venv`, e o Whisper roda na GPU.
Se algo falhar, ele volta sozinho para a CPU; o log mostra `Whisper ... carregado em cuda|cpu`.

## Estrutura

```
backend/
  main.py          servidor FastAPI, WebSocket /ws, rotas /api/*
  audio.py         microfone → detecção de fala → Whisper (thread própria)
  ia.py            transcrição recente → Ollama → resumo, tópicos e cards (JSON estruturado)
  privacidade.py   detecta outros apps usando o microfone (mute automático)
  sala.py          estado da sala: mute, transcrição em memória, insights
  dados.py         clima, ar, câmbio, feriados e notícias (APIs gratuitas, com cache)
  modelos.py       catálogo do Whisper, lista de modelos do Ollama, preferencias.json
  visao.py         baixa uma vez e serve o reconhecedor de mãos (cache/visao)
  retorno.py       retorno do microfone: ao vivo e as últimas frases como o Whisper ouviu
  imagens.py       fotos das cenas do Zak: busca, filtro de qualidade, paleta e cache 4K
  zak.py           Zak: modo ambiente, "Ei, Zak", eco, timers, lembretes, rádio e voz
  zak_ia.py        prompts e limpeza do que o modelo devolve (cenas, ações, proteção de informação)
  voz.py           texto → fala (Kokoro, local)
  geracao.py       imagens geradas localmente (abre/fecha o processo geracao_worker.py)
frontend/
  index.html, css/style.css, css/zak.css
  js/main.js       orquestra cena, interação, câmera e atalhos
  js/ajustes.js    painel de Ajustes (microfone, modelos e câmera)
  js/retorno.js    retorno do microfone (seção dos Ajustes)
  js/fundo.js      shader da aurora (WebGL)
  js/particulas.js chuva, neve, estrelas, poeira e névoa
  js/camera.js     webcam e detecção de movimento
  js/maos.js       mãos e gestos: rastreio, distância, deslizar, acenar, punho→explosão
  js/maos-worker.js  roda o MediaPipe fora da thread principal
  js/luzes.js      efeitos de luz: constelação da mão, fogos, corações, desenho no ar
  js/brincar.js    liga cada gesto ao seu efeito; aviso e guia de gestos
  js/destaque.js   modo destaque (um card grande no centro)
  js/paleta.js     cores por hora do dia e clima
  js/widgets/*.js  um módulo por widget
  js/zak/palco.js  palco do Zak: cena atual, foto, transições, histórico e contagens
  js/zak/blocos.js vocabulário de blocos das cenas (o que a IA pode pedir)
  js/zak/presenca.js  orbe do Zak (repouso, ouvindo, pensando, falando) e legenda da fala
  js/zak/cliente.js  liga a tela ao Zak: voz, legenda, música, timers e o campo de pedido
  js/zak/demo.js   cenas de exemplo (/?zak&demo)
  remote.html      controle de mute para o celular
```

Fontes de dados, todas gratuitas e sem chave: Open-Meteo (clima, qualidade do ar, geocodificação), AwesomeAPI (câmbio), BrasilAPI (feriados), RSS de g1, Agência Brasil e Folha, e Wikimedia Commons (fotos das cenas do Zak), Wikipédia (respostas do Zak) e radio-browser.info (rádios).
