import { getJSON, periodico, conectar } from './api.js';
import { bus, clima, clamp, lerp, guardar } from './util.js';
import { mini } from './icones.js';
import { Fundo } from './fundo.js';
import { Particulas } from './particulas.js';
import { Camera } from './camera.js';
import { paletaPara, noturno } from './paleta.js';
import * as relogio from './widgets/relogio.js';
import * as agora from './widgets/agora.js';
import * as horas from './widgets/horas.js';
import * as semana from './widgets/semana.js';
import * as ceu from './widgets/ceu.js';
import * as mercado from './widgets/mercado.js';
import * as noticias from './widgets/noticias.js';
import * as sala from './widgets/sala.js';

const cfg = await getJSON('/api/config').catch(() => ({ tela: {}, camera: { ativada: false } }));
const W = nome => document.querySelector(`[data-w="${nome}"]`);

// ── Conexão em tempo real ───────────────────────────────────
let widgetSala;
const conexao = conectar(
  msg => {
    if (msg.tipo === 'sala') widgetSala.estado(msg);
    else if (msg.tipo === 'nivel') widgetSala.nivel(msg.v);
  },
  ok => widgetSala.conexao(ok),
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
let voz = 0;
bus.on('voz', v => { voz = v; if (v > .35) marcarPresenca(); });

const atualizarCena = () => {
  const d = bus.ultimo.clima;
  const agoraD = new Date();
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
  if (e.target.closest('button')) return;
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
const alternarCamera = async () => {
  if (camera.ativa) camera.desligar(); else await camera.ligar();
  guardar.gravar('camera', camera.ativa);
  pintarBotaoCamera();
};
btnCamera.addEventListener('click', alternarCamera);
pintarBotaoCamera();
if (cfg.camera?.ativada && guardar.ler('camera', true)) camera.ligar().then(pintarBotaoCamera);

// ── Tela cheia, cursor, atalhos ─────────────────────────────
const btnTela = document.getElementById('btn-tela');
btnTela.innerHTML = mini.telaCheia;
const telaCheia = () => document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.().catch(() => {});
btnTela.addEventListener('click', telaCheia);
addEventListener('keydown', e => {
  if (e.ctrlKey || e.altKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'm') conexao.enviar({ acao: 'mute' });
  else if (k === 'c') alternarCamera();
  else if (k === 'f') telaCheia();
});

// ── Laço de animação ────────────────────────────────────────
const fpsMax = cfg.tela?.fps_max || 60, quadroMin = 1000 / fpsMax;
const ociosidade = (cfg.camera?.ociosidade_minutos ?? 5) * 60e3;
let anterior = performance.now();

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

  // câmera: o centro do movimento vira um segundo "ponteiro"
  const mov = camera.ativa ? camera.movimento : 0;
  cena.p2.forca = lerp(cena.p2.forca, clamp(mov * 3, 0, 1), 1 - Math.exp(-dt * 3));
  cena.p2.x = lerp(cena.p2.x, camera.x, 1 - Math.exp(-dt * 4));
  cena.p2.y = lerp(cena.p2.y, camera.y, 1 - Math.exp(-dt * 4));
  if (camera.ativa && camera.ultimoMovimento > presenca) presenca = camera.ultimoMovimento;

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
  if (cena.p2.forca > .02) pts.push({ x: cena.p2.x * innerWidth, y: (1 - cena.p2.y) * innerHeight, forca: cena.p2.forca });
  particulas.quadro(dt, pts, t / 1000);

  // cursor some sozinho; modo ambiente quando ninguém está por perto (requer câmera)
  if (t - ponteiro.ultimo > 3000) document.body.classList.add('cursor-oculto');
  document.body.classList.toggle('ambiente', camera.ativa && t - presenca > ociosidade);
}
requestAnimationFrame(quadro);
document.body.classList.add('pronto');
