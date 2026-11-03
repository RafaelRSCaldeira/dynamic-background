// Camada de partículas conforme o clima: estrelas, poeira luminosa, chuva, neve ou névoa.
// Reagem ao mouse e ao movimento da câmera (se afastam ou brilham).

const rnd = (a, b) => a + Math.random() * (b - a);

export class Particulas {
  constructor(canvas) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.modo = null;
    this.itens = [];
    this.cadentes = [];
    this.proximaCadente = 0;
    this.vento = 0;
    this.intensidade = 0.5;
    this.sprite = this._sprite();
    this.redimensionar();
    addEventListener('resize', () => { this.redimensionar(); this._povoar(); });
  }

  _sprite() {
    const s = document.createElement('canvas'); s.width = s.height = 64;
    const g = s.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.35, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return s;
  }

  redimensionar() {
    this.dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.w = innerWidth; this.h = innerHeight;
    this.c.width = Math.round(this.w * this.dpr); this.c.height = Math.round(this.h * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.escalaArea = Math.min(2.2, (this.w * this.h) / (1920 * 1080));
    this.u = Math.min(this.w, this.h) / 1080; // unidade de tamanho independente da resolução
  }

  definir(modo, { vento = 0, intensidade = 0.5 } = {}) {
    this.vento = vento; this.intensidade = intensidade;
    if (modo === this.modo) return;
    this.modo = modo;
    this._povoar();
  }

  _povoar() {
    const A = this.escalaArea, u = this.u, w = this.w, h = this.h;
    const n = {
      estrelas: 220 * A, poeira: 55 * A, chuva: (180 + 420 * this.intensidade) * A,
      neve: (90 + 160 * this.intensidade) * A, neblina: 10,
    }[this.modo] || 0;
    this.itens = Array.from({ length: Math.round(n) }, () => {
      const base = { x: rnd(0, w), y: rnd(0, h), vx: 0, vy: 0, ox: 0, oy: 0 };
      switch (this.modo) {
        case 'estrelas': return { ...base, r: rnd(.4, 1.6) * u * 1.4, fase: rnd(0, 6.28), vel: rnd(.4, 1.6), prof: rnd(.2, 1) };
        case 'poeira': return { ...base, r: rnd(6, 26) * u, a: rnd(.04, .14), vy: -rnd(4, 14) * u, fase: rnd(0, 6.28) };
        case 'chuva': return { ...base, comp: rnd(14, 30) * u, vy: rnd(900, 1400) * u, a: rnd(.12, .35) };
        case 'neve': return { ...base, r: rnd(1.2, 3.6) * u, vy: rnd(25, 70) * u, fase: rnd(0, 6.28), a: rnd(.4, .9) };
        case 'neblina': return { ...base, r: rnd(300, 650) * u, vx: rnd(6, 18) * u * (Math.random() < .5 ? -1 : 1), a: rnd(.03, .07) };
      }
      return base;
    });
  }

  // ponteiros: [{x, y, forca}] em pixels
  quadro(dt, ponteiros, t) {
    const { ctx, w, h, u } = this;
    ctx.clearRect(0, 0, w, h);
    const raio = 170 * u;

    // empurra partículas para longe dos ponteiros (com mola para voltar)
    const repelir = p => {
      for (const q of ponteiros) {
        if (q.forca < .02) continue;
        const dx = p.x + p.ox - q.x, dy = p.y + p.oy - q.y, d2 = dx * dx + dy * dy;
        if (d2 < raio * raio && d2 > 1) {
          const d = Math.sqrt(d2), f = (1 - d / raio) * q.forca * 900 * u * dt;
          p.ox += (dx / d) * f; p.oy += (dy / d) * f;
        }
      }
      p.ox *= 1 - Math.min(1, dt * 2.2); p.oy *= 1 - Math.min(1, dt * 2.2);
    };

    switch (this.modo) {
      case 'estrelas': {
        ctx.fillStyle = '#fff';
        for (const s of this.itens) {
          let a = .35 + .65 * (.5 + .5 * Math.sin(t * s.vel + s.fase));
          for (const q of ponteiros) {
            const dx = s.x - q.x, dy = s.y - q.y;
            a += q.forca * Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / (raio * 1.4)) * 1.2;
          }
          ctx.globalAlpha = Math.min(1, a * s.prof);
          ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, 6.283); ctx.fill();
        }
        this._cadentes(dt, t);
        break;
      }
      case 'poeira': {
        for (const p of this.itens) {
          p.y += p.vy * dt; p.x += Math.sin(t * .3 + p.fase) * 8 * u * dt + this.vento * 6 * u * dt;
          if (p.y < -p.r * 2) { p.y = h + p.r * 2; p.x = rnd(0, w); }
          if (p.x < -60) p.x = w + 50; else if (p.x > w + 60) p.x = -50;
          repelir(p);
          ctx.globalAlpha = p.a * (.7 + .3 * Math.sin(t * .8 + p.fase));
          const r = p.r * 2;
          ctx.drawImage(this.sprite, p.x + p.ox - r, p.y + p.oy - r, r * 2, r * 2);
        }
        break;
      }
      case 'chuva': {
        const inc = this.vento * .03;
        ctx.strokeStyle = 'rgba(190,215,255,1)'; ctx.lineWidth = Math.max(1, 1.1 * u); ctx.lineCap = 'round';
        ctx.beginPath();
        for (const p of this.itens) {
          p.y += p.vy * dt; p.x += p.vy * inc * dt;
          if (p.y > h + 40) { p.y = rnd(-80, -10); p.x = rnd(-100, w + 100); }
          repelir(p);
          const x = p.x + p.ox, y = p.y + p.oy;
          ctx.moveTo(x, y); ctx.lineTo(x - p.comp * inc, y - p.comp);
        }
        ctx.globalAlpha = .28; ctx.stroke();
        break;
      }
      case 'neve': {
        ctx.fillStyle = '#fff';
        for (const p of this.itens) {
          p.y += p.vy * dt; p.x += (Math.sin(t * .7 + p.fase) * 20 + this.vento * 3) * u * dt;
          if (p.y > h + 10) { p.y = -10; p.x = rnd(0, w); }
          repelir(p);
          ctx.globalAlpha = p.a;
          ctx.beginPath(); ctx.arc(p.x + p.ox, p.y + p.oy, p.r, 0, 6.283); ctx.fill();
        }
        break;
      }
      case 'neblina': {
        for (const p of this.itens) {
          p.x += p.vx * dt;
          if (p.x < -p.r) p.x = w + p.r; else if (p.x > w + p.r) p.x = -p.r;
          ctx.globalAlpha = p.a;
          ctx.drawImage(this.sprite, p.x - p.r, p.y - p.r * .5, p.r * 2, p.r);
        }
        break;
      }
    }
    ctx.globalAlpha = 1;
  }

  _cadentes(dt, t) {
    const { ctx, w, h, u } = this;
    if (t > this.proximaCadente) {
      this.proximaCadente = t + rnd(7, 18);
      const ang = rnd(.35, .6);
      this.cadentes.push({ x: rnd(w * .2, w * .9), y: rnd(0, h * .35), vx: -Math.cos(ang) * 900 * u, vy: Math.sin(ang) * 900 * u, vida: 1 });
    }
    ctx.lineCap = 'round';
    this.cadentes = this.cadentes.filter(c => {
      c.x += c.vx * dt; c.y += c.vy * dt; c.vida -= dt * 1.3;
      if (c.vida <= 0) return false;
      const g = ctx.createLinearGradient(c.x, c.y, c.x - c.vx * .12, c.y - c.vy * .12);
      g.addColorStop(0, `rgba(255,255,255,${c.vida})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.globalAlpha = 1; ctx.strokeStyle = g; ctx.lineWidth = 1.6 * u;
      ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x - c.vx * .12, c.y - c.vy * .12); ctx.stroke();
      return true;
    });
  }

  explosao(x, y) {
    // ao clicar: empurrão forte nas partículas próximas
    const u = this.u, raio = 320 * u;
    for (const p of this.itens) {
      if (p.ox === undefined) continue;
      const dx = p.x - x, dy = p.y - y, d = Math.hypot(dx, dy);
      if (d < raio && d > 1) { const f = (1 - d / raio) * 140 * u; p.ox += dx / d * f; p.oy += dy / d * f; }
    }
  }
}
