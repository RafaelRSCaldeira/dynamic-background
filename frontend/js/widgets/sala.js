// "Sala": estado do microfone, botão de mute, onda de voz, resumo e cards gerados pela IA local.
import { esc, relativo, bus } from '../util.js';
import { mini } from '../icones.js';

const ESTADOS = {
  ouvindo:    ['Ouvindo', 'ok'],
  mutado:     ['Mutado', 'perigo'],
  auto:       ['Mutado automaticamente', 'alerta'],
  carregando: ['Carregando modelo de voz…', 'info'],
  iniciando:  ['Iniciando…', 'info'],
  erro:       ['Microfone indisponível', 'perigo'],
  desativado: ['Áudio desativado', 'neutro'],
  offline:    ['Sem conexão com o servidor', 'neutro'],
};
const TIPOS = { contexto: 'Contexto', curiosidade: 'Curiosidade', tarefa: 'Lembrete', pergunta: 'Resposta' };

export function iniciar(el, { enviar }) {
  el.innerHTML = `
    <header class="sala-topo">
      <div class="rotulo">${mini.sala}<span>Sala</span></div>
      <div class="sala-estado"><i class="ponto"></i><span></span></div>
      <button class="sala-mute" title="Mutar / ativar microfone (M)"></button>
    </header>
    <div class="sala-onda"><canvas></canvas><div class="sala-privado">${mini.micOff}<span>Privacidade ativa — nada está sendo ouvido</span></div></div>
    <div class="sala-corpo">
      <div class="sala-feed" tabindex="0" aria-label="Destaques da conversa. Arraste para cima ou para baixo para ler.">
        <ol class="sala-lista" aria-live="polite"></ol>
      </div>
      <button class="sala-novos" hidden></button>
      <p class="sala-resumo vazio">Quando houver conversa na sala, os destaques aparecem aqui.</p>
      <ul class="sala-dicas">
        <li>${mini.sala}<span><b>Tudo local.</b> A voz é transcrita pelo Whisper e analisada pela IA neste computador.</span></li>
        <li>${mini.borracha}<span><b>Nada é gravado.</b> O texto fica só na memória e é apagado sozinho depois de alguns minutos.</span></li>
        <li>${mini.micOff}<span><b>Conversa privada?</b> Toque em Mutar, aperte <kbd>M</kbd> ou use o celular em <kbd>/remote</kbd>.</span></li>
      </ul>
    </div>
    <div class="sala-ao-vivo"></div>
    <footer class="sala-rodape">
      <button class="sala-ia" title="Trocar modelos (A)"></button>
      <button class="sala-esquecer" title="Apaga a transcrição e os destaques da memória">${mini.borracha}<span>Esquecer</span></button>
    </footer>`;

  const $ = s => el.querySelector(s);
  const botao = $('.sala-mute'), canvas = $('.sala-onda canvas'), ctx = canvas.getContext('2d');
  let estado = { estado: 'offline' }, conectado = false, nivel = 0, alvoNivel = 0;
  const historico = new Float32Array(72);
  const feed = $('.sala-feed'), lista = $('.sala-lista'), novos = $('.sala-novos');
  const mostrados = new Set();
  let naoLidos = 0, mexeuEm = 0;
  arrastavel(feed, () => { mexeuEm = performance.now(); });
  feed.addEventListener('scroll', () => {
    if (feed.scrollTop < 8 && naoLidos) { naoLidos = 0; novos.hidden = true; }
  }, { passive: true });
  const irParaTopo = () => { feed.scrollTo({ top: 0, behavior: 'smooth' }); naoLidos = 0; novos.hidden = true; };
  novos.addEventListener('click', irParaTopo);
  // quem rolou para ler e largou: depois de um minuto parado, volta sozinho para o mais recente
  setInterval(() => { if (feed.scrollTop > 8 && performance.now() - mexeuEm > 60e3) irParaTopo(); }, 5e3);
  bus.on('rolar-sala', dir => {   // gesto: mão para cima/baixo rola a lista
    mexeuEm = performance.now();
    feed.scrollBy({ top: -dir * feed.clientHeight * .7, behavior: 'smooth' });
  });

  const hora = t => new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const itemHTML = h => h.tipo === 'resumo'
    ? `<li class="item item-resumo" data-id="${h.id}">
        <time>${hora(h.t)}</time>
        <p>${esc(h.texto)}</p>
        ${h.topicos?.length ? `<div class="sala-topicos">${h.topicos.map((t, i) => `<span class="topico" style="--j:${i}">${esc(t)}</span>`).join('')}</div>` : ''}
      </li>`
    : `<li class="item insight tipo-${esc(h.tipo)}" data-id="${h.id}">
        <div class="insight-ic">${mini[h.tipo] || mini.contexto}</div>
        <div><small>${TIPOS[h.tipo] || ''}<time>${hora(h.t)}</time></small><h4>${esc(h.titulo)}</h4><p>${esc(h.texto)}</p></div>
      </li>`;

  // a lista só cresce: itens novos entram no topo e os antigos ficam (sem re-renderizar nem pular a leitura)
  const renderLista = itens => {
    const validos = new Set(itens.map(h => h.id));
    for (const li of [...lista.children]) if (!validos.has(+li.dataset.id)) { mostrados.delete(+li.dataset.id); li.remove(); }
    if (!itens.length) { naoLidos = 0; novos.hidden = true; return; }
    const ordem = (a, b) => b.t - a.t || (a.tipo === 'resumo' ? -1 : b.tipo === 'resumo' ? 1 : a.id - b.id);
    const chegaram = itens.filter(h => !mostrados.has(h.id)).sort(ordem);
    if (!chegaram.length) return;
    const primeiraVez = !mostrados.size;
    const lendo = feed.scrollTop > 8, alturaAntes = feed.scrollHeight;
    lista.insertAdjacentHTML('afterbegin', chegaram.map(itemHTML).join(''));
    chegaram.forEach((h, i) => {
      mostrados.add(h.id);
      const li = lista.querySelector(`[data-id="${h.id}"]`);
      if (!primeiraVez) { li.classList.add('novo'); li.style.setProperty('--j', i); }
    });
    lista.querySelectorAll('.item-resumo.atual').forEach(li => li.classList.remove('atual'));
    lista.querySelector('.item-resumo')?.classList.add('atual');
    if (lendo) {   // mantém no lugar o que a pessoa está lendo e avisa que chegou coisa nova
      feed.scrollTop += feed.scrollHeight - alturaAntes;
      naoLidos += chegaram.length;
      novos.hidden = false;
      novos.textContent = `↑ ${naoLidos} ${naoLidos === 1 ? 'novo' : 'novos'}`;
    }
  };

  botao.addEventListener('click', () => enviar({ acao: 'mute' }));
  $('.sala-ia').addEventListener('click', () => bus.emit('abrir-ajustes'));
  $('.sala-esquecer').addEventListener('click', () => {
    enviar({ acao: 'esquecer' });
    el.classList.add('apagando'); setTimeout(() => el.classList.remove('apagando'), 700);
  });

  const render = () => {
    const nome = conectado ? estado.estado : 'offline';
    const [texto, cls] = ESTADOS[nome] || [nome, 'neutro'];
    el.dataset.estado = nome;
    $('.sala-estado').className = `sala-estado tom-${cls}`;
    $('.sala-estado span').textContent = nome === 'auto' && estado.motivo_auto ? `Mutado · ${estado.motivo_auto}` : texto;
    $('.sala-estado').title = estado.motor_detalhe || '';
    const mutado = !!estado.mutado_manual;
    botao.innerHTML = `${mutado ? mini.micOff : mini.mic}<span>${mutado ? 'Ativar' : 'Mutar'}</span>`;
    botao.classList.toggle('ativo', mutado);
    botao.disabled = !conectado || nome === 'desativado';
    el.classList.toggle('privado', !!estado.mutado || !conectado || nome === 'desativado');

    if (!('insights' in estado)) return; // cliente remoto: só estado
    const itens = estado.historico || [];
    renderLista(itens);
    $('.sala-resumo').textContent = estado.ia === 'indisponivel' && estado.ia_detalhe
      ? `IA local indisponível: ${estado.ia_detalhe}` : 'Quando houver conversa na sala, os destaques aparecem aqui.';

    const linhas = (estado.linhas || []).slice(-2);
    el.classList.toggle('com-conteudo', itens.length > 0);
    $('.sala-ao-vivo').innerHTML = linhas.map(l => `<p>“${esc(l.texto)}”</p>`).join('');
    atualizarIA();
  };

  const atualizarIA = () => {
    const ia = estado.ia;
    let t = '';
    if (ia === 'pensando') t = `<i class="ponto pulsa"></i> Analisando a conversa…`;
    else if (ia === 'indisponivel') t = `IA local offline · ${esc(estado.ia_modelo || '')}`;
    else if (estado.insights_em) t = `${esc(estado.ia_modelo || 'IA local')} · ${relativo(Date.now() / 1000 - estado.insights_em)}`;
    else if (ia === 'pronta') t = `${esc(estado.ia_modelo || 'IA local')} · pronta`;
    $('.sala-ia').innerHTML = t;
  };
  setInterval(atualizarIA, 15000);

  // onda de voz (barras espelhadas)
  const ajustar = () => {
    const d = Math.min(devicePixelRatio || 1, 2);
    canvas.width = canvas.clientWidth * d; canvas.height = canvas.clientHeight * d;
  };
  new ResizeObserver(ajustar).observe(canvas);
  let acumulado = 0, anterior = performance.now();
  const desenhar = agora => {
    requestAnimationFrame(desenhar);
    const dt = (agora - anterior) / 1000; anterior = agora;
    nivel += (alvoNivel - nivel) * Math.min(1, dt * 14);
    acumulado += dt;
    if (acumulado > .05) { acumulado = 0; historico.copyWithin(0, 1); historico[historico.length - 1] = el.classList.contains('privado') ? 0 : nivel; }
    const W = canvas.width, H = canvas.height; if (!W || !H) return;
    ctx.clearRect(0, 0, W, H);
    const n = historico.length, gap = W / n, bw = Math.max(1.5, gap * .45);
    if (agora - (desenhar.corEm || 0) > 1000) {   // ler o CSS a cada quadro força recalcular o estilo da página
      desenhar.corEm = agora;
      desenhar.cor = getComputedStyle(el).getPropertyValue('--cor-onda').trim() || '#7dd3fc';
    }
    ctx.fillStyle = desenhar.cor;
    for (let i = 0; i < n; i++) {
      const v = historico[i], h = Math.max(bw, v * H * .9);
      ctx.globalAlpha = .25 + .75 * (i / n);
      const x = i * gap + (gap - bw) / 2, y = (H - h) / 2;
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, bw, h, bw / 2) : ctx.rect(x, y, bw, h); ctx.fill();
    }
  };
  requestAnimationFrame(desenhar);

  return {
    estado(d) { estado = { ...estado, ...d }; render(); },
    conexao(ok) { conectado = ok; if (!ok) alvoNivel = 0; render(); },
    nivel(v) { alvoNivel = v; bus.emit('voz', v); },
  };
}

