import { periodico } from '../api.js';
import { fmt, esc } from '../util.js';
import { mini } from '../icones.js';

export function iniciar(el) {
  el.innerHTML = `
    <div class="rel-saudacao"></div>
    <div class="rel-hora" aria-label="Hora atual">
      <span class="rel-hm"><span data-d="0"></span><span data-d="1"></span><span class="rel-dois">:</span><span data-d="2"></span><span data-d="3"></span></span>
      <span class="rel-seg"><span data-d="4"></span><span data-d="5"></span></span>
    </div>
    <div class="rel-data"></div>
    <div class="rel-progresso" title="Progresso do dia"><i></i></div>
    <div class="rel-meta">
      <span class="rel-semana"></span>
      <span class="rel-feriado"></span>
    </div>`;

  const digitos = [...el.querySelectorAll('[data-d]')];
  const saud = el.querySelector('.rel-saudacao'), data = el.querySelector('.rel-data');
  const barra = el.querySelector('.rel-progresso i'), semana = el.querySelector('.rel-semana');
  const feriadoEl = el.querySelector('.rel-feriado');
  let feriados = [];

  const trocar = (span, v) => {
    if (span.dataset.v === v) return;
    const primeira = span.dataset.v === undefined;
    span.dataset.v = v;
    const novo = document.createElement('span');
    novo.textContent = v;
    if (!primeira) novo.className = 'd-entra';
    span.replaceChildren(novo);
  };

  const tique = () => {
    const d = new Date();
    const s = [d.getHours(), d.getMinutes(), d.getSeconds()].map(n => String(n).padStart(2, '0')).join('');
    digitos.forEach((span, i) => trocar(span, s[i]));
    const h = d.getHours();
    saud.textContent = h >= 5 && h < 12 ? 'Bom dia' : h >= 12 && h < 18 ? 'Boa tarde' : 'Boa noite';
    data.textContent = fmt.capital(d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }));
    const inicio = new Date(d); inicio.setHours(0, 0, 0, 0);
    barra.style.transform = `scaleX(${((d - inicio) / 864e5).toFixed(4)})`;
    // semana ISO
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const sem = Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
    const diaAno = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5);
    semana.innerHTML = `${mini.calendario} Semana ${sem} · dia ${diaAno}`;
    if (d.getSeconds() === 0 || !feriadoEl.dataset.ok) desenharFeriado();
    setTimeout(tique, 1000 - (Date.now() % 1000) + 5);
  };

  const desenharFeriado = () => {
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const prox = feriados.map(f => ({ ...f, d: new Date(f.data + 'T00:00') })).find(f => f.d >= hoje);
    if (!prox) { feriadoEl.textContent = ''; return; }
    feriadoEl.dataset.ok = 1;
    const dias = Math.round((prox.d - hoje) / 864e5);
    const quando = dias === 0 ? 'hoje' : dias === 1 ? 'amanhã' : `em ${dias} dias`;
    feriadoEl.innerHTML = `<b>${esc(prox.nome)}</b> · ${fmt.diaSemana(prox.d)}, ${prox.d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${quando}`;
  };

  periodico('/api/feriados', 6 * 3600e3, f => { feriados = f; desenharFeriado(); });
  tique();
}
