// Faixa de manchetes com transição suave; passar o mouse pausa.
import { periodico } from '../api.js';
import { esc, relativo } from '../util.js';
import { mini } from '../icones.js';

const DURACAO = 9000;

export function iniciar(el) {
  el.innerHTML = `
    <div class="not-rotulo">${mini.jornal}<span>Agora</span></div>
    <div class="not-palco"></div>
    <div class="not-contador"></div>
    <div class="not-progresso"><i></i></div>`;
  const palco = el.querySelector('.not-palco'), cont = el.querySelector('.not-contador');
  const prog = el.querySelector('.not-progresso i');
  let itens = [], i = -1, pausado = false, decorrido = 0, ultimo = performance.now();

  const mostrar = () => {
    if (!itens.length) return;
    i = (i + 1) % itens.length;
    const n = itens[i];
    const novo = document.createElement('div');
    novo.className = 'not-item entra';
    novo.innerHTML = `<span class="not-fonte">${esc(n.fonte)}</span><span class="not-titulo">${esc(n.titulo)}</span>${n.t ? `<span class="not-hora">${relativo(Date.now() / 1000 - n.t)}</span>` : ''}`;
    palco.querySelectorAll('.not-item').forEach(v => { v.classList.remove('entra'); v.classList.add('sai'); setTimeout(() => v.remove(), 900); });
    palco.append(novo);
    cont.textContent = `${i + 1}/${itens.length}`;
  };

  const tique = agora => {
    const dt = agora - ultimo; ultimo = agora;
    if (!pausado && itens.length) {
      decorrido += dt;
      if (decorrido >= DURACAO) { decorrido = 0; mostrar(); }
      prog.style.transform = `scaleX(${(decorrido / DURACAO).toFixed(3)})`;
    }
    requestAnimationFrame(tique);
  };
  requestAnimationFrame(tique);

  el.addEventListener('pointerenter', () => { pausado = true; el.classList.add('pausado'); });
  el.addEventListener('pointerleave', () => { pausado = false; el.classList.remove('pausado'); });
  el.addEventListener('click', () => { decorrido = 0; mostrar(); });

  periodico('/api/noticias', 10 * 60e3, dados => {
    const primeira = !itens.length;
    itens = dados;
    if (primeira) { i = -1; mostrar(); }
  }, () => { if (!itens.length) palco.innerHTML = '<div class="not-item"><span class="not-titulo vazio">Notícias indisponíveis</span></div>'; });
}
