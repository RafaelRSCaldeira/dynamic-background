// Painel de Ajustes: escolhe o modelo de transcrição (Whisper) e a IA da sala (qualquer modelo do Ollama),
// e mostra o que a câmera está detectando. Abre pelo botão ⚙, pela tecla A ou clicando no nome do modelo na Sala.
import { getJSON } from './api.js';
import { esc, bus } from './util.js';
import { mini } from './icones.js';
import { GESTOS } from './brincar.js';
import { criarRetorno } from './retorno.js';

export function iniciarAjustes({ enviar, camera, alternarCamera, brincar, ociosidadeMin = 5, modoZak = false }) {
  const dlg = document.createElement('dialog');
  dlg.id = 'ajustes';
  dlg.setAttribute('aria-label', 'Ajustes');
  dlg.tabIndex = -1;
  dlg.innerHTML = `
    <header class="aj-topo">
      <h2>${mini.ajustes}<span>Ajustes</span></h2>
      <div class="aj-acoes">
        <button class="aj-mini aj-sair" title="Fecha a tela cheia e desliga o painel (o mesmo que Alt+F4)">${mini.sair}<span>Sair</span></button>
        <button class="aj-fechar ctl" title="Fechar (Esc)">${mini.fechar}</button>
      </div>
    </header>
    <div class="aj-rolagem">
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Tela</h3></div>
        <div class="aj-idiomas aj-dois" role="radiogroup" aria-label="Tela do painel" data-tela>
          <button role="radio" data-valor="zak"><b>Zak</b><small>assistente de voz e cenas do assunto</small></button>
          <button role="radio" data-valor="classico"><b>Painel clássico</b><small>cards da conversa, sem assistente</small></button>
        </div>
        <p class="aj-ajuda" data-tela-ajuda></p>
      </section>
      <section class="aj-secao" data-zak-secao hidden>
        <div class="aj-titulo"><h3>Zak</h3><span class="aj-sub" data-zak-sub></span></div>
        <div class="aj-linha">
          <div><b>Proteção de informação</b>
            <small>A tela mostra só o tema da conversa, nunca falas, nomes ou números, e não mostra nada sobre assuntos pessoais ou delicados (RH, saúde, salário…). Recomendado no escritório.</small></div>
          <button class="aj-mini" data-zak-protecao></button>
        </div>
        <p class="aj-ajuda">Chame com <b>“Ei, Zak”</b> e faça o pedido na mesma frase. Também dá para digitar: tecla <kbd>Z</kbd> ou clique no orbe. Para ele não escutar nada, use o mute (<kbd>M</kbd>).</p>
      </section>
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Microfone e retorno</h3></div>
        <p class="aj-ajuda">Se a transcrição está errando, comece por aqui: ouça o que chega ao Whisper. Áudio baixo, abafado, com eco ou ruído atrapalha qualquer modelo.</p>
        <div class="aj-idiomas" role="radiogroup" aria-label="Isolamento da voz" data-isolamento>
          <button role="radio" data-valor="volume"><b>Volume</b><small>qualquer som alto</small></button>
          <button role="radio" data-valor="voz"><b>Só voz</b><small>detector neural</small></button>
          <button role="radio" data-valor="voz_ruido"><b>Voz sem ruído</b><small>detector + limpeza</small></button>
        </div>
        <p class="aj-ajuda" data-isolamento-ajuda></p>
        <div data-retorno></div>
      </section>
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Transcrição da fala</h3><span class="aj-sub" data-whisper-sub></span></div>
        <div class="aj-idiomas" role="radiogroup" aria-label="Idioma falado na sala" data-idioma>
          <button role="radio" data-valor="pt"><b>Português</b><small>pt-BR</small></button>
          <button role="radio" data-valor="en"><b>English</b><small>en-US</small></button>
          <button role="radio" data-valor="auto"><b>Detectar</b><small>automático</small></button>
        </div>
        <p class="aj-ajuda">Modelos maiores entendem bem melhor conversas naturais, sotaques e nomes. Com GPU NVIDIA, use o <b>large-v3-turbo</b>.</p>
        <div class="aj-lista" data-whisper></div>
      </section>
      <section class="aj-secao">
        <div class="aj-titulo"><h3>IA da sala <small>Ollama</small></h3><button class="aj-mini" data-atualizar title="Procurar modelos de novo">${mini.atualizar}<span>Atualizar</span></button></div>
        <p class="aj-ajuda">Todos os modelos instalados no Ollama aparecem aqui. Para instalar outro: <kbd>ollama pull nome</kbd>. Com 8 GB de VRAM, prefira modelos de até ~8B.</p>
        <div class="aj-lista" data-ollama></div>
      </section>
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Câmera</h3><button class="aj-mini" data-camera></button></div>
        <p class="aj-ajuda">Tudo é processado dentro do navegador; nenhuma imagem é gravada ou sai deste computador.
          Quem se mexe na frente da tela "mexe" na aurora, e sem ninguém por <b>${ociosidadeMin} min</b> o painel entra em <b>modo ambiente</b>.</p>
        <div class="aj-medidor" data-medidor><span>Movimento agora</span><div><i></i></div></div>
      </section>
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Brincar com as mãos</h3><button class="aj-mini" data-gestos></button></div>
        <p class="aj-ajuda" data-gestos-status></p>
        <ul class="aj-diag" data-gestos-diag aria-live="off"></ul>
        <ul class="aj-gestos">${GESTOS.map(([e, t, d]) => `<li><span>${e}</span><div><b>${t}</b><small>${d}</small></div></li>`).join('')}</ul>
        <p class="aj-ajuda">Os gestos só valem a menos de <b>${(brincar?.maos.distanciaMax ?? 2).toLocaleString('pt-BR')} m</b> da câmera (quem passa ao fundo é ignorado), com a mão bem visível. Pelo teclado: <kbd>←</kbd> <kbd>→</kbd> trocam o destaque, <kbd>Esc</kbd> sai, <kbd>G</kbd> mostra o guia.</p>
      </section>
    </div>`;
  document.body.append(dlg);
  const $ = s => dlg.querySelector(s);
  const retorno = criarRetorno($('[data-retorno]'), { enviar });
  if (new URLSearchParams(location.search).has('debug')) window.__retorno = retorno;

  let sala = {}, catalogo = null, buscando = false, pedidoWhisper = null, pedidoIdioma = null, pedidoIsolamento = null;

  // ── dados ────────────────────────────────────────────────
  const buscar = async () => {
    if (buscando) return;
    buscando = true; $('[data-atualizar]').classList.add('girando');
    try { catalogo = await getJSON('/api/modelos'); }
    catch (e) { catalogo = { erro: String(e.message || e) }; }
    buscando = false; $('[data-atualizar]').classList.remove('girando');
    render();
  };

  // ── render ───────────────────────────────────────────────
  const renderWhisper = () => {
    const lista = $('[data-whisper]');
    if (!catalogo?.whisper) { lista.innerHTML = `<p class="aj-vazio">${catalogo?.erro ? 'Não foi possível ler os modelos.' : 'Carregando…'}</p>`; return; }
    if (!catalogo.audio) { lista.innerHTML = `<p class="aj-vazio">O áudio está desativado no config.toml.</p>`; return; }
    const carregando = sala.estado === 'carregando' && !!sala.whisper_carregando;
    const escolhido = pedidoWhisper || (carregando ? sala.whisper_carregando : sala.whisper_modelo === 'auto' ? sala.whisper_atual : sala.whisper_modelo);
    const disp = sala.whisper_dispositivo ? sala.whisper_dispositivo.toUpperCase() : '';
    $('[data-whisper-sub]').textContent = sala.whisper_atual ? `Em uso: ${sala.whisper_atual}${disp ? ' · ' + disp : ''}` : '';
    const aviso = sala.whisper_aviso ? `<p class="aj-vazio aj-erro">${esc(sala.whisper_aviso)}</p>` : '';
    lista.innerHTML = aviso + catalogo.whisper.map(m => {
      const sel = m.nome === escolhido;
      if (m.nome === sala.whisper_baixando && !carregando) {
        const tam = m.tamanho;
        return `<button class="aj-opcao baixando" data-nome="${esc(m.nome)}" disabled>
          <i class="aj-radio"></i>
          <div class="aj-txt">
            <div class="aj-nome">${esc(m.nome)}${m.recomendado ? '<em>Recomendado</em>' : ''}<span class="aj-meta aj-dir">${tam}</span></div>
            <p>${esc(m.descricao)}</p>
            <span class="aj-status"><i class="aj-giro"></i>Baixando em segundo plano… ${sala.whisper_atual ? `o ${esc(sala.whisper_atual)} segue funcionando e a troca é automática` : ''}</span>
          </div>
        </button>`;
      }
      const ocupado = sel && (carregando || sala.whisper_atual !== m.nome);
      return `<button class="aj-opcao ${sel ? 'sel' : ''}" data-nome="${esc(m.nome)}" ${carregando && !sel ? 'disabled' : ''}>
        <i class="aj-radio"></i>
        <div class="aj-txt">
          <div class="aj-nome">${esc(m.nome)}${m.recomendado ? '<em>Recomendado</em>' : ''}
            <span class="aj-meta aj-dir">${m.baixado ? 'Baixado' : m.tamanho}</span></div>
          <p>${esc(m.descricao)}</p>
          ${ocupado ? `<span class="aj-status"><i class="aj-giro"></i>${esc(carregando ? sala.motor_detalhe : 'Na fila…')}</span>` : ''}
        </div>
      </button>`;
    }).join('');
  };

  const renderOllama = () => {
    const lista = $('[data-ollama]');
    const o = catalogo?.ollama;
    if (!o) { lista.innerHTML = `<p class="aj-vazio">${catalogo?.erro ? 'Não foi possível ler os modelos.' : 'Procurando modelos…'}</p>`; return; }
    if (!o.ok) { lista.innerHTML = `<p class="aj-vazio aj-erro">${esc(o.erro)}</p>`; return; }
    const atual = sala.ia_modelo || catalogo.ia_atual;
    const modelos = [...o.modelos];
    if (atual && !modelos.some(m => m.nome === atual || m.nome === atual + ':latest')) {
      modelos.unshift({ nome: atual, ausente: true });
    }
    if (!modelos.length) { lista.innerHTML = `<p class="aj-vazio">Nenhum modelo instalado. Rode <kbd>ollama pull gemma3:4b</kbd> e clique em Atualizar.</p>`; return; }
    lista.innerHTML = modelos.map(m => {
      const sel = m.nome === atual || m.nome === atual + ':latest';
      const [base, tag] = m.nome.split(':');
      const meta = m.ausente ? 'Não instalado — rode ollama pull ' + m.nome
        : [m.parametros, m.quantizacao, m.tamanho].filter(Boolean).join(' · ');
      let status = '';
      if (sel && (sala.ia === 'verificando' || sala.ia === 'pensando')) status = `<span class="aj-status"><i class="aj-giro"></i>${sala.ia === 'pensando' ? 'Analisando a conversa…' : 'Testando…'}</span>`;
      else if (sel && sala.ia === 'indisponivel' && sala.ia_detalhe) status = `<span class="aj-status aj-erro">${esc(sala.ia_detalhe)}</span>`;
      else if (m.embedding) status = `<span class="aj-meta">Modelo de embedding: não gera texto</span>`;
      return `<button class="aj-opcao ${sel ? 'sel' : ''} ${m.ausente ? 'ausente' : ''}" data-nome="${esc(m.nome)}" ${m.embedding || m.ausente ? 'disabled' : ''}>
        <i class="aj-radio"></i>
        <div class="aj-txt">
          <div class="aj-nome">${esc(base)}${tag && tag !== 'latest' ? `<span class="aj-tag">${esc(tag)}</span>` : ''}</div>
          <span class="aj-meta">${esc(meta)}</span>
          ${status}
        </div>
      </button>`;
    }).join('');
  };

  const renderCamera = () => {
    const b = $('[data-camera]');
    b.innerHTML = `${camera.ativa ? mini.camera : mini.cameraOff}<span>${camera.ativa ? 'Ligada' : 'Desligada'}</span>`;
    b.classList.toggle('ativo', camera.ativa);
    $('[data-medidor]').classList.toggle('off', !camera.ativa);
    if (!brincar) return;
    const g = $('[data-gestos]');
    g.innerHTML = `<span>${brincar.ativo ? 'Ligado' : 'Desligado'}</span>`;
    g.classList.toggle('ativo', brincar.ativo);
    const st = {
      carregando: '<i class="aj-giro"></i> Carregando o reconhecedor de mãos (só na primeira vez demora mais)…',
      pronto: brincar.presente ? '🖐️ Mão detectada agora — experimente um gesto!'
        : brincar.maos.distancia != null ? `🚶 Mão vista a ~${brincar.maos.distancia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m: chegue a menos de ${brincar.maos.distanciaMax.toLocaleString('pt-BR')} m para brincar.`
        : `Pronto. Mostre a mão para a câmera, a menos de ${brincar.maos.distanciaMax.toLocaleString('pt-BR')} m.`,
      erro: `Reconhecimento de mãos indisponível: ${esc(brincar.maos.erro || '')}`,
    }[brincar.estado];
    $('[data-gestos-status]').innerHTML = !brincar.ativo ? 'Os gestos estão desligados.'
      : !camera.ativa ? 'Ligue a câmera para brincar com as mãos.' : (st || '');
  };

  const renderIdioma = () => {
    const atual = pedidoIdioma || sala.idioma || 'pt';
    for (const b of dlg.querySelectorAll('[data-idioma] button')) {
      const sel = b.dataset.valor === atual;
      b.classList.toggle('sel', sel); b.setAttribute('aria-checked', sel);
    }
  };

  const AJUDA_ISOLAMENTO = {
    volume: 'Qualquer som bem acima do ruído de fundo vira uma frase para o Whisper: teclado, porta e cadeira também.',
    voz: 'Um detector de voz neural decide quando alguém fala: teclado, porta, cadeira e ar-condicionado são ignorados. Recomendado.',
    voz_ruido: 'Além do detector, um removedor de ruído neural limpa cada frase antes do Whisper. Ajuda com ruído contínuo; conversa ao fundo continua sendo voz.',
  };
  const renderIsolamento = () => {
    const atual = pedidoIsolamento || sala.isolamento || 'voz';
    for (const b of dlg.querySelectorAll('[data-isolamento] button')) {
      const sel = b.dataset.valor === atual;
      b.classList.toggle('sel', sel); b.setAttribute('aria-checked', sel);
    }
    $('[data-isolamento-ajuda]').innerHTML = `<b>Isolamento da voz.</b> ${AJUDA_ISOLAMENTO[atual]}`
      + (sala.isolamento_detalhe ? ` <em>(${esc(sala.isolamento_detalhe)})</em>` : '');
  };

  // Tela: Zak ou painel clássico. Vale para todas as telas e fica salvo; a página recarrega quando o servidor confirma.
  let pedidoTela = null;
  const renderTela = () => {
    const atual = pedidoTela || (modoZak ? 'zak' : 'classico');
    for (const b of dlg.querySelectorAll('[data-tela] button')) {
      const sel = b.dataset.valor === atual;
      b.classList.toggle('sel', sel); b.setAttribute('aria-checked', sel);
      b.disabled = !!pedidoTela;
    }
    $('[data-tela-ajuda]').innerHTML = pedidoTela ? '<i class="aj-giro"></i> Trocando de tela…'
      : modoZak ? 'O Zak atende <b>“Ei, Zak”</b> e mostra uma cena sobre o assunto da conversa. A escolha fica salva e vale para todas as telas.'
      : 'Os cards mostram o resumo da conversa da sala; o Zak não responde. A escolha fica salva e vale para todas as telas.';
  };
  $('[data-tela]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if ((b.dataset.valor === 'zak') === modoZak) return;
    pedidoTela = b.dataset.valor;
    enviar({ acao: 'tela_zak', valor: pedidoTela === 'zak' });
    renderTela();
  });

  const render = () => { if (!dlg.open) return; renderTela(); retorno.render(sala, catalogo?.microfones); renderIsolamento(); renderIdioma(); renderWhisper(); renderOllama(); renderCamera(); };

  // ── eventos ──────────────────────────────────────────────
  $('[data-isolamento]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pedidoIsolamento = b.dataset.valor;
    enviar({ acao: 'isolamento', valor: pedidoIsolamento });
    renderIsolamento();
  });
  $('[data-idioma]').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pedidoIdioma = b.dataset.valor;
    enviar({ acao: 'idioma', valor: pedidoIdioma });
    renderIdioma();
  });
  $('[data-whisper]').addEventListener('click', e => {
    const b = e.target.closest('.aj-opcao'); if (!b || b.disabled) return;
    const nome = b.dataset.nome;
    if (nome === sala.whisper_atual && sala.whisper_modelo !== 'auto') return;
    pedidoWhisper = nome;
    enviar({ acao: 'modelo_whisper', nome });
    render();
  });
  $('[data-ollama]').addEventListener('click', e => {
    const b = e.target.closest('.aj-opcao'); if (!b || b.disabled) return;
    enviar({ acao: 'modelo_ia', nome: b.dataset.nome });
  });
  $('[data-atualizar]').addEventListener('click', buscar);
  $('[data-camera]').addEventListener('click', async () => { await alternarCamera(); renderCamera(); });
  $('[data-gestos]').addEventListener('click', async () => { if (brincar) { const p = brincar.alternar(); renderCamera(); await p; renderCamera(); } });
  if (brincar) brincar.aoEstado = () => { if (dlg.open) renderCamera(); };
  $('.aj-fechar').addEventListener('click', () => dlg.close());

  // Sair: o primeiro clique pede confirmação; o segundo pede ao servidor para fechar a tela cheia e desligar
  let confirmarSair = 0;
  const botaoSair = $('.aj-sair');
  const rotuloSair = t => { botaoSair.querySelector('span').textContent = t; };
  botaoSair.addEventListener('click', () => {
    if (!confirmarSair) {
      botaoSair.classList.add('confirmar'); rotuloSair('Confirmar saída');
      confirmarSair = setTimeout(() => { confirmarSair = 0; botaoSair.classList.remove('confirmar'); rotuloSair('Sair'); }, 4000);
      return;
    }
    clearTimeout(confirmarSair);
    botaoSair.disabled = true; rotuloSair('Saindo…');
    enviar({ acao: 'sair' });
    // fora do modo quiosque (navegador comum) a janela não fecha sozinha: avisa que o painel foi desligado
    setTimeout(() => {
      try { window.close(); } catch { /* só fecha janelas abertas por script */ }
      dlg.close();
      document.body.insertAdjacentHTML('beforeend', '<div class="painel-desligado"><b>Painel desligado</b><span>Pode fechar esta janela. Para abrir de novo: iniciar.bat</span></div>');
    }, 2500);
  });
  dlg.addEventListener('close', () => retorno.fechar()); // para de ouvir e o servidor apaga as frases
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // clique fora fecha

  // medidor de movimento ao vivo (mostra que a câmera está funcionando)
  const barra = $('[data-medidor] i');
  // diagnóstico ao vivo: o que cada mão está fazendo e por que um gesto (não) dispara
  const NOMES = { Open_Palm: '✋ mão aberta', Closed_Fist: '✊ punho', Pointing_Up: '☝️ apontando', Thumb_Up: '👍 joinha',
    Thumb_Down: '👎 polegar para baixo', Victory: '✌️ paz e amor', ILoveYou: '🤟 te amo', None: '— sem gesto' };
  const diagnostico = () => {
    const ul = $('[data-gestos-diag]');
    const M = brincar?.maos;
    if (!M || !camera.ativa || !brincar.ativo || M.estado !== 'pronto') { ul.innerHTML = ''; return; }
    const t = M._tQuadro || 0;
    const maos = (M._rastreio || []).filter(m => t - m.visto < 300);
    if (!maos.length) { ul.innerHTML = '<li class="aj-meta">Nenhuma mão na imagem agora.</li>'; return; }
    const fmt = v => v.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
    ul.innerHTML = maos.map((m, i) => {
      const estado = !m.perto ? `<b class="aj-erro">longe demais</b> (a mais de ${fmt(M.distanciaMax)} m: ignorada)`
        : m.desenhando ? '<b>desenhando</b>'
        : m.carga > .05 ? `<b>carregando</b> ${Math.round(m.carga * 100)}%`
        : m.armado ? '<b>parada</b>: pronta para deslizar ou segurar um gesto'
        : 'em movimento (pare um instante para deslizar)';
      return `<li><span class="aj-diag-mao">Mão ${i + 1}${m.lado ? ` · ${m.lado === 'Left' ? 'esq.' : 'dir.'}` : ''}</span>
        <span>${NOMES[m.gesto] || m.gesto}${m.metros ? ` · ~${fmt(m.metros)} m` : ''}</span>
        <span class="aj-meta">${estado}</span></li>`;
    }).join('') + (M.msAnalise ? `<li class="aj-meta">Análise: ${Math.round(1000 / Math.max(33, M.msAnalise))} quadros/s (${Math.round(M.msAnalise)} ms cada)</li>` : '');
  };

  const medir = () => {
    if (!dlg.open) return;
    barra.style.transform = `scaleX(${camera.ativa ? Math.min(1, camera.movimento * 3).toFixed(3) : 0})`;
    // atualiza o status quando a mão aparece/some ou a distância muda (de 10 em 10 cm)
    const chave = `${!!brincar?.presente}|${brincar?.maos.distancia == null ? '' : Math.round(brincar.maos.distancia * 10)}`;
    if (chave !== medir.chave) { medir.chave = chave; renderCamera(); }
    const agora = performance.now();
    if (agora - (medir.diagEm || 0) > 250) { medir.diagEm = agora; diagnostico(); }
    requestAnimationFrame(medir);
  };

  const abrir = () => {
    if (dlg.open) return;
    dlg.showModal();
    dlg.focus(); // sem anel de foco no botão fechar ao abrir
    render(); buscar(); requestAnimationFrame(medir);
    if (catalogo?.audio !== false) retorno.abrir();
  };
  bus.on('abrir-ajustes', abrir);

  // ── Zak ──────────────────────────────────────────────────
  let zak = null;
  const renderZak = () => {
    if (!zak) return;
    $('[data-zak-secao]').hidden = false;
    const b = $('[data-zak-protecao]');
    b.textContent = zak.protecao ? 'Ligada' : 'Desligada';
    b.classList.toggle('ativo', !!zak.protecao);
    const voz = { pronta: 'voz pronta', carregando: 'carregando a voz…', erro: 'sem voz', desligada: 'voz desligada' }[zak.voz] || '';
    const img = zak.imagem ? ` · imagens: ${zak.imagem}` : '';
    $('[data-zak-sub]').textContent = voz + img;
    $('[data-zak-sub]').title = [zak.voz_detalhe, zak.imagem_detalhe].filter(Boolean).join(' · ');
  };
  $('[data-zak-protecao]').addEventListener('click', () => {
    if (!zak) return;
    zak.protecao = !zak.protecao;
    enviar({ acao: 'zak_protecao', valor: zak.protecao });
    renderZak();
  });

  return {
    abrir,
    get aberto() { return dlg.open; },
    zak(msg) { zak = { ...zak, ...msg }; renderZak(); },
    estado(msg) {
      const antes = sala.estado;
      sala = { ...sala, ...msg };
      if (pedidoWhisper && sala.whisper_modelo === pedidoWhisper) pedidoWhisper = null; // servidor confirmou
      if (pedidoIdioma && sala.idioma === pedidoIdioma) pedidoIdioma = null;
      if (pedidoIsolamento && sala.isolamento === pedidoIsolamento) pedidoIsolamento = null;
      if (antes === 'carregando' && sala.estado !== 'carregando' && dlg.open) buscar(); // atualiza "Baixado"
      render();
    },
  };
}
