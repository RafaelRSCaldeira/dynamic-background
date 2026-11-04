import { getJSON, periodico, conectar } from './api.js';
import { bus, clima, clamp, lerp, guardar } from './util.js';
import { mini } from './icones.js';
import { Fundo } from './fundo.js';
import { Particulas } from './particulas.js';
import { Camera } from './camera.js';
import { paletaPara, paletaFixa, noturno } from './paleta.js';
import { Brincar } from './brincar.js';
import { Destaque } from './destaque.js';
import * as relogio from './widgets/relogio.js';
import * as agora from './widgets/agora.js';
import * as horas from './widgets/horas.js';
import * as semana from './widgets/semana.js';
import * as ceu from './widgets/ceu.js';
import * as mercado from './widgets/mercado.js';
import * as noticias from './widgets/noticias.js';
import * as sala from './widgets/sala.js';
import { iniciarAjustes } from './ajustes.js';

const cfg = await getJSON('/api/config').catch(() => ({ tela: {}, camera: { ativada: false } }));
const params = new URLSearchParams(location.search);
// Zak: a tela vira a cena do assunto da conversa (protótipo: /?zak, demonstração: /?zak&demo)
const modoZak = params.has('zak') || !!cfg.zak?.ativado;
const W = nome => document.querySelector(`[data-w="${nome}"]`);

// ── Conexão em tempo real ───────────────────────────────────
let widgetSala, ajustes, zakCliente = null, ultimoZak = null;
const paraZak = [];   // mensagens do Zak que chegam antes de o módulo dele carregar
const conexao = conectar(
  msg => {
    if (msg.tipo === 'sala') { widgetSala.estado(msg); ajustes?.estado(msg); }
    else if (msg.tipo === 'nivel') widgetSala.nivel(msg.v);
    else if (msg.tipo?.startsWith('zak')) {
      if (msg.tipo === 'zak' && modoZak) { ultimoZak = msg; ajustes?.zak(msg); }
      if (zakCliente) zakCliente.receber(msg); else if (modoZak) paraZak.push(msg);
    }
  },
  ok => { widgetSala.conexao(ok); if (ok && modoZak) conexao.enviar({ acao: 'zak_tela' }); },
);

// ── Widgets ─────────────────────────────────────────────────
relogio.iniciar(W('relogio'));
agora.iniciar(W('agora'));
horas.iniciar(W('horas'));
semana.iniciar(W('semana'));
ceu.iniciar(W('ceu'));
mercado.iniciar(W('mercado'));
noticias.iniciar(W('noticias'));
widgetSala = sala.iniciar(W('sala'), { enviar: conexao.enviar });

periodico('/api/clima', 10 * 60e3, d => bus.emit('clima', d), e => console.warn('clima', e));

// ── Cena: fundo + partículas ────────────────────────────────
const fundo = new Fundo(document.getElementById('fundo'), cfg.tela?.qualidade_fundo ?? .5);
const particulas = new Particulas(document.getElementById('particulas'));
const camera = new Camera();

const cena = {
  tempo: Math.random() * 100, nuvem: 0, flash: 0, energia: 0,
  p1: { x: .5, y: .5, forca: 0 }, p2: { x: .5, y: .5, forca: 0 },
  clique: { x: .5, y: .5, idade: 99 },
  cores: paletaPara(new Date(), null, null).cores,
  alvo: paletaPara(new Date(), null, null),
  tempestade: false, proximoRaio: 0,
};
let voz = 0, brincar = null;
bus.on('voz', v => { voz = v; if (v > .35) marcarPresenca(); });

// cena escolhida por gesto (✌): vale por alguns minutos e depois volta ao clima real
const CENA_FORCADA_MS = 4 * 60e3;
let cenaForcada = null, cenaForcadaAte = 0;
const CENAS_FIXAS = {
  estrelas:   { paleta: () => paletaFixa('noite'), modo: 'estrelas' },
  neve:       { paleta: () => paletaFixa('neve', .35), modo: 'neve', intensidade: .9 },
  tempestade: { paleta: () => paletaFixa('tempestade', .4), modo: 'chuva', intensidade: 1, raios: true },
  vagalumes:  { paleta: () => paletaFixa('floresta'), modo: 'vagalumes' },
  magia:      { paleta: () => paletaFixa('magia', .1), modo: 'poeira', intensidade: 1 },
};
const forcarCena = id => {
  cenaForcada = CENAS_FIXAS[id] ? id : null;
  cenaForcadaAte = performance.now() + CENA_FORCADA_MS;
  if (cenaForcada) cena.proximoRaio = 0;
  atualizarCena();
};

