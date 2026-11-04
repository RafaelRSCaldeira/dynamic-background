// Reconhecimento de mãos e gestos com MediaPipe — roda 100% no navegador.
// O código e o modelo vêm do próprio servidor (/visao), que os baixa uma vez e guarda em cache.
//
// Saída:
//   maos.maos  → [{ id, pontos:[{x,y}]×21, palma, indicador, gesto, pinca, carga, desenhando }]
//                coordenadas normalizadas da TELA (0..1, já espelhadas como num espelho)
//   aoEvento(nome, dados) → 'joinha' | 'cena' | 'coracoes' | 'desfazer' | 'explosao' | 'deslizar' | 'rolar' | 'oi'
//                          | 'apareceu' | 'longe' (alguém além da distância máxima tentou brincar)

export const CONEXOES = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
export const PONTAS = [4, 8, 12, 16, 20];

// Gestos que disparam uma ação quando mantidos por um instante
const ACOES = { Thumb_Up: 'joinha', Victory: 'cena', ILoveYou: 'coracoes', Thumb_Down: 'desfazer' };
const SEGURAR_MS = 450;     // tempo segurando o gesto até disparar
const ESTAVEL = 3;          // quadros seguidos com o mesmo gesto para considerá-lo
// Só o centro da câmera é analisado, ampliado ("zoom digital"): o modelo reduz a imagem inteira
// para ~200 px, e uma mão a 2 m da câmera fica pequena demais. Ampliar o centro faz muita diferença.
// Bônus: não é preciso esticar o braço até a borda para alcançar os cantos da tela.
const MARGEM = 0.16;

// Distância até a câmera: o MediaPipe dá o tamanho REAL da mão (em metros); comparando com o
// tamanho dela na imagem (em ângulo), sai a distância — vale para mãos grandes, pequenas ou inclinadas.
const OSSOS = [[0, 5], [0, 9], [0, 17], [5, 17], [5, 9], [9, 13], [13, 17]];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const limitar = v => Math.min(1, Math.max(0, v));

export class Maos {
  constructor({ distanciaMax = 2, campoVisao = 65 } = {}) {
    this.distanciaMax = distanciaMax;          // metros
    this.campoVisao = campoVisao * Math.PI / 180; // horizontal, em radianos
    this.distancia = null;                     // da mão mais próxima (para mostrar em Ajustes)
    this.estado = 'desligado'; // desligado | carregando | pronto | erro
    this.erro = '';
    this.maos = [];
    this.aoEvento = null;
    this.aoEstado = null;
    this._rastreio = [];   // estado por mão entre quadros
    this._ultimoTempo = -1;
    this._proximoId = 1;
    this._recarga = {};    // cooldown por evento
    this._jaApareceu = false;
  }

  _mudarEstado(e, erro = '') { this.estado = e; this.erro = erro; this.aoEstado?.(e); }

  async ligar(video) {
    this.video = video;
    if (!this._worker) {
      if (!this._carregando) {
        this._mudarEstado('carregando');
        this._carregando = this._iniciarWorker();
      }
      try { this._worker = await this._carregando; }
      catch (e) {
        console.warn('Reconhecimento de mãos indisponível:', e);
        this._carregando = null;
        this._mudarEstado('erro', String(e?.message || e));
        return false;
      }
      this._carregando = null;
    }
    if (!this.video) return false; // desligaram enquanto carregava
    this._mudarEstado('pronto');
    if (!this._timer) this._timer = setInterval(() => this._enviarQuadro(), 1000 / 60);
    return true;
  }

  // O MediaPipe roda num worker: a análise (10–30 ms por quadro) não disputa a thread da animação.
  _iniciarWorker() {
    return new Promise((ok, falha) => {
      const w = new Worker('/js/maos-worker.js');
      w.onmessage = ({ data }) => {
        if (data.tipo === 'resultado') this._resultado(data);
        else if (data.tipo === 'pronto') { this.delegate = data.delegate; console.info('Mãos: MediaPipe pronto (' + data.delegate + ')'); ok(w); }
        else if (data.tipo === 'erro') { w.terminate(); falha(new Error(data.erro)); }
      };
      w.onerror = e => { e.preventDefault?.(); w.terminate(); falha(new Error(e.message || 'falha ao carregar o worker')); };
      // CPU (WASM/XNNPACK) por padrão: no worker não trava a página e não disputa a GPU com a aurora.
      // Para testar a GPU: /?maos=gpu
      w.postMessage({ tipo: 'iniciar', delegate: new URLSearchParams(location.search).get('maos')?.toUpperCase() || 'CPU' });
    });
  }

