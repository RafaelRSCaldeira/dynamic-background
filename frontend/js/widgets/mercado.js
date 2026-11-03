// Cotações com mini-gráfico dos últimos 15 dias.
import { periodico } from '../api.js';
import { fmt, esc } from '../util.js';
import { mini } from '../icones.js';

function faisca(serie) {
  if (serie.length < 2) return '';
  const lo = Math.min(...serie), hi = Math.max(...serie), amp = hi - lo || 1;
  const pts = serie.map((v, i) => `${(i / (serie.length - 1) * 100).toFixed(1)},${(28 - (v - lo) / amp * 24).toFixed(1)}`);
  return `<svg class="faisca" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true">
    <polyline points="0,30 ${pts.join(' ')} 100,30" class="faisca-area"/>
    <polyline points="${pts.join(' ')}" class="faisca-linha"/></svg>`;
}

function valor(v, codigo) {
  if (v >= 10000) return `R$ ${fmt.num(v / 1000, 0)} mil`;
  return `R$ ${fmt.num(v, codigo === 'JPY' ? 4 : 2)}`;
}

export function iniciar(el) {
  el.innerHTML = `<div class="rotulo">${mini.grafico}<span>Câmbio</span></div><div class="mer-lista"><div class="esqueleto"></div><div class="esqueleto"></div></div>`;
  const lista = el.querySelector('.mer-lista');
  periodico('/api/mercado', 15 * 60e3, dados => {
    lista.innerHTML = dados.map(m => {
      const sobe = m.variacao >= 0;
      return `<div class="mer-item ${sobe ? 'sobe' : 'desce'}">
        <div class="mer-nome"><b>${esc(m.codigo)}</b><span>${esc(m.nome)}</span></div>
        ${faisca(m.historico)}
        <div class="mer-valor"><b>${valor(m.valor, m.codigo)}</b><span>${sobe ? '▲' : '▼'} ${fmt.num(Math.abs(m.variacao), 2)}%</span></div>
      </div>`;
    }).join('');
  }, () => { if (lista.querySelector('.esqueleto')) lista.innerHTML = '<p class="vazio">Cotações indisponíveis</p>'; });
}
