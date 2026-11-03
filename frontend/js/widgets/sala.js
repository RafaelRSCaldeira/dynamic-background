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
      <p class="sala-resumo vazio">Quando houver conversa na sala, os destaques aparecem aqui.</p>
      <div class="sala-topicos"></div>
      <div class="sala-cards"></div>
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
  const cardsVistos = new Set();

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
    const ins = estado.insights;
    const resumo = $('.sala-resumo');
    if (ins?.resumo) { resumo.textContent = ins.resumo; resumo.classList.remove('vazio'); }
    else {
      resumo.classList.add('vazio');
      resumo.textContent = estado.ia === 'indisponivel' && estado.ia_detalhe ? `IA local indisponível: ${estado.ia_detalhe}` : 'Quando houver conversa na sala, os destaques aparecem aqui.';
    }
    $('.sala-topicos').innerHTML = (ins?.topicos || []).map((t, i) => `<span class="topico" style="--j:${i}">${esc(t)}</span>`).join('');
    $('.sala-cards').innerHTML = (ins?.cards || []).map((c, i) => {
      const chave = c.tipo + c.titulo;
      const novo = !cardsVistos.has(chave); cardsVistos.add(chave);
      return `<article class="insight tipo-${c.tipo} ${novo ? 'novo' : ''}" style="--j:${i}">
        <div class="insight-ic">${mini[c.tipo] || mini.contexto}</div>
        <div><small>${TIPOS[c.tipo] || ''}</small><h4>${esc(c.titulo)}</h4><p>${esc(c.texto)}</p></div>
      </article>`;
    }).join('');

    const linhas = (estado.linhas || []).slice(-2);
    el.classList.toggle('com-conteudo', !!(ins?.resumo || ins?.cards?.length));
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
    const cor = getComputedStyle(el).getPropertyValue('--cor-onda').trim() || '#7dd3fc';
    ctx.fillStyle = cor;
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
