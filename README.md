# Painel Ambiente

Tela cheia com widgets informativos sobre um fundo animado que reage ao mouse, à câmera, aos cliques e à voz.
Ouve a sala e mostra destaques da conversa gerados **localmente** (Whisper + Ollama), com mute de verdade.

- **Widgets:** relógio com saudação e próximo feriado, clima atual, próximas 24 h (interativo), próximos 7 dias, sol e lua, câmbio, notícias, sala.
- **Fundo:** aurora em WebGL que muda de cor com a hora real do nascer e do pôr do sol e com o clima. Chuva, neve, névoa, estrelas cadentes e relâmpagos de acordo com a previsão.
- **Interação:** o mouse "mexe" a aurora e afasta as partículas, um clique solta uma onda, e os cards se inclinam e brilham sob o cursor. Na câmera, o movimento vira um segundo ponteiro e um aceno amplo vale como clique. A voz acelera o fluxo.
- **Responsivo:** tudo é medido em `rem` proporcional ao menor lado da tela, então o painel fica idêntico em HD, Full HD e 4K. Há layouts para horizontal, vertical, telas quadradas (4:3, 5:4) e ultrawide.

## Como rodar

1. **Ollama.** O `ollama.exe` deste PC está corrompido. Reinstale pelo site oficial e baixe o modelo:
   ```powershell
   ollama pull gemma3:4b
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
| `A` | Ajustes: modelo de transcrição, modelo do Ollama e câmera |
| `C` | Ligar / desligar câmera |
| `G` | Mostra o guia de gestos |
| `←` `→` / `Esc` | Troca o card em destaque / sai do destaque |
| `F` | Tela cheia (fora do modo quiosque) |
| Clique | Onda no fundo |
| Hover no gráfico de 24 h | Detalhes da hora |
| Clique nas notícias | Próxima manchete (o hover pausa a rotação) |

## Ajustes (botão ⚙ ou tecla `A`)

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
| 🫲 Deslizar a mão para o lado | **Modo destaque:** traz um card grande para o centro; cada deslize mostra o próximo |
| ✊ Fechar a mão… ✋ e abrir | Junta energia (as partículas são puxadas para a mão) e solta uma explosão |
| ☝️ Apontar ou fazer pinça | Desenha com luz no ar (o traço some em 4 s) |
| 👍 Joinha | Fogos de artifício |
| ✌️ Paz e amor | Troca a cena do fundo: noite estrelada, neve, tempestade, vaga-lumes, magia, clima real |
| 🤟 Te amo | Chuva de corações |
| 👎 Polegar para baixo | Limpa tudo e volta ao normal |

- Funciona melhor a 1–2 m da câmera, com a mão bem visível e o ambiente iluminado.
- A cena escolhida com ✌️ volta sozinha ao clima real depois de 4 minutos, e o destaque se fecha sozinho depois de pouco mais de 1 minuto.
- Os gestos podem ser desligados em Ajustes. Sem eles, a câmera continua detectando movimento: quem se mexe "mexe" na aurora, e sem ninguém por `ociosidade_minutos` o painel entra em **modo ambiente**.
- O reconhecimento de mãos usa o MediaPipe e roda **dentro do navegador**. Na primeira vez, o servidor baixa o modelo (~18 MB) para `cache/visao`; depois funciona offline.

## Privacidade

- **Mute fecha o microfone** de verdade, e o Windows deixa de mostrar o ícone de mic em uso. Se você mutar durante uma transcrição, o texto é descartado.
- **Mute automático:** quando Teams, Zoom, Meet (no navegador), Discord etc. estão usando o microfone, o painel muta sozinho. A detecção usa o registro de uso de microfone do próprio Windows.
- **Nada é gravado em disco.** O áudio existe só na memória até ser transcrito. A transcrição fica na memória por `retencao_minutos` (10 por padrão). O botão **Esquecer** apaga tudo na hora.
- **Câmera:** o movimento é detectado em 64×48 pixels em tons de cinza, e as mãos são reconhecidas pelo MediaPipe, tudo dentro do navegador. Nenhuma imagem é gravada nem sai do computador.
- **Controle pelo celular:** com `rede_local = true` no `config.toml`, abra `http://<ip-do-pc>:8765/remote`. Clientes remotos recebem **apenas** o estado do microfone, nunca a transcrição nem os insights.
- Avise as pessoas da sala de que existe escuta ativa. O indicador "Ouvindo" fica sempre visível.

## Configuração (`config.toml`)

Os principais itens:
- `[local] cidade`: a cidade é localizada automaticamente; também aceita `latitude`/`longitude`.
- `[audio] modelo_whisper`: o padrão `auto` usa o `large-v3-turbo` com GPU NVIDIA e o `small` só com CPU. Também dá para trocar em Ajustes.
- `[audio] sensibilidade`: aumente se falas baixas não forem captadas; diminua se ruído virar texto.
- `[ia] modelo`: o modelo inicial do Ollama; em Ajustes dá para escolher qualquer modelo instalado. Com 8 GB de VRAM, prefira modelos de até ~8B, porque o Whisper também usa a GPU (o `large-v3-turbo` ocupa ~1,6 GB).
- `[tela] fps_max` / `qualidade_fundo`: reduza para economizar energia num painel 24/7.
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
frontend/
  index.html, css/style.css
  js/main.js       orquestra cena, interação, câmera e atalhos
  js/ajustes.js    painel de Ajustes (modelos e câmera)
  js/fundo.js      shader da aurora (WebGL)
  js/particulas.js chuva, neve, estrelas, poeira e névoa
  js/camera.js     webcam e detecção de movimento
  js/maos.js       mãos e gestos (MediaPipe): rastreio, deslizar, acenar, punho→explosão
  js/luzes.js      efeitos de luz: constelação da mão, fogos, corações, desenho no ar
  js/brincar.js    liga cada gesto ao seu efeito; aviso e guia de gestos
  js/destaque.js   modo destaque (um card grande no centro)
  js/paleta.js     cores por hora do dia e clima
  js/widgets/*.js  um módulo por widget
  remote.html      controle de mute para o celular
```

Fontes de dados, todas gratuitas e sem chave: Open-Meteo (clima, qualidade do ar, geocodificação), AwesomeAPI (câmbio), BrasilAPI (feriados) e RSS de g1, Agência Brasil e Folha.