let paletaZak = null;   // cena do Zak na tela: a paleta dela manda no fundo
const atualizarCena = () => {
  const d = bus.ultimo.clima;
  const agoraD = new Date();
  if (paletaZak) {
    cena.alvo = paletaZak;
    cena.tempestade = false;
    particulas.definir('poeira', { vento: .2, intensidade: .35 });
    document.documentElement.style.setProperty('--acento', cena.alvo.acento);
    return;
  }
  if (cenaForcada && performance.now() > cenaForcadaAte) { cenaForcada = null; brincar?.cenaExpirou(); }
  if (cenaForcada) {
    const c = CENAS_FIXAS[cenaForcada];
    cena.alvo = c.paleta();
    cena.tempestade = !!c.raios;
    particulas.definir(c.modo, { vento: .5, intensidade: c.intensidade ?? .6 });
    document.documentElement.style.setProperty('--acento', cena.alvo.acento);
    return;
  }
  if (!d) { cena.alvo = paletaPara(agoraD, null, null); return; }
  const nascer = new Date(d.daily.sunrise[0]), por = new Date(d.daily.sunset[0]);
  const info = clima(d.current.weather_code, !!d.current.is_day);
  cena.alvo = paletaPara(agoraD, nascer, por, info.cena);
  cena.tempestade = info.cena === 'tempestade';
  const noite = noturno(agoraD, nascer, por);
  const modo = { chuva: 'chuva', tempestade: 'chuva', neve: 'neve', neblina: 'neblina' }[info.cena]
    || (noite && info.cena !== 'nublado' ? 'estrelas' : 'poeira');
  const vento = (d.current.wind_speed_10m || 0) * Math.sin((d.current.wind_direction_10m || 0) * Math.PI / 180) / 10;
  particulas.definir(modo, { vento, intensidade: info.intensidade || .5 });
  document.documentElement.style.setProperty('--acento', cena.alvo.acento);
};
bus.on('clima', atualizarCena);
atualizarCena();
setInterval(atualizarCena, 30e3);

// ── Ponteiro, clique e cartões com profundidade ─────────────
const ponteiro = { x: innerWidth / 2, y: innerHeight / 2, ultimo: -1e9 };
let presenca = performance.now();
const marcarPresenca = () => { presenca = performance.now(); };
const cards = [...document.querySelectorAll('.card')];
let pendente = false;

addEventListener('pointermove', e => {
  ponteiro.x = e.clientX; ponteiro.y = e.clientY; ponteiro.ultimo = performance.now();
  marcarPresenca();
  document.body.classList.remove('cursor-oculto', 'ambiente');
  if (!pendente) { pendente = true; requestAnimationFrame(atualizarCards); }
});
addEventListener('pointerdown', e => {
  if (e.target.closest('button, dialog, .sala-feed')) return;
  cena.clique = { x: e.clientX / innerWidth, y: 1 - e.clientY / innerHeight, idade: 0 };
  particulas.explosao(e.clientX, e.clientY);
});
document.addEventListener('pointerleave', () => { ponteiro.ultimo = -1e9; cards.forEach(c => c.style.setProperty('--spot', 0)); });

function atualizarCards() {
  pendente = false;
  for (const c of cards) {
    const r = c.getBoundingClientRect();
    const dentro = ponteiro.x >= r.left && ponteiro.x <= r.right && ponteiro.y >= r.top && ponteiro.y <= r.bottom;
    const dx = Math.max(r.left - ponteiro.x, 0, ponteiro.x - r.right), dy = Math.max(r.top - ponteiro.y, 0, ponteiro.y - r.bottom);
    const perto = clamp(1 - Math.hypot(dx, dy) / (innerWidth * .18), 0, 1);
    c.style.setProperty('--mx', `${ponteiro.x - r.left}px`);
    c.style.setProperty('--my', `${ponteiro.y - r.top}px`);
    c.style.setProperty('--spot', perto.toFixed(2));
    const tx = dentro ? ((ponteiro.x - r.left) / r.width - .5) : 0, ty = dentro ? ((ponteiro.y - r.top) / r.height - .5) : 0;
    c.style.setProperty('--ry', `${(tx * 5).toFixed(2)}deg`);
    c.style.setProperty('--rx', `${(-ty * 5).toFixed(2)}deg`);
  }
}

