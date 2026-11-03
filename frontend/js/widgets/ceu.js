// Arco do sol (posição real), fase da lua e duração do dia.
import { bus, fmt } from '../util.js';
import { mini } from '../icones.js';

const NOMES_LUA = ['Lua nova', 'Crescente', 'Quarto crescente', 'Crescente gibosa', 'Lua cheia', 'Minguante gibosa', 'Quarto minguante', 'Minguante'];

function faseLua(d) {
  const sinodico = 29.530588853, ref = Date.UTC(2000, 0, 6, 18, 14);
  return (((d - ref) / 864e5 / sinodico) % 1 + 1) % 1;
}

function desenhoLua(p, r = 20, sul = false) {
  const c = Math.cos(2 * Math.PI * p), rx = Math.abs(c) * r;
  const crescente = p < .5;
  const externo = crescente ? 1 : 0;
  const interno = crescente ? (c > 0 ? 0 : 1) : (c > 0 ? 1 : 0);
  const caminho = `M${r},0 A${r},${r} 0 0 ${externo} ${r},${2 * r} A${rx},${r} 0 0 ${interno} ${r},0Z`;
  return `<svg class="lua-svg" viewBox="-2 -2 ${2 * r + 4} ${2 * r + 4}" aria-hidden="true">
    <circle cx="${r}" cy="${r}" r="${r}" class="lua-escura"/>
    <path d="${caminho}" class="lua-clara" ${sul ? `transform="translate(${2 * r},0) scale(-1,1)"` : ''}/>
  </svg>`;
}

export function iniciar(el) {
  el.innerHTML = `
    <div class="rotulo">${mini.ceu}<span>Céu</span></div>
    <div class="ceu-corpo"><div class="ceu-arco"></div><div class="ceu-lua"></div></div>`;
  const arco = el.querySelector('.ceu-arco'), luaEl = el.querySelector('.ceu-lua');
  let dados = null;

  const desenhar = () => {
    if (!dados) return;
    const agora = new Date();
    const nascer = new Date(dados.daily.sunrise[0]), por = new Date(dados.daily.sunset[0]);
    const nascerAmanha = new Date(dados.daily.sunrise[1]);
    const dia = agora >= nascer && agora <= por;
    const k = Math.min(1, Math.max(0, (agora - nascer) / (por - nascer)));
    const ang = Math.PI * (1 - k), cx = 100 + Math.cos(ang) * 80, cy = 92 - Math.sin(ang) * 72;
    const dur = (por - nascer) / 36e5;
    const falta = dia ? por - agora : (agora < nascer ? nascer : nascerAmanha) - agora;
    const fh = Math.floor(falta / 36e5), fm = Math.round((falta % 36e5) / 6e4);
    arco.innerHTML = `
      <svg viewBox="0 0 200 118" aria-hidden="true">
        <defs><radialGradient id="ceu-brilho"><stop offset="0" stop-color="#fde68a" stop-opacity=".9"/><stop offset="1" stop-color="#fde68a" stop-opacity="0"/></radialGradient></defs>
        <path class="ceu-trilha" d="M20,92 A80,72 0 0 1 180,92"/>
        ${dia ? `<path class="ceu-percorrido" d="M20,92 A80,72 0 0 1 180,92" style="stroke-dasharray:${(k * 238).toFixed(1)} 400"/>` : ''}
        <line class="ceu-horizonte" x1="6" y1="92" x2="194" y2="92"/>
        ${dia ? `<circle cx="${cx}" cy="${cy}" r="16" fill="url(#ceu-brilho)"/><circle class="ceu-sol" cx="${cx}" cy="${cy}" r="6"/>` : ''}
        <text class="ceu-txt" x="20" y="108">${fmt.hora(nascer)}</text>
        <text class="ceu-txt" x="180" y="108">${fmt.hora(por)}</text>
        <text class="ceu-meio" x="100" y="80">${dia ? `Pôr do sol em ${fh}h${String(fm).padStart(2, '0')}` : `Nascer em ${fh}h${String(fm).padStart(2, '0')}`}</text>
        <text class="ceu-meio sub" x="100" y="108">${Math.floor(dur)}h${String(Math.round((dur % 1) * 60)).padStart(2, '0')} de luz</text>
      </svg>`;

    const p = faseLua(agora), ilum = Math.round((1 - Math.cos(2 * Math.PI * p)) / 2 * 100);
    const sul = (dados.latitude ?? 0) < 0;
    luaEl.innerHTML = `${desenhoLua(p, 20, sul)}<div><b>${NOMES_LUA[Math.round(p * 8) % 8]}</b><span>${ilum}% iluminada</span></div>`;
  };

  bus.on('clima', d => { dados = d; desenhar(); });
  setInterval(desenhar, 60e3);
}
