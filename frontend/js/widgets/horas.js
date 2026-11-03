// Previsão das próximas 24 h: curva de temperatura, chance de chuva e ícones. Interativo no hover.
import { bus, clima, corTemp, curva, esc } from '../util.js';
import { icone, mini } from '../icones.js';
import { horaAtual } from './agora.js';

const N = 25;

export function iniciar(el) {
  el.innerHTML = `
    <div class="rotulo">${mini.relogio}<span>Próximas 24 horas</span><span class="hr-resumo"></span></div>
    <div class="hr-area"><div class="hr-grafico"></div><div class="hr-dica"></div></div>`;
  const area = el.querySelector('.hr-area'), graf = el.querySelector('.hr-grafico'), dica = el.querySelector('.hr-dica');
  const resumo = el.querySelector('.hr-resumo');
  let pontos = [], dados = null;

  const desenhar = () => {
    if (!dados) return;
    const W = area.clientWidth, H = area.clientHeight;
    if (W < 50 || H < 50) return;
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const h = dados.hourly, i0 = horaAtual(dados);
    const itens = Array.from({ length: N }, (_, k) => {
      const i = i0 + k;
      return { t: new Date(h.time[i]), temp: h.temperature_2m[i], chuva: h.precipitation_probability[i] ?? 0, cod: h.weather_code[i], dia: !!h.is_day[i] };
    }).filter(x => x.temp != null);
    const temps = itens.map(x => x.temp), tmin = Math.min(...temps), tmax = Math.max(...temps);
    const pad = rem * 1.2, topo = Math.max(rem * 1.8, H * .2), base = H > rem * 8 ? H * .52 : H - rem * 3.4;
    const x = k => pad + (k * (W - pad * 2)) / (itens.length - 1);
    const y = t => base - ((t - tmin) / Math.max(1, tmax - tmin)) * (base - topo);
    pontos = itens.map((it, k) => ({ ...it, x: x(k), y: y(it.temp) }));
    const linha = curva(pontos.map(p => [p.x, p.y]));
    const passo = W / rem > 48 ? 2 : 3; // em telas largas, rótulo a cada 2h
    const comIcones = H > rem * 8;
    const ic = comIcones ? Math.min(rem * 2.1, H * .17) : 0;
    const yIcone = base + (H - base - rem * 2.6 - ic) / 2 + rem * .2;

    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
      <defs>
        <linearGradient id="hr-traco" x1="0" x2="1">${pontos.map((p, k) => `<stop offset="${(k / (pontos.length - 1)).toFixed(3)}" stop-color="${corTemp(p.temp)}"/>`).join('')}</linearGradient>
        <linearGradient id="hr-preench" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="var(--acento)" stop-opacity=".28"/><stop offset="1" stop-color="var(--acento)" stop-opacity="0"/></linearGradient>
      </defs>`;
    // faixa de chance de chuva: linha fina na base, mais intensa onde a chance é maior
    const yChuva = H - rem * 1.45;
    s += `<linearGradient id="hr-chuva" x1="0" x2="1">${pontos.map((p, k) => `<stop offset="${(k / (pontos.length - 1)).toFixed(3)}" stop-color="#60a5fa" stop-opacity="${Math.min(.95, p.chuva / 90).toFixed(2)}"/>`).join('')}</linearGradient>
      <rect x="${pontos[0].x}" y="${yChuva}" width="${pontos.at(-1).x - pontos[0].x}" height="${rem * .2}" rx="${rem * .1}" fill="rgba(255,255,255,.06)"/>
      <rect x="${pontos[0].x}" y="${yChuva}" width="${pontos.at(-1).x - pontos[0].x}" height="${rem * .2}" rx="${rem * .1}" fill="url(#hr-chuva)"/>`;
    s += `<path d="${linha} L${pontos.at(-1).x},${base + (H - base) * .35} L${pontos[0].x},${base + (H - base) * .35}Z" fill="url(#hr-preench)"/>`;
    s += `<path class="hr-linha" d="${linha}" stroke="url(#hr-traco)"/>`;
    pontos.forEach((p, k) => {
      if (k % passo) return;
      s += `<circle class="hr-ponto" cx="${p.x}" cy="${p.y}" r="${rem * .22}" fill="${corTemp(p.temp)}"/>
        <text class="hr-temp" x="${p.x}" y="${p.y - rem * .75}">${Math.round(p.temp)}°</text>
        <text class="hr-hora" x="${p.x}" y="${H - rem * .2}">${k === 0 ? 'Agora' : String(p.t.getHours()).padStart(2, '0') + 'h'}</text>
        ${comIcones ? '' : '<!--'}<foreignObject x="${p.x - ic / 2}" y="${yIcone}" width="${ic}" height="${ic}"><div class="hr-ic">${icone(clima(p.cod, p.dia).icone)}</div></foreignObject>${comIcones ? '' : '-->'}`;
      if (p.chuva >= 10) s += `<text class="hr-chuva" x="${p.x}" y="${yChuva - rem * .35}">${p.chuva}%</text>`;
    });
    s += `<line class="hr-cursor" x1="0" x2="0" y1="${topo - rem}" y2="${yChuva}"/><circle class="hr-cursor-ponto" r="${rem * .38}"/></svg>`;
    graf.innerHTML = s;

    const chuvaMax = Math.max(...itens.map(i => i.chuva));
    resumo.textContent = chuvaMax >= 40 ? `· chance de chuva de até ${chuvaMax}%` : `· ${Math.round(tmin)}° a ${Math.round(tmax)}°`;
  };

  // hover: cursor vertical + dica com detalhes da hora
  area.addEventListener('pointermove', e => {
    if (!pontos.length) return;
    const r = area.getBoundingClientRect(), mx = e.clientX - r.left;
    const p = pontos.reduce((a, b) => Math.abs(b.x - mx) < Math.abs(a.x - mx) ? b : a);
    const cur = graf.querySelector('.hr-cursor'), cp = graf.querySelector('.hr-cursor-ponto');
    cur?.setAttribute('transform', `translate(${p.x},0)`);
    cp?.setAttribute('cx', p.x); cp?.setAttribute('cy', p.y); cp?.setAttribute('fill', corTemp(p.temp));
    area.classList.add('hover');
    dica.innerHTML = `<b>${String(p.t.getHours()).padStart(2, '0')}:00</b> · ${Math.round(p.temp)}° · ${esc(clima(p.cod, p.dia).texto)}${p.chuva ? ` · ${p.chuva}% chuva` : ''}`;
    const dw = dica.offsetWidth;
    dica.style.transform = `translate(${Math.min(Math.max(p.x - dw / 2, 0), r.width - dw)}px, 0)`;
  });
  area.addEventListener('pointerleave', () => area.classList.remove('hover'));

  new ResizeObserver(desenhar).observe(area);
  bus.on('clima', d => { dados = d; desenhar(); });
  setInterval(desenhar, 5 * 60e3);
}