// ── Câmera ──────────────────────────────────────────────────
const btnCamera = document.getElementById('btn-camera');
camera.aoGesto = (x, y) => {   // aceno amplo = "clique" no ponto do movimento
  cena.clique = { x, y, idade: 0 };
  particulas.explosao(x * innerWidth, (1 - y) * innerHeight);
};
const pintarBotaoCamera = () => {
  btnCamera.innerHTML = camera.ativa ? mini.camera : mini.cameraOff;
  btnCamera.classList.toggle('ativo', camera.ativa);
  document.body.classList.toggle('camera-ativa', camera.ativa);
};
// ── Zak: palco das cenas e presença ─────────────────────────
let palco = null, zak = null;
if (modoZak) {
  document.body.classList.add('zak');
  const [{ Palco }, { Presenca }] = await Promise.all([import('./zak/palco.js'), import('./zak/presenca.js')]);
  palco = new Palco({
    aoPaleta: p => {
      paletaZak = p; atualizarCena();
      // tom mais escuro da cena: usado no véu que garante a leitura do texto sobre a foto
      if (p) document.documentElement.style.setProperty('--cena-0', `rgb(${p.cores[0].map(v => Math.round(v * 255)).join(',')})`);
    },
    aoAlarme: () => tocarAlarme(),
  });
  zak = new Presenca();
  if (params.has('demo')) (await import('./zak/demo.js')).iniciarDemo({ palco, presenca: zak, automatico: params.get('demo') !== 'manual' });
  else {
    const { iniciarZak } = await import('./zak/cliente.js');
    zakCliente = iniciarZak({ palco, presenca: zak, enviar: conexao.enviar, tocarAlarme: () => tocarAlarme() });
    paraZak.splice(0).forEach(m => zakCliente.receber(m));
  }
}
// alarme curto e suave (acorde que some), sem arquivo de áudio
function tocarAlarme() {
  try {
    const ctx = new AudioContext();
    [0, .9, 1.8].forEach(t0 => [523.25, 659.25, 783.99].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + t0 + i * .06);
      g.gain.linearRampToValueAtTime(.12, ctx.currentTime + t0 + i * .06 + .03);
      g.gain.exponentialRampToValueAtTime(.0001, ctx.currentTime + t0 + i * .06 + 1.4);
      o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t0 + i * .06); o.stop(ctx.currentTime + t0 + 1.6);
    }));
    setTimeout(() => ctx.close(), 4000);
  } catch { /* sem áudio */ }
}

// ── Brincadeiras com as mãos (gestos) e modo destaque ───────
const destaque = new Destaque();
// no modo Zak, deslizar a mão anda pelo histórico de cenas em vez dos cards
const navegacao = palco ? {
  ir: d => palco.navegar(d), sair: () => { palco.repouso(); conexao.enviar({ acao: 'zak_limpar' }); },
  get nome() { return palco.nome; }, get ativo() { return palco.ativa; },
} : destaque;
brincar = new Brincar({
  camera, particulas, destaque: navegacao,
  onda: (x, y) => { cena.clique = { x, y, idade: 0 }; },
  cena: forcarCena,
  distanciaMax: cfg.camera?.distancia_gestos ?? 2,
  campoVisao: cfg.camera?.campo_visao ?? 65,
});

const alternarCamera = async () => {
  if (camera.ativa) camera.desligar(); else await camera.ligar();
  guardar.gravar('camera', camera.ativa);
  pintarBotaoCamera();
  brincar.sincronizar();
};
btnCamera.addEventListener('click', alternarCamera);
pintarBotaoCamera();
if (cfg.camera?.ativada && guardar.ler('camera', true)) camera.ligar().then(() => { pintarBotaoCamera(); brincar.sincronizar(); });

// ── Ajustes (modelos e câmera) ──────────────────────────────
ajustes = iniciarAjustes({
  enviar: conexao.enviar, camera, alternarCamera, brincar,
  ociosidadeMin: cfg.camera?.ociosidade_minutos ?? 5,
});
if (ultimoZak) ajustes.zak(ultimoZak);
// links diretos para testar: /#destaque-semana, /?debug (registra os gestos no console)
const ancora = location.hash.match(/^#destaque-(\w+)/);
if (ancora) destaque.irPara(ancora[1]);
if (params.has('debug')) Object.assign(window, { __brincar: brincar, __destaque: destaque, __sala: widgetSala, __palco: palco, __zak: zak });
const btnAjustes = document.getElementById('btn-ajustes');
btnAjustes.innerHTML = mini.ajustes;
btnAjustes.addEventListener('click', ajustes.abrir);
if (location.hash === '#ajustes') ajustes.abrir();   // link direto: http://127.0.0.1:8765/#ajustes

// ── Tela cheia, cursor, atalhos ─────────────────────────────
const btnTela = document.getElementById('btn-tela');
btnTela.innerHTML = mini.telaCheia;
const telaCheia = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
btnTela.addEventListener('click', telaCheia);
addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey || ajustes.aberto) return;
  const k = e.key.toLowerCase();
  if (document.activeElement?.matches?.('input, textarea')) return;
  if (k === 'm') conexao.enviar({ acao: 'mute' });
  else if (k === 'c') alternarCamera();
  else if (k === 'f') telaCheia();
  else if (k === 'a') ajustes.abrir();
  else if (k === 'g') brincar.mostrarGuia();
  else if (e.key === 'ArrowRight') navegacao.ir(1);
  else if (e.key === 'ArrowLeft') navegacao.ir(-1);
  else if (e.key === 'Escape') navegacao.sair();
});

