// Presença do Zak na tela: um orbe discreto que mostra se ele está só ouvindo a sala,
// prestando atenção em você ("Ei, Zak"), pensando ou falando, e a legenda do que ele diz.
import { esc } from '../util.js';

const ESTADOS = ['repouso', 'ouvindo', 'pensando', 'falando'];
const SOME_DEPOIS_MS = 5000;

export class Presenca {
  constructor() {
    this.el = Object.assign(document.createElement('div'), { id: 'zak' });
    this.el.innerHTML = `
      <div class="zk-orbe" aria-hidden="true"><i class="zk-halo"></i><i class="zk-anel"></i><i class="zk-anel zk-anel-2"></i><i class="zk-nucleo"></i></div>
      <div class="zk-texto">
        <small class="zk-dica">Diga <b>“Ei, Zak”</b></small>
        <p class="zk-ouvido" aria-live="polite"></p>
        <p class="zk-fala" aria-live="polite"></p>
      </div>`;
    this.el.title = 'Falar com o Zak (Z)';
    document.getElementById('luzes').before(this.el);
    this.$ = s => this.el.querySelector(s);
    this.estado('repouso');
    this._nivel = 0; this._alvo = 0; this._simular = false;
    this._spans = []; this._dita = 0;
    const animar = () => {   // nível da voz suavizado (vem do áudio do Zak; sem áudio, simulado)
      requestAnimationFrame(animar);
      if (this._estado === 'falando' && this._simular) this._alvo = .35 + .4 * Math.abs(Math.sin(performance.now() / 95)) * Math.random();
      this._nivel += (this._alvo - this._nivel) * .25;
      this.el.style.setProperty('--nivel', this._nivel.toFixed(3));
    };
    requestAnimationFrame(animar);
  }

  estado(e) {
    if (!ESTADOS.includes(e)) return;
    if (e === 'repouso' && this._falandoAgora) e = 'falando';
    this._estado = e;
    this.el.dataset.estado = e;
    if (e !== 'falando') this._alvo = 0;
  }

  /** O que o Zak entendeu de quem falou com ele. */
  ouviu(texto) {
    const p = this.$('.zk-ouvido');
    p.textContent = texto ? `“${texto}”` : '';
    p.classList.toggle('visivel', !!texto);
  }

  /** Mostra a frase inteira apagada; as palavras acendem conforme o áudio toca (revelar). */
  legenda(texto) {
    clearTimeout(this._fim); clearInterval(this._palavras);
    const p = this.$('.zk-fala');
    p.innerHTML = String(texto || '').split(/\s+/).filter(Boolean).map(w => `<span>${esc(w)}</span>`).join(' ');
    p.classList.add('visivel');
    this._spans = [...p.querySelectorAll('span')];
    this._dita = 0;
    this._falandoAgora = true;
    this._simular = false;
    this.estado('falando');
  }

  /** Acende as palavras deste trecho ao longo da duração dele. */
  revelar(trecho, ms) {
    const n = Math.max(1, String(trecho || '').split(/\s+/).filter(Boolean).length);
    const ini = this._dita, fim = Math.min(this._spans.length, ini + n);
    this._dita = fim;
    const passo = ms / Math.max(1, fim - ini);
    for (let i = ini; i < fim; i++) setTimeout(() => this._spans[i]?.classList.add('dita'), (i - ini) * passo);
  }

  fimFala() {
    this._spans.forEach(s => s.classList.add('dita'));
    this._falandoAgora = false;
    this.estado('repouso');
    clearTimeout(this._fim);
    this._fim = setTimeout(() => { this.$('.zk-fala').classList.remove('visivel'); this.ouviu(''); }, SOME_DEPOIS_MS);
  }

  /** Sem áudio (voz desligada): legenda palavra por palavra no ritmo de fala (~2,6 palavras/s). */
  falar(texto) {
    this.legenda(texto);
    this._simular = true;
    let i = 0;
    this._palavras = setInterval(() => {
      this._spans[i++]?.classList.add('dita');
      if (i >= this._spans.length) { clearInterval(this._palavras); this.fimFala(); }
    }, 380);
  }

  nivel(v) { this._simular = false; this._alvo = v; }
}
