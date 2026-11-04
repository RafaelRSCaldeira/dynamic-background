// Modo destaque: um card por vez, grande, no centro da tela. Deslize a mão (ou ←/→) para trocar.
// Os widgets usam container queries, então se redesenham sozinhos no tamanho maior.

const ORDEM = ['relogio', 'agora', 'horas', 'semana', 'ceu', 'mercado', 'noticias', 'sala'];
const NOMES = {
  relogio: 'Relógio', agora: 'Clima agora', horas: 'Próximas 24 horas', semana: 'Próximos dias',
  ceu: 'Sol e lua', mercado: 'Câmbio', noticias: 'Notícias', sala: 'Sala',
};
const SAIR_SOZINHO_MS = 75e3;

export class Destaque {
  constructor() {
    this.i = -1;
    this.nav = Object.assign(document.createElement('div'), { id: 'destaque-nav' });
    this.nav.innerHTML = `<button class="dn-seta" data-d="-1" aria-label="Anterior">‹</button>
      <div class="dn-meio"><b></b><div class="dn-pontos">${ORDEM.map(() => '<i></i>').join('')}</div></div>
      <button class="dn-seta" data-d="1" aria-label="Próximo">›</button>
      <button class="dn-sair" aria-label="Sair do destaque">✕</button>`;
    document.body.append(this.nav);
    this.nav.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.d) this.ir(+b.dataset.d); else this.sair();
    });
    // clicar fora do card destacado também sai
    document.addEventListener('pointerdown', e => {
      if (this.ativo && !e.target.closest('.em-destaque, #destaque-nav, #controles, dialog')) this.sair();
    });
  }

  get ativo() { return this.i >= 0; }
  get nome() { return this.ativo ? NOMES[ORDEM[this.i]] : ''; }

  _card(i) { return i >= 0 ? document.querySelector(`[data-w="${ORDEM[i]}"]`) : null; }

  ir(delta) {
    const n = ORDEM.length;
    const novo = this.ativo ? (this.i + delta + n) % n : (delta > 0 ? 0 : n - 1);
    this._aplicar(novo, delta);
  }

  irPara(nome) {
    const i = ORDEM.indexOf(nome);
    if (i >= 0) this._aplicar(i, 1);
  }

  sair() { if (this.ativo) this._aplicar(-1, 0); }

  _aplicar(novo, delta) {
    const antigo = this._card(this.i), alvo = this._card(novo);
    this.i = novo;
    clearTimeout(this._timer);
    if (novo >= 0) this._timer = setTimeout(() => this.sair(), SAIR_SOZINHO_MS);

    const mudar = () => {
      document.querySelectorAll('#painel > .card').forEach(c => c.classList.toggle('em-destaque', c === alvo));
      document.body.classList.toggle('destaque', novo >= 0);
      document.documentElement.dataset.sentido = delta < 0 ? 'volta' : 'vai';
      this.nav.querySelector('b').textContent = this.nome;
      this.nav.querySelectorAll('.dn-pontos i').forEach((p, k) => p.classList.toggle('sel', k === novo));
    };
    const reduzido = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!document.startViewTransition || reduzido) { mudar(); return; }
    // View Transitions: o card "voa" da grade para o centro (e de volta)
    if (alvo) alvo.style.viewTransitionName = 'dest-entra';
    if (antigo && antigo !== alvo) antigo.style.viewTransitionName = 'dest-sai';
    const vt = document.startViewTransition(mudar);
    vt.finished.finally(() => {
      if (alvo) alvo.style.viewTransitionName = '';
      if (antigo) antigo.style.viewTransitionName = '';
    });
  }
}