/** Rolar arrastando com o mouse (no toque, o navegador já faz), com inércia ao soltar. */
function arrastavel(el, aoMexer) {
  let ini = null, vel = 0, ultY = 0, ultT = 0, raf = 0, arrastou = false;
  el.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    cancelAnimationFrame(raf);
    ini = { y: e.clientY, top: el.scrollTop }; ultY = e.clientY; ultT = e.timeStamp; vel = 0; arrastou = false;
    aoMexer();
  });
  el.addEventListener('pointermove', e => {
    if (!ini) return;
    const dy = e.clientY - ini.y;
    if (!arrastou && Math.abs(dy) > 5) { arrastou = true; el.setPointerCapture(e.pointerId); el.classList.add('arrastando'); }
    if (!arrastou) return;
    el.scrollTop = ini.top - dy;
    const dt = e.timeStamp - ultT;
    if (dt > 0) vel = .75 * ((ultY - e.clientY) / dt) + .25 * vel;   // px/ms
    ultY = e.clientY; ultT = e.timeStamp;
    aoMexer();
  });
  const soltar = e => {
    if (!ini) return;
    ini = null; el.classList.remove('arrastando');
    if (!arrastou || e.timeStamp - ultT > 80) return;   // parou antes de soltar: sem inércia
    let v = vel * 16, ant = performance.now();
    const passo = t => {
      const k = Math.min(3, (t - ant) / 16); ant = t;
      el.scrollTop += v * k; v *= Math.pow(.95, k);
      if (Math.abs(v) > .4) raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
  };
  el.addEventListener('pointerup', soltar);
  el.addEventListener('pointercancel', soltar);
  el.addEventListener('wheel', () => { cancelAnimationFrame(raf); aoMexer(); }, { passive: true });
  el.addEventListener('click', e => { if (arrastou) { e.stopPropagation(); e.preventDefault(); arrastou = false; } }, true);
}