// ── Laço de animação ────────────────────────────────────────
const fpsMax = cfg.tela?.fps_max || 60, quadroMin = 1000 / fpsMax;
const ociosidade = (cfg.camera?.ociosidade_minutos ?? 5) * 60e3;
let anterior = performance.now();
// cor de acento atual em [r,g,b] (para os efeitos de luz combinarem com a paleta)
const acentoRGB = () => (cena.alvo.acento.match(/\d+/g) || [140, 220, 215]).map(Number);

function quadro(t) {
  requestAnimationFrame(quadro);
  const ms = t - anterior;
  if (ms < quadroMin - 1.5) return;
  anterior = t;
  const dt = Math.min(ms / 1000, .1);

  // ponteiro do mouse: forte enquanto se mexe, some aos poucos
  const ativo = t - ponteiro.ultimo < 2500 ? 1 : 0;
  cena.p1.forca = lerp(cena.p1.forca, ativo, 1 - Math.exp(-dt * (ativo ? 4 : .8)));
  cena.p1.x = lerp(cena.p1.x, ponteiro.x / innerWidth, 1 - Math.exp(-dt * 6));
  cena.p1.y = lerp(cena.p1.y, 1 - ponteiro.y / innerHeight, 1 - Math.exp(-dt * 6));

  // câmera: a mão (se houver) ou o centro do movimento vira um segundo "ponteiro"
  const mov = camera.ativa ? camera.movimento : 0;
  const mao = brincar.quadro(dt, acentoRGB());
  const alvo2 = mao ? { x: mao.x / innerWidth, y: 1 - mao.y / innerHeight, f: 1 } : { x: camera.x, y: camera.y, f: clamp(mov * 3, 0, 1) };
  cena.p2.forca = lerp(cena.p2.forca, alvo2.f, 1 - Math.exp(-dt * (mao ? 8 : 3)));
  cena.p2.x = lerp(cena.p2.x, alvo2.x, 1 - Math.exp(-dt * (mao ? 14 : 4)));
  cena.p2.y = lerp(cena.p2.y, alvo2.y, 1 - Math.exp(-dt * (mao ? 14 : 4)));
  if (camera.ativa && camera.ultimoMovimento > presenca) presenca = camera.ultimoMovimento;
  if (mao) presenca = t;
  document.body.classList.toggle('com-maos', !!mao);

  // energia (voz + movimento) acelera o fluxo da aurora
  cena.energia = lerp(cena.energia, clamp(voz * .9 + mov * 1.5, 0, 1), 1 - Math.exp(-dt * 3));
  cena.tempo += dt * (.045 + cena.energia * .09) * (document.body.classList.contains('ambiente') ? .6 : 1);
  cena.clique.idade += dt;

  // paleta transita suavemente
  const k = 1 - Math.exp(-dt * .5);
  cena.cores = cena.cores.map((c, i) => c.map((v, j) => lerp(v, cena.alvo.cores[i][j], k)));
  cena.nuvem = lerp(cena.nuvem, cena.alvo.nuvem, k);

  // relâmpagos
  if (cena.tempestade && t > cena.proximoRaio) { cena.flash = .55; cena.proximoRaio = t + 5000 + Math.random() * 12000; }
  cena.flash *= Math.exp(-dt * (cena.flash > .3 ? 9 : 4));

  fundo.desenhar(cena);
  const pts = [{ x: ponteiro.x, y: ponteiro.y, forca: cena.p1.forca }];
  if (mao) pts.push(mao); // punho fechado: `atrair` puxa as partículas para a mão
  else if (cena.p2.forca > .02) pts.push({ x: cena.p2.x * innerWidth, y: (1 - cena.p2.y) * innerHeight, forca: cena.p2.forca });
  particulas.quadro(dt, pts, t / 1000);

  // cursor some sozinho; modo ambiente quando ninguém está por perto (requer câmera)
  if (t - ponteiro.ultimo > 3000) document.body.classList.add('cursor-oculto');
  document.body.classList.toggle('ambiente', camera.ativa && t - presenca > ociosidade);
}
requestAnimationFrame(quadro);
document.body.classList.add('pronto');
