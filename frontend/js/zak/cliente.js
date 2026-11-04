// Liga a tela ao Zak do servidor: cenas, estado do orbe, voz (com legenda no ritmo do áudio),
// música, timers e o campo para digitar um pedido (tecla Z ou clique no orbe).
import { esc } from '../util.js';
import { mini } from '../icones.js';

const fmtResta = s => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};

export function iniciarZak({ palco, presenca, enviar, tocarAlarme, aoEstado }) {
  let estado = {}, ctx = null, analisador = null, falaId = 0, fila = Promise.resolve(), fontes = [], tocando = false;
  let partesTocadas = 0, partesTotal = 0;

  // ── voz: as partes chegam uma a uma e tocam em sequência, sem buraco entre elas ──
  const audio = () => {
    if (!ctx) {
      ctx = new AudioContext();
      analisador = ctx.createAnalyser();
      analisador.fftSize = 512;
      analisador.connect(ctx.destination);
      const buf = new Float32Array(analisador.fftSize);
      const medir = () => {   // nível da voz → orbe pulsa junto
        requestAnimationFrame(medir);
        if (!tocando) return;
        analisador.getFloatTimeDomainData(buf);
        let s = 0; for (const v of buf) s += v * v;
        presenca.nivel(Math.min(1, Math.sqrt(s / buf.length) * 5));
      };
      requestAnimationFrame(medir);
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  };
  // sem o flag de autoplay do modo quiosque, o navegador só libera o som depois de um toque/tecla
  for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, () => { if (ctx?.state === 'suspended') ctx.resume(); }, { passive: true });

  let proximo = 0;
  const tocarParte = (id, msg) => {
    fila = fila.then(async () => {
      if (id !== falaId) return;
      const falhou = () => { if (msg.ultima && id === falaId) terminar(); };   // nunca deixa o servidor achando que ainda fala
      let dados;
      try { dados = await (await fetch(msg.url)).arrayBuffer(); } catch { falhou(); return; }
      const c = audio();
      let buffer;
      try { buffer = await c.decodeAudioData(dados); } catch { falhou(); return; }
      if (id !== falaId) return;
      const fonte = c.createBufferSource();
      fonte.buffer = buffer;
      fonte.connect(analisador);
      const inicio = Math.max(c.currentTime + .05, proximo);
      proximo = inicio + buffer.duration;
      fonte.start(inicio);
      fontes.push(fonte);
      const atraso = (inicio - c.currentTime) * 1000;
      setTimeout(() => {
        if (id !== falaId) return;
        if (!tocando) { tocando = true; enviar({ acao: 'zak_tocando', valor: true }); musicaAbaixar(true); }
        presenca.revelar(msg.texto, buffer.duration * 1000);
      }, atraso);
      fonte.onended = () => {
        fontes = fontes.filter(f => f !== fonte);
        partesTocadas++;
        if (id === falaId && msg.ultima) terminar();
      };
    });
  };
  const terminar = () => {
    if (tocando) enviar({ acao: 'zak_tocando', valor: false });
    tocando = false; musicaAbaixar(false);
    presenca.fimFala();
  };
  const calar = () => {
    falaId = -1;
    for (const f of fontes) try { f.stop(); } catch { /* já parou */ }
    fontes = []; proximo = 0;
    terminar();
  };

  // ── música (rádio online) ──
  const radio = Object.assign(new Audio(), { preload: 'none', crossOrigin: 'anonymous' });
  let volume = .5, abaixada = false;
  const aplicarVolume = () => { radio.volume = Math.max(0, Math.min(1, volume * (abaixada ? .25 : 1))); };
  const musicaAbaixar = v => { abaixada = v; aplicarVolume(); };
  const definirMusica = (m, vol) => {
    if (vol != null) volume = vol;
    aplicarVolume();
    if (!m) { radio.pause(); radio.removeAttribute('src'); radio.load(); }
    else if (radio.dataset.url !== m.url) { radio.dataset.url = m.url; radio.src = m.url; radio.play().catch(() => {}); }
    if (!m) delete radio.dataset.url;
    renderExtras();
  };

  // ── timers e música: pílulas discretas no canto ──
  const extras = Object.assign(document.createElement('div'), { id: 'zak-extras' });
  document.body.append(extras);
  extras.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.musica != null) { enviar({ acao: 'zak_musica_parar' }); definirMusica(null); }
    else if (b.dataset.timer) enviar({ acao: 'zak_timer_cancelar', id: +b.dataset.timer });
  });
  const renderExtras = () => {
    const agora = Date.now() / 1000;
    const timers = (estado.timers || []).filter(t => t.ate > agora);
    extras.innerHTML = timers.map(t => `<button class="zx-pilula" data-timer="${t.id}" title="Cancelar">${mini.relogio}<span>${esc(t.rotulo || 'Timer')}</span><b>${fmtResta(t.ate - agora)}</b></button>`).join('')
      + (estado.musica && radio.dataset.url ? `<button class="zx-pilula" data-musica title="Parar a música"><i class="zx-eq"><i></i><i></i><i></i></i><span>${esc(estado.musica.nome)}</span>${mini.parar}</button>` : '');
  };
  setInterval(renderExtras, 1000);

  // ── digitar um pedido ──
  const campo = Object.assign(document.createElement('form'), { id: 'zak-campo' });
  campo.innerHTML = `<input type="text" maxlength="300" autocomplete="off" placeholder="Peça algo ao Zak…" aria-label="Pedido para o Zak"><kbd>Enter</kbd>`;
  document.body.append(campo);
  const entrada = campo.querySelector('input');
  const abrirCampo = () => { campo.classList.add('aberto'); entrada.value = ''; entrada.focus(); audio(); };
  const fecharCampo = () => { campo.classList.remove('aberto'); entrada.blur(); };
  campo.addEventListener('submit', e => {
    e.preventDefault();
    const t = entrada.value.trim();
    if (t) enviar({ acao: 'zak_pedido', texto: t });
    fecharCampo();
  });
  entrada.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); fecharCampo(); } });
  entrada.addEventListener('blur', () => setTimeout(fecharCampo, 150));
  presenca.el.addEventListener('click', abrirCampo);
  addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]') || document.activeElement === entrada) return;
    if (e.key.toLowerCase() === 'z') { e.preventDefault(); abrirCampo(); }
  });

  // ── mensagens do servidor ──
  const receber = msg => {
    switch (msg.tipo) {
      case 'zak':
        estado = msg;
        if (msg.cena && !palco.ativa) palco.mostrar(msg.cena);
        definirMusica(msg.musica, msg.volume);
        aoEstado?.(msg);
        break;
      case 'zak_estado':
        presenca.estado(msg.estado);
        if (msg.estado === 'ouvindo') { presenca.ouviu(''); bip(); }
        else if (msg.ouviu) presenca.ouviu(msg.ouviu);
        else if (msg.estado === 'repouso' && !tocando) presenca.ouviu('');
        break;
      case 'zak_cena': palco.mostrar(msg.cena); break;
      case 'zak_limpar': palco.repouso(); break;
      case 'zak_manter': palco.manter(); break;
      case 'zak_fala':
        calar();
        falaId = msg.id; partesTocadas = 0; partesTotal = msg.partes;
        if (msg.audio && !matchMedia('(prefers-reduced-motion: reduce)').matches) presenca.legenda(msg.texto);
        else presenca.falar(msg.texto);
        if (msg.audio) audio();
        break;
      case 'zak_audio': if (msg.id === falaId) tocarParte(msg.id, msg); break;
      case 'zak_calar': calar(); break;
      case 'zak_musica': estado.musica = msg.musica; definirMusica(msg.musica, msg.volume); break;
      case 'zak_alarme': tocarAlarme(); break;
      default: return false;
    }
    if (['zak', 'zak_musica'].includes(msg.tipo)) renderExtras();
    return true;
  };

  // "bip" curto e suave quando o Zak começa a prestar atenção
  const bip = () => {
    try {
      const c = audio(), o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(660, c.currentTime); o.frequency.exponentialRampToValueAtTime(990, c.currentTime + .12);
      g.gain.setValueAtTime(0, c.currentTime); g.gain.linearRampToValueAtTime(.08, c.currentTime + .02);
      g.gain.exponentialRampToValueAtTime(.0001, c.currentTime + .35);
      o.connect(g).connect(c.destination); o.start(); o.stop(c.currentTime + .4);
    } catch { /* sem áudio */ }
  };

  return { receber, abrirCampo };
}
