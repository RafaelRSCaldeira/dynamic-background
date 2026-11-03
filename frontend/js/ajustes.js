// Painel de Ajustes: escolhe o modelo de transcrição (Whisper) e a IA da sala (qualquer modelo do Ollama),
// e mostra o que a câmera está detectando. Abre pelo botão ⚙, pela tecla A ou clicando no nome do modelo na Sala.
import { getJSON } from './api.js';
import { esc, bus } from './util.js';
import { mini } from './icones.js';

export function iniciarAjustes({ enviar, camera, alternarCamera, ociosidadeMin = 5 }) {
  const dlg = document.createElement('dialog');
  dlg.id = 'ajustes';
  dlg.setAttribute('aria-label', 'Ajustes');
  dlg.tabIndex = -1;
  dlg.innerHTML = `
    <header class="aj-topo">
      <h2>${mini.ajustes}<span>Ajustes</span></h2>
      <button class="aj-fechar ctl" title="Fechar (Esc)">${mini.fechar}</button>
    </header>
    <div class="aj-rolagem">
      <section class="aj-secao">
        <div class="aj-titulo"><h3>Transcrição da fala</h3><span class="aj-sub" data-whisper-sub></span></div>
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
        <p class="aj-ajuda">Ela só detecta <b>movimento</b> (64×48 px em tons de cinza, dentro do navegador; nenhuma imagem sai daqui):</p>
        <ul class="aj-itens">
          <li>Quem se mexe na frente da tela vira um segundo "ponteiro": a aurora gira e as partículas se afastam naquele ponto.</li>
          <li>Um aceno amplo (braço inteiro) solta uma onda, como um clique.</li>
          <li>Sem ninguém se mexendo por <b>${ociosidadeMin} min</b>, o painel entra em <b>modo ambiente</b> e fica discreto. Volta quando alguém aparece.</li>
        </ul>
        <div class="aj-medidor" data-medidor><span>Movimento agora</span><div><i></i></div></div>
      </section>
    </div>`;
  document.body.append(dlg);
  const $ = s => dlg.querySelector(s);

  let sala = {}, catalogo = null, buscando = false, pedidoWhisper = null;

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
  };

  const render = () => { if (!dlg.open) return; renderWhisper(); renderOllama(); renderCamera(); };

  // ── eventos ──────────────────────────────────────────────
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
  $('.aj-fechar').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); }); // clique fora fecha

  // medidor de movimento ao vivo (mostra que a câmera está funcionando)
  const barra = $('[data-medidor] i');
  const medir = () => {
    if (!dlg.open) return;
    barra.style.transform = `scaleX(${camera.ativa ? Math.min(1, camera.movimento * 3).toFixed(3) : 0})`;
    requestAnimationFrame(medir);
  };

  const abrir = () => {
    if (dlg.open) return;
    dlg.showModal();
    dlg.focus(); // sem anel de foco no botão fechar ao abrir
    render(); buscar(); requestAnimationFrame(medir);
  };
  bus.on('abrir-ajustes', abrir);

  return {
    abrir,
    get aberto() { return dlg.open; },
    estado(msg) {
      const antes = sala.estado;
      sala = { ...sala, ...msg };
      if (pedidoWhisper && sala.whisper_modelo === pedidoWhisper) pedidoWhisper = null; // servidor confirmou
      if (antes === 'carregando' && sala.estado !== 'carregando' && dlg.open) buscar(); // atualiza "Baixado"
      render();
    },
  };
}
