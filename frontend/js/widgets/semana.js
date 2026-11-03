// Previsão de 7 dias com barras de amplitude térmica (se adapta: linhas ou colunas).
import { bus, clima, corTemp, fmt } from '../util.js';
import { icone, mini } from '../icones.js';

export function iniciar(el) {
  el.innerHTML = `<div class="rotulo">${mini.calendario}<span>Próximos dias</span></div><div class="sem-lista"></div>`;
  const lista = el.querySelector('.sem-lista');

  bus.on('clima', d => {
    const dd = d.daily;
    const n = Math.min(7, dd.time.length);
    const mins = dd.temperature_2m_min.slice(0, n), maxs = dd.temperature_2m_max.slice(0, n);
    const lo = Math.min(...mins), hi = Math.max(...maxs), amp = Math.max(1, hi - lo);
    lista.innerHTML = Array.from({ length: n }, (_, i) => {
      const data = new Date(dd.time[i] + 'T12:00');
      const nome = i === 0 ? 'Hoje' : i === 1 ? 'Amanhã' : fmt.capital(fmt.diaSemana(data));
      const info = clima(dd.weather_code[i], true);
      const chuva = dd.precipitation_probability_max[i] ?? 0;
      const a = (mins[i] - lo) / amp, b = (maxs[i] - lo) / amp;
      return `<div class="sem-dia" style="--a:${a.toFixed(3)};--b:${b.toFixed(3)};--c1:${corTemp(mins[i])};--c2:${corTemp(maxs[i])};--j:${i}" title="${info.texto}">
        <span class="sem-nome">${nome}</span>
        <span class="sem-ic">${icone(info.icone)}</span>
        <span class="sem-chuva">${chuva >= 10 ? chuva + '%' : ''}</span>
        <span class="sem-min">${Math.round(mins[i])}°</span>
        <span class="sem-faixa"><i></i></span>
        <span class="sem-max">${Math.round(maxs[i])}°</span>
      </div>`;
    }).join('');
  });
}
