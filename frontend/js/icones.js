// Ícones de clima animados (SVG + CSS) e ícones de interface

const NUVEM = 'M18 46H46A10 10 0 0 0 47.5 26.1A14 14 0 0 0 21 23A11.5 11.5 0 0 0 18 46Z';

const svg = (conteudo, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 64 64" aria-hidden="true">${conteudo}</svg>`;

function sol(cx, cy, r) {
  let raios = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, c = Math.cos(a), s = Math.sin(a);
    raios += `<line x1="${(cx + c * (r + 5)).toFixed(1)}" y1="${(cy + s * (r + 5)).toFixed(1)}" x2="${(cx + c * (r + 10)).toFixed(1)}" y2="${(cy + s * (r + 10)).toFixed(1)}"/>`;
  }
  return `<g class="ic-raios ic-giro">${raios}</g><circle class="ic-sol-nucleo ic-pulsa" cx="${cx}" cy="${cy}" r="${r}"/>`;
}
const lua = (t = '') => `<g transform="${t}"><path class="ic-lua" d="M38 12a19 19 0 1 0 14 31A16 16 0 0 1 38 12z"/></g>`;
const nuvem = (cls = '', t = '') => `<g transform="${t}"><path class="ic-nuvem ic-flutua ${cls}" d="${NUVEM}"/></g>`;
const gotas = (n = 3, cls = 'ic-gota') => Array.from({ length: n }, (_, i) =>
  `<line class="${cls}" x1="${24 + i * 9}" y1="50" x2="${21 + i * 9}" y2="57" style="animation-delay:${(i * 0.33).toFixed(2)}s"/>`).join('');
const flocos = () => [0, 1, 2].map(i => `<circle class="ic-floco" cx="${24 + i * 9}" cy="52" r="2" style="animation-delay:${i * 0.7}s"/>`).join('');

export function icone(tipo) {
  switch (tipo) {
    case 'sol': return svg(sol(32, 32, 11));
    case 'lua': return svg(lua() + '<circle class="ic-estrela" cx="50" cy="14" r="1.6"/><circle class="ic-estrela" cx="56" cy="26" r="1.1" style="animation-delay:1.2s"/>');
    case 'sol-nuvem': return svg(`<g transform="translate(-9,-9)">${sol(32, 32, 9)}</g>` + nuvem('', 'translate(4,6)'));
    case 'lua-nuvem': return svg(lua('translate(-10,-8) scale(.8)') + nuvem('', 'translate(4,6)'));
    case 'nuvem': return svg(nuvem('ic-nuvem-tras', 'translate(-8,-8) scale(.85)') + nuvem('', 'translate(2,4)'));
    case 'neblina': return svg(nuvem('ic-nuvem-tras', 'translate(0,-8)') +
      [44, 51, 58].map((y, i) => `<line class="ic-nevoa" x1="${12 + i * 3}" y1="${y}" x2="${52 - i * 2}" y2="${y}" style="animation-delay:${i * .8}s"/>`).join(''));
    case 'garoa': return svg(nuvem('', 'translate(0,-6)') + gotas(3, 'ic-gota ic-gota-fina'));
    case 'chuva': return svg(nuvem('escura', 'translate(0,-6)') + gotas(3));
    case 'neve': return svg(nuvem('', 'translate(0,-6)') + flocos());
    case 'tempestade': return svg(nuvem('escura', 'translate(0,-8)') + '<path class="ic-raio" d="M33 40l-7 11h6l-3 10 10-14h-6l4-7z"/>' + gotas(2));
    default: return svg(nuvem());
  }
}

// Ícones de interface (traço)
const ui = d => `<svg class="ui" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
export const mini = {
  local: ui('<path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  gota: ui('<path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z"/>'),
  vento: ui('<path d="M3 8h11a3 3 0 1 0-3-3"/><path d="M3 12h16a3 3 0 1 1-3 3"/><path d="M3 16h7"/>'),
  seta: ui('<path d="M12 20V5"/><path d="m6 11 6-6 6 6"/>'),
  uv: ui('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  guarda: ui('<path d="M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9z"/><path d="M12 12v6a2 2 0 0 1-4 0"/>'),
  ar: ui('<path d="M4 15c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/><path d="M4 9c2-2 4-2 6 0s4 2 6 0 3-1.5 4-1"/>'),
  relogio: ui('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  calendario: ui('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  grafico: ui('<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>'),
  ceu: ui('<path d="M3 18h18"/><path d="M6 18a6 6 0 0 1 12 0"/><path d="M12 6V4M5.6 8.6 4.2 7.2M18.4 8.6l1.4-1.4"/>'),
  jornal: ui('<path d="M4 5h13v14a2 2 0 0 0 2 2H6a2 2 0 0 1-2-2z"/><path d="M17 9h3v10a2 2 0 0 1-2 2"/><path d="M8 9h5M8 13h5M8 17h3"/>'),
  mic: ui('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  micOff: ui('<path d="M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v2a3 3 0 0 0 4.9 2.3"/><path d="M19 11a7 7 0 0 1-1.2 3.9M5 11a7 7 0 0 0 10.6 6M12 18v3M3 3l18 18"/>'),
  camera: ui('<path d="M15 10l5-3v10l-5-3z"/><rect x="3" y="6" width="12" height="12" rx="3"/>'),
  cameraOff: ui('<path d="M15 10l5-3v10l-5-3M10.5 6H12a3 3 0 0 1 3 3v1.5M15 15v0a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V9a3 3 0 0 1 2-2.8"/><path d="M3 3l18 18"/>'),
  telaCheia: ui('<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/>'),
  borracha: ui('<path d="M7 21h10"/><path d="m5.5 13.5 8-8a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L12 17H8z"/>'),
  sala: ui('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-5h4v5"/>'),
  contexto: ui('<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>'),
  curiosidade: ui('<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>'),
  tarefa: ui('<rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12 2.5 2.5 4.5-5"/>'),
  pergunta: ui('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/><path d="M9.8 9.6a2.3 2.3 0 0 1 4.4.9c0 1.5-2.2 2-2.2 3.2M12 16.5h.01"/>'),
};
