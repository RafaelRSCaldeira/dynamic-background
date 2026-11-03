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
| `C` | Ligar / desligar câmera |
| `F` | Tela cheia (fora do modo quiosque) |
| Clique | Onda no fundo |
| Hover no gráfico de 24 h | Detalhes da hora |
| Clique nas notícias | Próxima manchete (o hover pausa a rotação) |

## Privacidade

- **Mute fecha o microfone** de verdade, e o Windows deixa de mostrar o ícone de mic em uso. Se você mutar durante uma transcrição, o texto é descartado.
- **Mute automático:** quando Teams, Zoom, Meet (no navegador), Discord etc. estão usando o microfone, o painel muta sozinho. A detecção usa o registro de uso de microfone do próprio Windows.
- **Nada é gravado em disco.** O áudio existe só na memória até ser transcrito. A transcrição fica na memória por `retencao_minutos` (10 por padrão). O botão **Esquecer** apaga tudo na hora.
- **Câmera:** usa só 64×48 pixels em tons de cinza para detectar movimento, tudo dentro do navegador. Nenhuma imagem sai dele.
- **Controle pelo celular:** com `rede_local = true` no `config.toml`, abra `http://<ip-do-pc>:8765/remote`. Clientes remotos recebem **apenas** o estado do microfone, nunca a transcrição nem os insights.
- Avise as pessoas da sala de que existe escuta ativa. O indicador "Ouvindo" fica sempre visível.

## Configuração (`config.toml`)

Os principais itens:
- `[local] cidade`: a cidade é localizada automaticamente; também aceita `latitude`/`longitude`.
- `[audio] modelo_whisper`: o padrão é `small`. Na RTX 3070, `large-v3-turbo` transcreve bem melhor e continua rápido.
- `[audio] sensibilidade`: aumente se falas baixas não forem captadas; diminua se ruído virar texto.
- `[ia] modelo`: qualquer modelo do Ollama (`gemma3:4b`, `qwen3:8b`, `llama3.1:8b`...). Com 8 GB de VRAM, prefira modelos de até ~8B, porque o Whisper também usa a GPU.
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
frontend/
  index.html, css/style.css
  js/main.js       orquestra cena, interação, câmera e atalhos
  js/fundo.js      shader da aurora (WebGL)
  js/particulas.js chuva, neve, estrelas, poeira e névoa
  js/camera.js     detecção de movimento
  js/paleta.js     cores por hora do dia e clima
  js/widgets/*.js  um módulo por widget
  remote.html      controle de mute para o celular
```

Fontes de dados, todas gratuitas e sem chave: Open-Meteo (clima, qualidade do ar, geocodificação), AwesomeAPI (câmbio), BrasilAPI (feriados) e RSS de g1, Agência Brasil e Folha.
