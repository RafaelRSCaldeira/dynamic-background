// Utilidades compartilhadas

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const suave = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Barramento de eventos simples, lembrando o último valor de cada canal
export const bus = {
  ev: {}, ultimo: {},
  on(nome, fn) { (this.ev[nome] ??= []).push(fn); if (nome in this.ultimo) fn(this.ultimo[nome]); },
  emit(nome, dado) { this.ultimo[nome] = dado; (this.ev[nome] || []).forEach(fn => { try { fn(dado); } catch (e) { console.error(nome, e); } }); },
};

export const fmt = {
  num: (v, casas = 0) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas }),
  hora: d => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
  diaSemana: d => d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', ''),
  capital: s => s.charAt(0).toUpperCase() + s.slice(1),
};

export function relativo(seg) {
  const s = Math.max(0, Math.round(seg));
  if (s < 50) return 'agora';
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  return `há ${Math.round(s / 3600)} h`;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Códigos WMO (Open-Meteo) → texto, ícone e "cena" do fundo
const WMO = {
  0: ['Céu limpo', 'limpo'], 1: ['Predominantemente limpo', 'poucas'], 2: ['Parcialmente nublado', 'parcial'],
  3: ['Nublado', 'nublado'], 45: ['Neblina', 'neblina'], 48: ['Neblina com geada', 'neblina'],
  51: ['Garoa fraca', 'garoa'], 53: ['Garoa', 'garoa'], 55: ['Garoa forte', 'garoa'],
  56: ['Garoa congelante', 'garoa'], 57: ['Garoa congelante', 'garoa'],
  61: ['Chuva fraca', 'chuva'], 63: ['Chuva', 'chuva'], 65: ['Chuva forte', 'chuva'],
  66: ['Chuva congelante', 'chuva'], 67: ['Chuva congelante', 'chuva'],
  71: ['Neve fraca', 'neve'], 73: ['Neve', 'neve'], 75: ['Neve forte', 'neve'], 77: ['Grãos de neve', 'neve'],
  80: ['Pancadas de chuva', 'chuva'], 81: ['Pancadas de chuva', 'chuva'], 82: ['Pancadas fortes', 'chuva'],
  85: ['Pancadas de neve', 'neve'], 86: ['Pancadas de neve', 'neve'],
  95: ['Trovoadas', 'tempestade'], 96: ['Trovoadas com granizo', 'tempestade'], 99: ['Trovoadas com granizo', 'tempestade'],
};
const INTENSIDADE = { 51: .25, 53: .35, 55: .5, 56: .3, 57: .4, 61: .45, 63: .7, 65: 1, 66: .5, 67: .8, 80: .55, 81: .8, 82: 1, 95: .9, 96: 1, 99: 1, 71: .4, 73: .7, 75: 1, 77: .4, 85: .6, 86: .9 };

export function clima(codigo, dia = true) {
  const [texto, grupo] = WMO[codigo] || ['—', 'parcial'];
  const icone = {
    limpo: dia ? 'sol' : 'lua', poucas: dia ? 'sol-nuvem' : 'lua-nuvem', parcial: dia ? 'sol-nuvem' : 'lua-nuvem',
    nublado: 'nuvem', neblina: 'neblina', garoa: 'garoa', chuva: 'chuva', neve: 'neve', tempestade: 'tempestade',
  }[grupo];
  const cena = { limpo: 'limpo', poucas: 'limpo', parcial: 'parcial', nublado: 'nublado', neblina: 'neblina', garoa: 'chuva', chuva: 'chuva', neve: 'neve', tempestade: 'tempestade' }[grupo];
  return { texto, icone, cena, intensidade: INTENSIDADE[codigo] ?? 0 };
}

// Cor por temperatura (frio → quente)
const PARADAS = [[-5, [165, 180, 252]], [6, [125, 190, 252]], [14, [103, 232, 249]], [20, [134, 239, 172]], [25, [253, 224, 71]], [30, [251, 146, 60]], [36, [248, 113, 113]]];
export function corTemp(t) {
  if (t <= PARADAS[0][0]) return `rgb(${PARADAS[0][1]})`;
  for (let i = 1; i < PARADAS.length; i++) {
    const [t1, c1] = PARADAS[i];
    if (t <= t1) {
      const [t0, c0] = PARADAS[i - 1]; const k = (t - t0) / (t1 - t0);
      return `rgb(${c0.map((v, j) => Math.round(lerp(v, c1[j], k))).join(',')})`;
    }
  }
  return `rgb(${PARADAS.at(-1)[1]})`;
}

// Curva suave (Catmull-Rom → Bézier) passando por todos os pontos
export function curva(pts) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

// Anima um número de um valor a outro
export function contar(el, para, { casas = 0, dur = 1200 } = {}) {
  const de = parseFloat(el.dataset.v ?? para);
  el.dataset.v = para;
  const t0 = performance.now();
  const passo = agora => {
    const k = clamp((agora - t0) / dur, 0, 1), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt.num(lerp(de, para, e), casas);
    if (k < 1) requestAnimationFrame(passo);
  };
  requestAnimationFrame(passo);
}

export const guardar = {
  ler(chave, padrao) { try { const v = localStorage.getItem(chave); return v === null ? padrao : JSON.parse(v); } catch { return padrao; } },
  gravar(chave, valor) { try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* sem storage */ } },
};
