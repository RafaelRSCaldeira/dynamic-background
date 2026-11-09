// Blocos das cenas do Zak. A IA só descreve a cena (JSON); quem desenha é este vocabulário fixo,
// então toda cena sai bonita, legível a distância e no tamanho certo para a tela.
import { esc, clima } from '../util.js';
import { icone } from '../icones.js';

const MAX_ITENS = 5;
const txt = (v, max = 140) => esc(String(v ?? '').slice(0, max));
const tamanhoTitulo = s => { const n = String(s || '').length; return n <= 10 ? 'g' : n <= 22 ? 'm' : n <= 40 ? 'p' : 'pp'; };
const itens = (lista, max = MAX_ITENS) => (Array.isArray(lista) ? lista : []).slice(0, max);
const rotulo = t => t ? `<h3 class="b-rotulo">${txt(t, 60)}</h3>` : '';

const BLOCOS = {
  destaque: b => `
    ${b.kicker ? `<p class="b-kicker">${txt(b.kicker, 60)}</p>` : ''}
    <h1 class="b-titulo t-${tamanhoTitulo(b.titulo)}">${txt(b.titulo, 80)}</h1>
    ${b.sub ? `<p class="b-sub">${txt(b.sub, 160)}</p>` : ''}`,

  numero: b => `
    ${b.rotulo ? `<p class="b-kicker">${txt(b.rotulo, 60)}</p>` : ''}
    <div class="b-numero"><span class="b-valor">${txt(b.valor, 14)}</span>${b.unidade ? `<span class="b-unidade">${txt(b.unidade, 12)}</span>` : ''}</div>
    ${b.detalhe ? `<p class="b-sub">${txt(b.detalhe, 140)}</p>` : ''}`,

  lista: b => `${rotulo(b.titulo)}
    <ul class="b-lista">${itens(b.itens).map(i => typeof i === 'object'
      ? `<li><b>${txt(i.texto, 60)}</b>${i.detalhe ? `<small>${txt(i.detalhe, 80)}</small>` : ''}</li>`
      : `<li><b>${txt(i, 70)}</b></li>`).join('')}</ul>`,

  passos: b => `${rotulo(b.titulo)}
    <ol class="b-passos">${itens(b.itens).map((i, k) => `<li><i>${k + 1}</i><span>${txt(typeof i === 'object' ? i.texto : i, 80)}</span></li>`).join('')}</ol>`,

  linha_tempo: b => `${rotulo(b.titulo)}
    <ol class="b-tempo">${itens(b.itens, 6).map(i => `
      <li class="${i.feito ? 'feito' : ''} ${i.atual ? 'atual' : ''}">
        <i></i><small>${txt(i.quando, 24)}</small><b>${txt(i.texto, 48)}</b>
      </li>`).join('')}</ol>`,

  comparacao: b => `${rotulo(b.titulo)}
    <div class="b-comparacao">${itens(b.lados, 3).map(l => `
      <div><small>${txt(l.nome, 30)}</small><b>${txt(l.valor, 16)}</b>${l.detalhe ? `<span>${txt(l.detalhe, 60)}</span>` : ''}</div>`).join('<i class="b-vs">vs</i>')}</div>`,

  fatos: b => `${rotulo(b.titulo)}
    <dl class="b-fatos n${itens(b.itens, 4).length}">${itens(b.itens, 4).map(f => `<div><dt>${txt(f.rotulo, 28)}</dt><dd${f.fuso ? ` data-fuso="${esc(f.fuso)}"` : ''}>${txt(f.valor, 28)}</dd></div>`).join('')}</dl>`,

  citacao: b => `<blockquote class="b-citacao"><p>${txt(b.texto, 220)}</p>${b.autor ? `<cite>${txt(b.autor, 50)}</cite>` : ''}</blockquote>`,

  // clima de um lugar citado: o servidor manda o código WMO e a tela traduz em ícone e texto
  clima: b => {
    const info = b.codigo != null ? clima(+b.codigo, b.dia !== false) : { icone: b.icone, texto: b.desc };
    return `${b.lugar ? `<h3 class="b-rotulo">Agora em ${txt(b.lugar, 40)}</h3>` : ''}
    <div class="b-clima">
      <div class="b-clima-ic">${icone(info.icone || 'sol-nuvem')}</div>
      <div><b>${txt(b.temp, 6)}°</b><span>${txt(info.texto, 40)}</span>
      ${b.max != null ? `<small>Máx ${txt(b.max, 4)}° · Mín ${txt(b.min, 4)}°</small>` : ''}</div>
    </div>`;
  },

  // ── telas de resposta longa (formato "painel") ──
  // carrossel: cards que passam sozinhos (o palco anda com eles); a foto de cada card chega depois
  carrossel: b => {
    const lista = itens(b.itens, 8);
    const card = (i, k) => `
      <article class="cr-card${i.foto ? ' com-foto' : ''}" style="--c:${k}">
        ${i.foto ? `<div class="cr-foto" data-foto="${esc(i.foto)}" aria-hidden="true"></div>` : ''}
        <div class="cr-corpo">
          ${i.valor ? `<b class="cr-valor">${txt(i.valor, 24)}</b>` : ''}
          <h4>${txt(i.titulo || i.rotulo, 40)}</h4>
          ${i.texto ? `<p>${txt(i.texto, 170)}</p>` : ''}
        </div>
      </article>`;
    return `${rotulo(b.titulo)}
    <div class="b-carrossel" data-n="${lista.length}" style="--n:${lista.length}">
      <div class="cr-janela"><div class="cr-trilho">${lista.map(card).join('')}</div></div>
      <div class="cr-pontos" aria-hidden="true">${lista.map(() => '<i></i>').join('')}</div>
    </div>`;
  },

  tabela: b => {
    const cols = (b.colunas || []).slice(0, 4), linhas = itens(b.linhas, 7);
    return `${rotulo(b.titulo)}
    <table class="b-tabela">
      ${cols.some(Boolean) ? `<thead><tr>${cols.map(c => `<th scope="col">${txt(c, 30)}</th>`).join('')}</tr></thead>` : ''}
      <tbody>${linhas.map(l => `<tr>${l.slice(0, 4).map((c, i) => i === 0 ? `<th scope="row">${txt(c, 40)}</th>` : `<td>${txt(c, 40)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
  },

  texto: b => `${rotulo(b.titulo)}
    <div class="b-texto">${itens(b.paragrafos, 3).map(p => `<p>${txt(p, 360)}</p>`).join('')}</div>`,

  barras: b => {
    const lista = itens(b.itens, 8);
    const max = Math.max(...lista.map(i => +i.numero || 0)) || 1;
    return `${rotulo(b.titulo)}
    <ul class="b-barras">${lista.map((i, k) => `
      <li style="--v:${Math.max(.015, (+i.numero || 0) / max).toFixed(3)};--c:${k}">
        <span>${txt(i.rotulo, 30)}</span><i><em></em></i><b>${txt(i.valor, 24)}</b>
      </li>`).join('')}</ul>`;
  },

  // contagem regressiva (alarme/lembrete): o anel e o tempo são atualizados pelo palco
  contagem: b => {
    const ate = b.ate ?? Date.now() + (+b.segundos || 0) * 1000;
    const total = (+b.segundos || Math.max(1, (ate - Date.now()) / 1000));
    return `
    <div class="b-contagem" data-ate="${+ate}" data-total="${total}">
      <svg viewBox="0 0 100 100" aria-hidden="true"><circle class="trilho" cx="50" cy="50" r="46"/><circle class="anel" cx="50" cy="50" r="46" pathLength="1000"/></svg>
      <div><b data-resta>--:--</b>${b.rotulo ? `<span>${txt(b.rotulo, 40)}</span>` : ''}</div>
    </div>`;
  },
};

export const TIPOS = Object.keys(BLOCOS);

export function blocoHTML(b, i, largo = false) {
  const f = BLOCOS[b?.tipo];
  if (!f) return '';
  return `<section class="bloco tipo-${b.tipo}${largo ? ' largo' : ''}" style="--i:${i}">${f(b)}</section>`;
}

/** Atualiza contagens regressivas; devolve true se alguma acabou agora. */
export function tiqueContagens(raiz) {
  let acabou = false;
  for (const el of raiz.querySelectorAll('.b-contagem')) {
    const resta = Math.max(0, (+el.dataset.ate - Date.now()) / 1000), total = +el.dataset.total || 1;
    const m = Math.floor(resta / 60), s = Math.floor(resta % 60);
    const h = Math.floor(m / 60);
    el.querySelector('[data-resta]').textContent = h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
    el.style.setProperty('--prog', (1 - resta / total).toFixed(4));
    if (resta === 0 && !el.classList.contains('fim')) { el.classList.add('fim'); acabou = true; }
  }
  return acabou;
}


/** No painel (resposta longa), estes blocos ocupam a largura inteira; os outros vão em duas colunas. */
export const LARGOS = new Set(['carrossel', 'tabela', 'texto', 'linha_tempo']);