  desligar() {
    clearInterval(this._timer); this._timer = null;
    this.video = null; this.maos = []; this._rastreio = []; this.distancia = null;
    if (this.estado !== 'erro') this._mudarEstado('desligado');
  }

  _emitir(nome, dados, recargaMs = 1200) {
    const agora = performance.now();
    if ((this._recarga[nome] || 0) > agora) return;
    this._recarga[nome] = agora + recargaMs;
    this.aoEvento?.(nome, dados);
  }

  _enviarQuadro() {
    const v = this.video;
    if (!v || !this._worker || this._ocupado || document.hidden || v.readyState < 2 || v.currentTime === this._ultimoTempo) return;
    // sem mão à vista, 12 quadros/s bastam para notar quem levanta a mão; com mão, 30/s
    const t = performance.now();
    const intervalo = this._rastreio.length ? 1000 / 30 : 1000 / 12;
    if (t - (this._ultimoEnvio || 0) < intervalo - 4) return;
    this._ultimoEnvio = t;
    this._ultimoTempo = v.currentTime;
    this._ocupado = true;

    // recorta só o centro do vídeo (zoom digital); o recorte é feito fora da thread principal
    const vw = v.videoWidth, vh = v.videoHeight;
    const cw = Math.round(vw * (1 - 2 * MARGEM)), ch = Math.round(vh * (1 - 2 * MARGEM));
    createImageBitmap(v, Math.round(vw * MARGEM), Math.round(vh * MARGEM), cw, ch).then(imagem => {
      if (!this.video) { imagem.close(); this._ocupado = false; return; }
      this._tQuadro = t;
      this._dims = { cw, ch, vw };
      this._worker.postMessage({ tipo: 'quadro', imagem, t }, [imagem]);
    }).catch(() => { this._ocupado = false; });
  }

  _resultado({ maos, ms }) {
    this._ocupado = false;
    this.msAnalise = this.msAnalise ? this.msAnalise * .9 + ms * .1 : ms;
    if (!this.video) return;
    const t = this._tQuadro, { cw, ch, vw } = this._dims;

    // converte para coordenadas de tela, espelhadas (como num espelho)
    const detectadas = maos.map(mao => {
      const pontos = mao.pontos.map(([x, y]) => ({ x: limitar(1 - x), y: limitar(y) }));
      const palma = [0, 5, 9, 13, 17].reduce((s, k) => ({ x: s.x + pontos[k].x / 5, y: s.y + pontos[k].y / 5 }), { x: 0, y: 0 });
      const tamanho = Math.max(0.02, dist(pontos[0], pontos[9]));
      let real = 0, angulo = 0;
      if (mao.mundo.length === 21) for (const [a, b] of OSSOS) {
        real += Math.hypot(mao.mundo[a][0] - mao.mundo[b][0], mao.mundo[a][1] - mao.mundo[b][1]);
        angulo += Math.hypot((mao.pontos[a][0] - mao.pontos[b][0]) * cw, (mao.pontos[a][1] - mao.pontos[b][1]) * ch) / vw * this.campoVisao;
      }
      return {
        pontos, palma, tamanho,
        metros: real && angulo ? real / angulo : null,
        indicador: pontos[8],
        bruto: mao.score > 0.55 ? mao.gesto : 'None',
        pinca: dist(pontos[4], pontos[8]) / tamanho < 0.33,
      };
    });

    // associa cada mão detectada à mão anterior mais próxima (para manter o histórico).
    // Mãos que somem por pouco tempo (borrão de um gesto rápido) continuam no rastreio por 400 ms.
    const anteriores = this._rastreio, usadas = new Set(), vistas = [];
    for (const d of detectadas) {
      let melhor = null, md = anteriores.length === 1 && detectadas.length === 1 ? 0.6 : 0.3;
      for (const a of anteriores) {
        if (usadas.has(a)) continue;
        const dd = dist(a.palma, d.palma);
        if (dd < md) { md = dd; melhor = a; }
      }
      if (melhor) usadas.add(melhor);
      const m = melhor || { id: this._proximoId++, hist: [], gesto: 'None', candidato: 'None', conta: 0, desde: t, disparado: false, punhoDesde: 0, soltouPunho: 0, carga: 0 };
      Object.assign(m, d, { visto: t });
      // só brinca quem está perto (com folga de 12% para não piscar bem na fronteira)
      if (m.metros == null) m.perto = true;
      else if (m.metros <= this.distanciaMax) m.perto = true;
      else if (m.metros > this.distanciaMax * 1.12 || m.perto === undefined) m.perto = false;
      if (m.perto) this._atualizarGesto(m, t);
      else Object.assign(m, { hist: [], gesto: 'None', candidato: 'None', conta: 0, carga: 0, punhoDesde: 0, soltouPunho: 0, desenhando: false });
      vistas.push(m);
    }
    const perdidas = anteriores.filter(a => !usadas.has(a) && t - a.visto < 400);
    this._rastreio = [...vistas, ...perdidas];
    this.maos = vistas.filter(m => m.perto);
    const ds = vistas.map(m => m.metros).filter(v => v != null);
    this.distancia = ds.length ? Math.min(...ds) : null;
    const longe = vistas.find(m => !m.perto);
    if (longe && !this.maos.length && longe.bruto !== 'None') this._emitir('longe', { metros: longe.metros }, 20000);

    if (vistas.length && !this._jaApareceu) { this._jaApareceu = true; this.aoEvento?.('apareceu', {}); }
  }

