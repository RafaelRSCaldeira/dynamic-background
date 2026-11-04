// Camada de luz por cima do painel: a mão vira uma constelação, e os gestos soltam
// fogos, corações, ondas de choque e desenhos de luz no ar.
import { CONEXOES, PONTAS } from './maos.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

export class Luzes {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.faiscas = [];
    this.coracoesLista = [];
    this.aneis = [];
    this.tracos = new Map();   // id da mão → traço atual
    this.tracosVelhos = [];
    this.agendados = [];
    this.rastros = [];
    this.acento = [140, 220, 215];
    this.sprite = this._sprite();
    this.redimensionar();
    addEventListener('resize', () => this.redimensionar());
  }

  _sprite() {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.25, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return s;
  }

  redimensionar() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth; this.h = innerHeight;
    this.c.width = Math.round(this.w * this.dpr); this.c.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.u = Math.min(this.w, this.h) / 1080;
  }

  get ocioso() {
    return !this.faiscas.length && !this.coracoesLista.length && !this.aneis.length && !this.tracos.size
      && !this.tracosVelhos.length && !this.agendados.length && !this.rastros.length;
  }

  // ── efeitos ──────────────────────────────────────────────
  _estouro(x, y, { n = 90, matiz = rnd(0, 360), vel = 520, vida = 1.5, tam = 2.4, gravidade = 260 } = {}) {
    const u = this.u;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), v = rnd(.35, 1) * vel * u;
      this.faiscas.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vida: rnd(.6, 1) * vida, max: vida,
        h: (matiz + rnd(-25, 25) + 360) % 360, tam: tam * u * rnd(.6, 1.3), g: gravidade * u, arrasto: 1.9 });
    }
    this.aneis.push({ x, y, r: 10 * u, vr: vel * 1.3 * u, vida: .5, max: .5, h: matiz });
  }

  /** Joinha: uma pequena queima de fogos pela tela. */
  fogos(x, y) {
    this._estouro(x, y, { n: 70 });
    const qtd = 4;
    for (let i = 0; i < qtd; i++) {
      this.agendados.push({ em: performance.now() + 220 * (i + 1) + rnd(0, 120),
        fazer: () => this._estouro(rnd(this.w * .12, this.w * .88), rnd(this.h * .1, this.h * .5), { n: 110 }) });
    }
  }

  /** Punho → mão aberta: explosão proporcional à energia acumulada. */
  explosao(x, y, carga) {
    const k = .4 + carga * .9;
    this._estouro(x, y, { n: Math.round(60 + 160 * carga), matiz: rnd(15, 45), vel: 700 * k, vida: 1.6, tam: 3, gravidade: 120 });
    this.aneis.push({ x, y, r: 20 * this.u, vr: 1800 * k * this.u, vida: .8, max: .8, h: 40, grosso: true });
  }

  /** Enquanto o punho está fechado: faíscas são sugadas para a mão. */
  sugar(x, y, carga, dt) {
    const u = this.u, n = Math.random() < carga * dt * 60 ? 2 : 0;
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), r = rnd(140, 320) * u;
      this.faiscas.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, alvo: { x, y }, vx: 0, vy: 0,
        vida: .7, max: .7, h: rnd(20, 50), tam: rnd(1.5, 3) * u, g: 0, arrasto: 0 });
    }
  }

  coracoes(x, y) {
    const u = this.u;
    for (let i = 0; i < 26; i++) {
      this.coracoesLista.push({ x: x + rnd(-60, 60) * u, y: y + rnd(-30, 30) * u, vx: rnd(-90, 90) * u, vy: -rnd(120, 340) * u,
        vida: rnd(1.6, 2.8), max: 2.8, tam: rnd(14, 34) * u, fase: rnd(0, TAU), h: rnd(320, 360 + 15) % 360, rot: rnd(-.4, .4) });
    }
  }

  /** Deslizar: um rastro de luz atravessa a tela no sentido do gesto. */
  deslize(y, dir) {
    this.rastros.push({ y: y * this.h, dir, p: 0 });
  }

  /** Desenho no ar: adiciona um ponto ao traço da mão `id`. */
  tracar(id, x, y) {
    let tr = this.tracos.get(id);
    const t = performance.now();
    // um salto grande (mão perdida e reencontrada longe) começa um traço novo, sem risco reto pela tela
    const ant = tr?.pontos.at(-1);
    if (ant && (Math.hypot(ant.x - x, ant.y - y) > Math.max(this.w, this.h) * .2 || t - ant.t > 300)) { this.soltarTraco(id); tr = null; }
    if (!tr) { tr = { pontos: [], h: rnd(0, 360) }; this.tracos.set(id, tr); }
    const ult = tr.pontos.at(-1);
    if (!ult || Math.hypot(ult.x - x, ult.y - y) > 2) tr.pontos.push({ x, y, t });
  }

  soltarTraco(id) {
    const tr = this.tracos.get(id);
    if (tr) { if (tr.pontos.length > 1) this.tracosVelhos.push(tr); this.tracos.delete(id); }
  }

  limpar() {
    this.tracos.clear(); this.tracosVelhos = [];
    for (const f of this.faiscas) f.vida = Math.min(f.vida, .3);
  }

  // ── desenho ──────────────────────────────────────────────
  quadro(dt, maos) {
    const { ctx, w, h, u } = this, agora = performance.now();
    ctx.clearRect(0, 0, w, h);
    if (this.agendados.length) {
      this.agendados = this.agendados.filter(a => (agora >= a.em ? (a.fazer(), false) : true));
    }
    ctx.globalCompositeOperation = 'lighter';
    const [ar, ag, ab] = this.acento;

    // traços de luz (somem em 4 s)
    const todos = [...this.tracosVelhos, ...this.tracos.values()];
    for (const tr of todos) {
      tr.pontos = tr.pontos.filter(p => agora - p.t < 4000);
      const ps = tr.pontos;
      for (let i = 1; i < ps.length; i++) {
        const a = 1 - (agora - ps[i].t) / 4000;
        const cor = `hsla(${(tr.h + i * 3) % 360}, 95%, 66%,`;
        ctx.lineCap = 'round';
        ctx.strokeStyle = cor + (a * .22) + ')'; ctx.lineWidth = 16 * u;
        ctx.beginPath(); ctx.moveTo(ps[i - 1].x, ps[i - 1].y); ctx.lineTo(ps[i].x, ps[i].y); ctx.stroke();
        ctx.strokeStyle = cor + a + ')'; ctx.lineWidth = 4 * u;
        ctx.beginPath(); ctx.moveTo(ps[i - 1].x, ps[i - 1].y); ctx.lineTo(ps[i].x, ps[i].y); ctx.stroke();
      }
    }
    this.tracosVelhos = this.tracosVelhos.filter(tr => tr.pontos.length > 1);

    // rastros de deslize
    this.rastros = this.rastros.filter(r => {
      r.p += dt * 2.4;
      if (r.p >= 1.4) return false;
      const x = r.dir > 0 ? r.p * w : w - r.p * w, comp = w * .45 * r.dir;
      const g = ctx.createLinearGradient(x - comp, 0, x, 0);
      g.addColorStop(0, `rgba(${ar},${ag},${ab},0)`); g.addColorStop(1, `rgba(${ar},${ag},${ab},.55)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.ellipse(x - comp / 2, r.y, Math.abs(comp) / 2, 26 * u, 0, 0, TAU); ctx.fill();
      return true;
    });

    // anéis (ondas de choque)
    this.aneis = this.aneis.filter(a => {
      a.vida -= dt; if (a.vida <= 0) return false;
      a.r += a.vr * dt; a.vr *= 1 - dt * 2.5;
      const k = a.vida / a.max;
      ctx.strokeStyle = `hsla(${a.h}, 90%, 70%, ${k * .7})`; ctx.lineWidth = (a.grosso ? 10 : 3) * u * k + 1;
      ctx.beginPath(); ctx.arc(a.x, a.y, a.r, 0, TAU); ctx.stroke();
      return true;
    });

    // faíscas
    ctx.lineCap = 'round';
    this.faiscas = this.faiscas.filter(f => {
      f.vida -= dt; if (f.vida <= 0) return false;
      if (f.alvo) { // sugada para a mão
        f.x += (f.alvo.x - f.x) * Math.min(1, dt * 7); f.y += (f.alvo.y - f.y) * Math.min(1, dt * 7);
        f.vx = (f.alvo.x - f.x) * 4; f.vy = (f.alvo.y - f.y) * 4;
      } else {
        f.vx *= 1 - Math.min(1, dt * f.arrasto); f.vy *= 1 - Math.min(1, dt * f.arrasto); f.vy += f.g * dt;
        f.x += f.vx * dt; f.y += f.vy * dt;
      }
      const k = f.vida / f.max;
      ctx.strokeStyle = `hsla(${f.h}, 100%, ${55 + 30 * k}%, ${Math.min(1, k * 1.4)})`; ctx.lineWidth = f.tam;
      ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.lineTo(f.x - f.vx * .035, f.y - f.vy * .035); ctx.stroke();
      return true;
    });

    // corações
    ctx.globalCompositeOperation = 'source-over';
    this.coracoesLista = this.coracoesLista.filter(c => {
      c.vida -= dt; if (c.vida <= 0) return false;
      c.x += (c.vx + Math.sin(agora / 300 + c.fase) * 40 * u) * dt; c.y += c.vy * dt; c.vx *= 1 - dt;
      const k = Math.min(1, c.vida / .6);
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rot + Math.sin(agora / 400 + c.fase) * .2);
      ctx.globalAlpha = k * .92; ctx.fillStyle = `hsl(${c.h}, 90%, 66%)`;
      const s = c.tam / 2;
      ctx.beginPath(); ctx.moveTo(0, s * .55);
      ctx.bezierCurveTo(-s * 1.1, -s * .2, -s * .55, -s * 1.05, 0, -s * .45);
      ctx.bezierCurveTo(s * .55, -s * 1.05, s * 1.1, -s * .2, 0, s * .55);
      ctx.fill(); ctx.restore();
      return true;
    });
    ctx.globalAlpha = 1;

    // mãos: constelação de estrelas
    ctx.globalCompositeOperation = 'lighter';
    for (const m of maos) {
      const P = m.pontos.map(p => ({ x: p.x * w, y: p.y * h }));
      const quente = m.carga || 0;
      const cr = Math.round(ar + (255 - ar) * quente), cg = Math.round(ag + (150 - ag) * quente), cb = Math.round(ab + (60 - ab) * quente);
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},.32)`; ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      for (const [a, b] of CONEXOES) { ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); }
      ctx.stroke();
      for (let i = 0; i < P.length; i++) {
        const ponta = PONTAS.includes(i), destaque = m.desenhando && i === 8;
        const r = (destaque ? 46 : ponta ? 22 : 11) * u;
        ctx.globalAlpha = destaque ? 1 : ponta ? .9 : .6;
        ctx.drawImage(this.sprite, P[i].x - r, P[i].y - r, r * 2, r * 2);
      }
      ctx.globalAlpha = 1;
      // bola de energia no punho
      if (quente > .05) {
        const px = m.palma.x * w, py = m.palma.y * h, r = (40 + 110 * quente) * u * (1 + Math.sin(agora / 70) * .06 * quente);
        const g = ctx.createRadialGradient(px, py, 0, px, py, r);
        g.addColorStop(0, `rgba(255,230,180,${.55 * quente})`); g.addColorStop(.4, `rgba(255,140,60,${.35 * quente})`); g.addColorStop(1, 'rgba(255,80,30,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r, 0, TAU); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
  }
}
