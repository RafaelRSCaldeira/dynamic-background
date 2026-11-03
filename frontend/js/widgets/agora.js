import { bus, clima, contar, fmt, esc } from '../util.js';
import { icone, mini } from '../icones.js';

const AQI = [[50, 'Bom', 'ok'], [100, 'Moderado', 'medio'], [150, 'Ruim p/ sensíveis', 'alerta'], [200, 'Ruim', 'perigo'], [999, 'Muito ruim', 'perigo']];
const UV = [[2, 'Baixo'], [5, 'Moderado'], [7, 'Alto'], [10, 'Muito alto'], [99, 'Extremo']];
const DIRECOES = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];

export function iniciar(el) {
  el.innerHTML = `
    <div class="ag-local rotulo">${mini.local}<span></span></div>
    <div class="ag-principal">
      <div class="ag-icone"></div>
      <div class="ag-temp"><span class="ag-num">--</span><span class="ag-grau">°</span></div>
    </div>
    <div class="ag-desc">Carregando clima…</div>
    <div class="ag-sub"></div>
    <div class="chips ag-chips"></div>`;
  const $ = s => el.querySelector(s);
  let ultimoIcone = '';

  bus.on('clima', d => {
    const c = d.current, dia = d.daily;
    const info = clima(c.weather_code, !!c.is_day);
    $('.ag-local span').textContent = d.local;
    if (info.icone !== ultimoIcone) { $('.ag-icone').innerHTML = icone(info.icone); ultimoIcone = info.icone; }
    contar($('.ag-num'), Math.round(c.temperature_2m));
    $('.ag-desc').textContent = info.texto;
    $('.ag-sub').innerHTML = `Sensação <b>${Math.round(c.apparent_temperature)}°</b> · Máx <b>${Math.round(dia.temperature_2m_max[0])}°</b> · Mín <b>${Math.round(dia.temperature_2m_min[0])}°</b>`;

    const chips = [
      `<span class="chip">${mini.gota}${c.relative_humidity_2m}%</span>`,
      `<span class="chip">${mini.vento}${Math.round(c.wind_speed_10m)} km/h <i class="seta-vento" style="transform:rotate(${(c.wind_direction_10m + 180) % 360}deg)">${mini.seta}</i>${DIRECOES[Math.round(c.wind_direction_10m / 45) % 8]}</span>`,
    ];
    if (c.uv_index != null && c.is_day) chips.push(`<span class="chip">${mini.uv}UV ${fmt.num(c.uv_index, 0)} · ${UV.find(([l]) => c.uv_index <= l)[1]}</span>`);
    const chuva = d.hourly.precipitation_probability?.[horaAtual(d)] ?? 0;
    if (chuva > 0) chips.push(`<span class="chip">${mini.guarda}${chuva}%</span>`);
    if (d.ar?.us_aqi != null) {
      const [, nome, cls] = AQI.find(([l]) => d.ar.us_aqi <= l);
      chips.push(`<span class="chip chip-${cls}">${mini.ar}Ar ${esc(nome)}</span>`);
    }
    $('.ag-chips').innerHTML = chips.join('');
  });
}

export function horaAtual(d) {
  const alvo = d.current.time.slice(0, 13);
  const i = d.hourly.time.findIndex(t => t.startsWith(alvo));
  return Math.max(0, i);
}