  _atualizarGesto(m, t) {
    // estabiliza o gesto (o classificador oscila entre quadros)
    if (m.bruto === m.candidato) m.conta++;
    else { m.candidato = m.bruto; m.conta = 1; }
    const anterior = m.gesto;
    if (m.conta >= ESTAVEL && m.candidato !== m.gesto) {
      m.gesto = m.candidato; m.desde = t; m.disparado = false;
    }

    // ── punho fechado acumula energia; abrir a mão solta uma explosão ──
    if (m.gesto === 'Closed_Fist') {
      if (!m.punhoDesde) m.punhoDesde = t;
      m.carga = Math.min(1, (t - m.punhoDesde) / 1600);
    } else if (m.punhoDesde) {
      if (anterior === 'Closed_Fist' && m.carga > 0.18) m.soltouPunho = t;
      m.punhoDesde = 0;
    }
    if (m.soltouPunho && (m.gesto === 'Open_Palm' || m.gesto === 'None' || m.gesto === 'ILoveYou')) {
      if (t - m.soltouPunho < 700) this._emitir('explosao', { x: m.palma.x, y: m.palma.y, carga: m.carga }, 500);
      m.soltouPunho = 0; m.carga = 0;
    } else if (m.soltouPunho && t - m.soltouPunho > 700) { m.soltouPunho = 0; m.carga = 0; }
    if (m.gesto !== 'Closed_Fist' && !m.soltouPunho) m.carga = Math.max(0, m.carga - 0.05);

    // ── gestos que disparam ações ao serem mantidos ──
    const acao = ACOES[m.gesto];
    if (acao && !m.disparado && t - m.desde > SEGURAR_MS) {
      m.disparado = true;
      this._emitir(acao, { x: m.palma.x, y: m.palma.y }, 1500);
    }

    // ── desenhar no ar: indicador apontado ou pinça ──
    m.desenhando = m.gesto === 'Pointing_Up' || m.pinca;

    // ── movimento: deslizar e acenar ──
    m.hist.push({ x: m.palma.x, y: m.palma.y, t });
    while (m.hist.length && t - m.hist[0].t > 1600) m.hist.shift();
    if (m.gesto === 'Closed_Fist' || m.desenhando) return;

    // deslizar: a palma percorre ~1/4 da tela na horizontal em menos de 0,5 s
    const janela = m.hist.filter(h => t - h.t < 500);
    if (janela.length >= 2) {
      const dx = m.palma.x - janela[0].x, dy = m.palma.y - janela[0].y;
      if (Math.abs(dx) > 0.25 && Math.abs(dy) < Math.abs(dx) * 0.7) {
        this._emitir('deslizar', { dir: Math.sign(dx), y: m.palma.y }, 850);
        m.hist = [];
        return;
      }
      // para cima/baixo, com a mão aberta: rola a lista da Sala (mão fechada ou baixando à toa não conta)
      if (Math.abs(dy) > 0.25 && Math.abs(dx) < Math.abs(dy) * 0.7 && m.gesto === 'Open_Palm') {
        this._emitir('rolar', { dir: Math.sign(dy), x: m.palma.x, y: m.palma.y }, 700);
        m.hist = [];
        return;
      }
    }

    // acenar ("tchau"): a palma vai e volta várias vezes, em pouco espaço
    if (m.gesto === 'Open_Palm' && m.hist.length > 8) {
      let viradas = 0, dirAnt = 0, ext = m.hist[0].x;
      for (const h of m.hist) {
        const d = h.x - ext;
        if (Math.abs(d) > 0.035) {
          const dir = Math.sign(d);
          if (dirAnt && dir !== dirAnt) viradas++;
          dirAnt = dir; ext = h.x;
        }
      }
      const xs = m.hist.map(h => h.x), amp = Math.max(...xs) - Math.min(...xs);
      if (viradas >= 3 && amp < 0.3) { this._emitir('oi', { x: m.palma.x, y: m.palma.y }, 6000); m.hist = []; }
    }
  }
}
