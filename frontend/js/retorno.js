// Retorno do microfone (seção dos Ajustes). Serve para descobrir se a transcrição erra por causa do áudio:
//  - escolher o microfone;
//  - medidor de volume real (dBFS);
//  - ouvir ao vivo o que o microfone capta (use fone de ouvido);
//  - ouvir de novo cada frase EXATAMENTE como chegou ao Whisper, ao lado do que ele entendeu.
// Só conecta enquanto os Ajustes estão abertos; ao fechar, o servidor apaga as frases guardadas.
import { esc } from './util.js';
import { mini } from './icones.js';

const PISO_DB = -60;
const fmtN = (v, casas = 1) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas });

export function criarRetorno(el, { enviar }) {
  el.innerHTML = `
    <div class="aj-lista" data-mics></div>
    <div class="rt-nivel" data-nivel>
      <div class="rt-barra"><i data-rms></i><b data-pico></b><span class="rt-zona" style="left:${(1 - 30 / -PISO_DB) * 100}%"></span></div>
      <span class="rt-db" data-db>—</span>
    </div>
    <p class="aj-ajuda rt-dica" data-dica>Fale normalmente: a barra deve passar da marca do meio sem encostar no fim.</p>
    <div class="rt-ganho">
      <span>Ganho</span>
      <input type="range" min="-12" max="24" step="1" value="0" data-ganho aria-label="Ganho do microfone em dB">
      <output data-ganho-v>0 dB</output>
      <button class="aj-mini" data-ganho-zero title="Voltar para 0 dB">Zerar</button>
    </div>
    <div class="rt-vivo">
      <button class="aj-mini" data-vivo>${mini.fone}<span>Ouvir ao vivo</span></button>
      <label class="rt-volume"><span>Volume</span><input type="range" min="0" max="4" step="0.1" value="1" data-volume></label>
    </div>
    <p class="aj-ajuda rt-aviso" data-aviso hidden>🎧 Use <b>fone de ouvido</b>. Na caixa de som, o microfone capta o próprio retorno e dá microfonia. Há um atraso de ~0,2 s.</p>
    <div class="aj-titulo rt-cab"><h3>O que o Whisper ouviu</h3><span class="aj-sub" data-qtd></span></div>
    <p class="aj-ajuda">As últimas frases, exatamente como chegaram à transcrição (16 kHz, com o ganho automático), ao lado do texto que saiu.
      Ficam só na memória e são apagadas quando os Ajustes fecham.</p>
    <ul class="rt-frases" data-frases><li class="aj-vazio">Fale alguma coisa perto do microfone…</li></ul>`;
  const $ = s => el.querySelector(s);

  let ws = null, info = {}, frases = [], vivo = false, ctx = null, ganho = null, proximo = 0;
  let audio = null, tocando = 0, pico = -99, picoEm = 0;

  // ── conexão ──────────────────────────────────────────────
  const conectar = () => {
    if (ws) return;
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/retorno`);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { if (vivo) ws.send(JSON.stringify({ acao: 'ao_vivo', valor: true })); };
    ws.onmessage = e => {
      if (e.data instanceof ArrayBuffer) return tocarVivo(e.data);
      receber(JSON.parse(e.data));
    };
    const meu = ws;
    ws.onclose = () => { if (ws === meu) ws = null; };   // um socket antigo fechando não apaga o novo
  };

  const receber = m => {
    if (m.tipo === 'nivel') medir(m);
    else if (m.tipo === 'info') { info = m; }
    else if (m.tipo === 'frase') { frases = [m, ...frases.filter(f => f.id !== m.id)].slice(0, 6); renderFrases(); }
    else if (m.tipo === 'limpo') { frases = []; renderFrases(); }
  };

  const desconectar = () => {
    definirVivo(false);
    pararFrase();
    ws?.close(); ws = null;
    frases = []; renderFrases();
    medir(null);
  };

  // ── medidor ──────────────────────────────────────────────
  const pos = db => Math.max(0, Math.min(1, 1 - db / PISO_DB));
  const medir = m => {
    if (!m) { $('[data-rms]').style.transform = 'scaleX(0)'; $('[data-db]').textContent = '—'; return; }
    const agora = performance.now();
    if (m.pico > pico || agora - picoEm > 1500) { pico = m.pico; picoEm = agora; }
    $('[data-rms]').style.transform = `scaleX(${pos(m.rms).toFixed(3)})`;
    $('[data-pico]').style.left = `${(pos(pico) * 100).toFixed(1)}%`;
    $('[data-db]').textContent = `${fmtN(m.rms, 0)} dB`;
    $('[data-nivel]').classList.toggle('estouro', pico > -1);
  };

  // ── ao vivo ──────────────────────────────────────────────
  const definirVivo = v => {
    vivo = v;
    $('[data-vivo]').classList.toggle('ativo', v);
    $('[data-vivo] span').textContent = v ? 'Ouvindo ao vivo' : 'Ouvir ao vivo';
    $('[data-aviso]').hidden = !v;
    if (v) {
      ctx ??= new AudioContext();
      ctx.resume();
      if (!ganho) { ganho = ctx.createGain(); ganho.connect(ctx.destination); }
      ganho.gain.value = +$('[data-volume]').value;
      proximo = 0;
    } else ctx?.suspend();
    if (ws?.readyState === 1) ws.send(JSON.stringify({ acao: 'ao_vivo', valor: v }));
  };

  const tocarVivo = dados => {
    if (!vivo || !ctx || !info.taxa) return;
    const i16 = new Int16Array(dados);
    const buf = ctx.createBuffer(1, i16.length, info.taxa), canal = buf.getChannelData(0);
    for (let i = 0; i < i16.length; i++) canal[i] = i16[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ganho);
    const agora = ctx.currentTime;
    // pequeno colchão contra oscilações da rede; se o atraso crescer demais, recomeça
    if (proximo < agora + .02 || proximo > agora + .6) proximo = agora + .15;
    src.start(proximo);
    proximo += buf.duration;
  };

  $('[data-vivo]').addEventListener('click', () => definirVivo(!vivo));

  // ── ganho do microfone (aplicado no servidor, antes da detecção de fala e do Whisper) ──
  const ganhoEl = $('[data-ganho]');
  let arrastandoGanho = false, tGanho = 0;
  const mostrarGanho = db => {
    $('[data-ganho-v]').textContent = `${db > 0 ? '+' : ''}${db} dB`;
    ganhoEl.style.setProperty('--p', `${((db + 12) / 36) * 100}%`);
  };
  const enviarGanho = () => enviar({ acao: 'ganho_mic', db: +ganhoEl.value });
  ganhoEl.addEventListener('input', () => {
    arrastandoGanho = true; mostrarGanho(+ganhoEl.value);
    clearTimeout(tGanho); tGanho = setTimeout(enviarGanho, 120);   // ouve a mudança enquanto arrasta
  });
  ganhoEl.addEventListener('change', () => { arrastandoGanho = false; enviarGanho(); });
  $('[data-ganho-zero]').addEventListener('click', () => { ganhoEl.value = 0; mostrarGanho(0); enviarGanho(); });
  $('[data-volume]').addEventListener('input', e => { if (ganho) ganho.gain.value = +e.target.value; if (audio) audio.volume = Math.min(1, +e.target.value); });

  // ── frases ───────────────────────────────────────────────
  const pararFrase = () => { audio?.pause(); audio = null; tocando = 0; };

  const avisos = f => {
    const a = [];
    if (f.pico_db > -1) a.push(['ruim', 'Saturado: o som está estourando. Diminua o ganho aqui em cima (ou o volume do microfone no Windows).']);
    else if (f.pico_db < -32) a.push(['ruim', `Muito baixo (pico ${fmtN(f.pico_db, 0)} dB): fale mais perto ou aumente o ganho aqui em cima.`]);
    else if (f.pico_db < -22) a.push(['meio', 'Um pouco baixo: o ganho automático compensa, mas também amplifica o ruído.']);
    if (!f.texto && !f.descartes?.length) a.push(['meio', 'Nada reconhecido: o detector de voz achou que era só ruído.']);
    return a;
  };

  const renderFrases = () => {
    const ul = $('[data-frases]');
    $('[data-qtd]').textContent = frases.length ? `${frases.length} de 6` : '';
    if (!frases.length) { ul.innerHTML = '<li class="aj-vazio">Fale alguma coisa perto do microfone…</li>'; return; }
    ul.innerHTML = frases.map(f => `
      <li class="rt-frase ${f.id === tocando ? 'tocando' : ''}">
        <button class="rt-play" data-id="${f.id}" title="${f.id === tocando ? 'Parar' : 'Ouvir como o Whisper ouviu'}">${f.id === tocando ? mini.parar : mini.tocar}</button>
        <div class="rt-corpo">
          <p class="rt-texto ${f.texto ? '' : 'vazio'}">${f.texto ? esc(f.texto) : '(nada entrou na transcrição)'}</p>
          <span class="aj-meta">${fmtN(f.duracao)} s · pico ${fmtN(f.pico_db, 0)} dB · ganho ${fmtN(f.ganho)}× · ${esc(f.modelo)} em ${fmtN(f.ms / 1000)} s</span>
          ${(f.descartes || []).map(d => `<span class="aj-meta rt-descarte">Descartado: ${esc(d)}</span>`).join('')}
          ${avisos(f).map(([n, t]) => `<span class="rt-alerta ${n}">${esc(t)}</span>`).join('')}
        </div>
      </li>`).join('');
  };

  $('[data-frases]').addEventListener('click', e => {
    const b = e.target.closest('.rt-play'); if (!b) return;
    const id = +b.dataset.id;
    if (tocando === id) { pararFrase(); renderFrases(); return; }
    pararFrase();
    audio = new Audio(`/api/retorno/${id}.wav`);
    audio.volume = Math.min(1, +$('[data-volume]').value);
    tocando = id;
    audio.onended = audio.onerror = () => { if (tocando === id) { tocando = 0; audio = null; renderFrases(); } };
    audio.play().catch(() => { tocando = 0; renderFrases(); });
    renderFrases();
  });

  // ── microfones ───────────────────────────────────────────
  let mics = [];
  const renderMics = sala => {
    const lista = $('[data-mics]');
    const pedido = (sala.microfone || '').toLowerCase();
    const escolhido = pedido ? mics.find(m => m.nome.toLowerCase().includes(pedido))?.nome ?? null : '';
    const padrao = mics.find(m => m.padrao);
    const opcoes = [{ nome: '', rotulo: 'Padrão do Windows', sub: padrao ? padrao.nome : '' },
      ...mics.map(m => ({ nome: m.nome, rotulo: m.nome, sub: `${fmtN(m.taxa / 1000)} kHz` }))];
    if (pedido && escolhido === null) opcoes.push({ nome: sala.microfone, rotulo: sala.microfone, sub: 'Não encontrado — usando o padrão', ausente: true });
    const atual = sala.microfone_atual ? `<span class="aj-status">Aberto agora: ${esc(sala.microfone_atual)}${sala.microfone_taxa ? ` · ${fmtN(sala.microfone_taxa / 1000)} kHz` : ''}</span>` : '';
    lista.innerHTML = opcoes.map(o => {
      const sel = o.ausente || o.nome === (escolhido ?? '');
      return `<button class="aj-opcao ${sel ? 'sel' : ''}" data-mic="${esc(o.nome)}">
        <i class="aj-radio"></i>
        <div class="aj-txt">
          <div class="aj-nome">${esc(o.rotulo)}</div>
          ${o.sub ? `<span class="aj-meta ${o.ausente ? 'aj-erro' : ''}">${esc(o.sub)}</span>` : ''}
          ${sel ? atual : ''}
        </div>
      </button>`;
    }).join('') || '<p class="aj-vazio">Nenhum microfone encontrado.</p>';
  };

  $('[data-mics]').addEventListener('click', e => {
    const b = e.target.closest('.aj-opcao'); if (!b) return;
    enviar({ acao: 'microfone', nome: b.dataset.mic });
  });

  return {
    abrir: conectar,
    receber,   // (para testes: /?debug expõe window.__retorno)
    fechar: desconectar,
    render(sala, lista) {
      if (lista) mics = lista;
      renderMics(sala);
      if (!arrastandoGanho && sala.ganho_db != null && +ganhoEl.value !== sala.ganho_db) { ganhoEl.value = sala.ganho_db; }
      if (!arrastandoGanho) mostrarGanho(+ganhoEl.value);
    },
  };
}
