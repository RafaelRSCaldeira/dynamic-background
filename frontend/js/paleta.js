// Paleta do fundo: varia com a hora do dia (nascer/pôr do sol reais) e com o clima.
import { lerp, clamp } from './util.js';

const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
const P = {
  noite:      ['#03040c', '#0b1640', '#1b4d6e', '#3fb5a3'],
  amanhecer:  ['#0d0a24', '#3b2266', '#c55a78', '#f2a05a'],
  dia:        ['#03172e', '#0b4a7e', '#1590b0', '#76d6cf'],
  entardecer: ['#0f0820', '#47205c', '#bd4560', '#ee8a3e'],
  chuva:      ['#04070d', '#172234', '#304a63', '#7496b3'],
  tempestade: ['#04030a', '#1b1330', '#3a2d60', '#8a7fd1'],
  neve:       ['#090e18', '#283750', '#7189ab', '#d5e2f2'],
  neblina:    ['#080a10', '#252c38', '#4a5566', '#9aa6b5'],
  // cenas de brincadeira (gesto ✌)
  floresta:   ['#020906', '#0a2a1c', '#1d6347', '#c9e86a'],
  magia:      ['#09031a', '#36105e', '#b02f8f', '#ff9bd6'],
};
const PAL = Object.fromEntries(Object.entries(P).map(([k, v]) => [k, v.map(hex)]));

const misturar = (a, b, t) => a.map((c, i) => c.map((v, j) => lerp(v, b[i][j], t)));

// Pontos-chave do dia em minutos relativos ao nascer/pôr do sol
function paletaHorario(agora, nascer, por) {
  const m = agora.getTime(), n = nascer.getTime(), p = por.getTime(), min = 60000;
  const pontos = [
    [n - 100 * min, 'noite'], [n, 'amanhecer'], [n + 110 * min, 'dia'],
    [p - 110 * min, 'dia'], [p, 'entardecer'], [p + 90 * min, 'noite'],
  ];
  if (m <= pontos[0][0] || m >= pontos.at(-1)[0]) return PAL.noite;
  for (let i = 1; i < pontos.length; i++) {
    if (m <= pontos[i][0]) {
      const [t0, a] = pontos[i - 1], [t1, b] = pontos[i];
      return misturar(PAL[a], PAL[b], clamp((m - t0) / (t1 - t0), 0, 1));
    }
  }
  return PAL.noite;
}

/** Retorna { cores: [[r,g,b]×4], nuvem: 0..1, acento: 'rgb()' } */
export function paletaPara(agora, nascer, por, cena = 'limpo') {
  let cores = nascer && por ? paletaHorario(agora, nascer, por) : PAL.noite;
  let nuvem = 0;
  switch (cena) {
    case 'parcial': nuvem = .25; break;
    case 'nublado': nuvem = .55; cores = misturar(cores, PAL.neblina, .3); break;
    case 'neblina': nuvem = .7; cores = misturar(cores, PAL.neblina, .55); break;
    case 'chuva': nuvem = .5; cores = misturar(cores, PAL.chuva, .6); break;
    case 'tempestade': nuvem = .4; cores = misturar(cores, PAL.tempestade, .75); break;
    case 'neve': nuvem = .4; cores = misturar(cores, PAL.neve, .55); break;
  }
  // acento de interface: o tom mais vivo, clareado
  const a = cores[3].map(v => Math.round(lerp(v, 1, .35) * 255));
  return { cores, nuvem, acento: `rgb(${a.join(',')})` };
}

/** Paleta fixa (sem depender da hora), usada nas cenas escolhidas por gesto. */
export function paletaFixa(nome, nuvem = 0) {
  const cores = PAL[nome] || PAL.noite;
  const a = cores[3].map(v => Math.round(lerp(v, 1, .35) * 255));
  return { cores, nuvem, acento: `rgb(${a.join(',')})` };
}

export function noturno(agora, nascer, por) {
  if (!nascer || !por) return true;
  return agora < nascer - 30 * 60000 || agora > por.getTime() + 40 * 60000;
}

/** Paleta vinda de uma cena do Zak: 4 cores hex (escura → viva), já prontas (tiradas da foto). */
export function paletaDeCores(hexes, nuvem = 0) {
  const cores = hexes.slice(0, 4).map(hex);
  const a = cores[3].map(v => Math.round(lerp(v, 1, .3) * 255));
  return { cores, nuvem, acento: `rgb(${a.join(',')})` };
}

/** Paleta a partir de um único tom (cena sem foto): mesmo "desenho" das paletas fixas, no tom pedido. */
export function paletaDeTom(cor) {
  const [r, g, b] = hex(cor);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  const s = mx ? d / mx : 0;
  const hsv = (hh, ss, vv) => {
    const f = n => { const k = (n + hh / 60) % 6; return vv - vv * ss * Math.max(0, Math.min(k, 4 - k, 1)); };
    return [f(5), f(3), f(1)];
  };
  // fundo um pouco "girado" no círculo de cores: dá profundidade sem perder o tom
  const cores = [hsv(h - 25, .7, .055), hsv(h - 15, .75, .24), hsv(h - 5, .7, .45), hsv(h, Math.max(.45, s), .85)];
  const a = cores[3].map(v => Math.round(lerp(v, 1, .3) * 255));
  return { cores, nuvem: 0, acento: `rgb(${a.join(',')})` };
}
