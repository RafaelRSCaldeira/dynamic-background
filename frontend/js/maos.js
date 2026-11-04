// Reconhecimento de mãos e gestos com MediaPipe — roda 100% no navegador.
// O código e o modelo vêm do próprio servidor (/visao), que os baixa uma vez e guarda em cache.
//
// Saída:
//   maos.maos  → [{ id, pontos:[{x,y}]×21, palma, indicador, gesto, pinca, carga, desenhando, repouso }]
//                coordenadas normalizadas da TELA (0..1, já espelhadas como num espelho).
//                Cada mão faz gestos por conta própria (as duas mãos podem brincar).
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
const ESTAVEL_MS = 120;     // o mesmo gesto por este tempo (e ao menos 2 quadros) para considerá-lo
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
        lado: mao.lado,
        pinca: dist(pontos[4], pontos[8]) / tamanho < 0.33,
      };
    });

    // Associa cada mão detectada à mão do quadro anterior (para manter o histórico de cada uma).
    // Os pares mais próximos são casados primeiro, e trocar esquerda por direita custa caro:
    // assim as duas mãos não "trocam de identidade" quando passam perto uma da outra.
    // Mãos que somem por pouco tempo (borrão de um gesto rápido) continuam no rastreio por 400 ms.
    const anteriores = this._rastreio, usadas = new Set(), vistas = [];
    const limite = anteriores.length === 1 && detectadas.length === 1 ? 0.6 : 0.3;
    const pares = [];
    detectadas.forEach((d, i) => anteriores.forEach(a => {
      const custo = dist(a.palma, d.palma) + (a.lado && d.lado && a.lado !== d.lado ? 0.2 : 0);
      if (custo < limite) pares.push({ i, a, custo });
    }));
    pares.sort((p, q) => p.custo - q.custo);
    const casada = new Map();
    for (const p of pares) if (!casada.has(p.i) && !usadas.has(p.a)) { casada.set(p.i, p.a); usadas.add(p.a); }
    // sobrou exatamente uma mão de cada lado (ex.: deslize rápido, a mão andou muito entre dois quadros): é a mesma
    const soltasD = detectadas.map((_, i) => i).filter(i => !casada.has(i));
    const soltasA = anteriores.filter(a => !usadas.has(a));
    if (soltasD.length === 1 && soltasA.length === 1 && dist(soltasA[0].palma, detectadas[soltasD[0]].palma) < 0.9) {
      casada.set(soltasD[0], soltasA[0]); usadas.add(soltasA[0]);
    }
    for (const [i, d] of detectadas.entries()) {
      const m = casada.get(i) || this._novaMao(t);
      Object.assign(m, d, { visto: t });
      // só brinca quem está perto (com folga de 12% para não piscar bem na fronteira)
      if (m.metros == null) m.perto = true;
      else if (m.metros <= this.distanciaMax) m.perto = true;
      else if (m.metros > this.distanciaMax * 1.12 || m.perto === undefined) m.perto = false;
      m.hist.push({ x: m.palma.x, y: m.palma.y, t });
      while (m.hist.length && t - m.hist[0].t > 1600) m.hist.shift();
      this._atualizarRepouso(m, t);
      vistas.push(m);
    }
    const perdidas = anteriores.filter(a => !usadas.has(a) && t - a.visto < 400);
    this._rastreio = [...vistas, ...perdidas];

    // Cada mão perto da câmera faz gestos por conta própria. Uma mão parada não atrapalha:
    // ela não dispara nada (movimentos exigem movimento, poses exigem a pose segurada).
    const perto = vistas.filter(m => m.perto);
    for (const m of vistas) {
      if (m.perto) this._atualizarGesto(m, t);
      else this._neutralizar(m);
    }
    this.maos = perto;
    this.principal = this._escolherPrincipal(perto);

    const ds = vistas.map(m => m.metros).filter(v => v != null);
    this.distancia = ds.length ? Math.min(...ds) : null;
    const longe = vistas.find(m => !m.perto);
    if (longe && !perto.length && longe.bruto !== 'None') this._emitir('longe', { metros: longe.metros }, 20000);

    if (perto.length && !this._jaApareceu) { this._jaApareceu = true; this.aoEvento?.('apareceu', {}); }
  }

  _novaMao(t) {
    return {
      id: this._proximoId++, hist: [], nasceu: t, gesto: 'None', candidato: 'None', conta: 0, candidatoDesde: t, desde: t,
      disparado: false, punhoDesde: 0, soltouPunho: 0, carga: 0, pincaConta: 0,
      armado: false, quietoDesde: 0, repouso: false, pendente: null, retorno: null,
    };
  }

  /** Mão longe demais: esquece qualquer gesto em andamento (ao chegar perto, começa do zero). */
  _neutralizar(m) {
    Object.assign(m, { gesto: 'None', candidato: 'None', conta: 0, carga: 0, punhoDesde: 0, soltouPunho: 0,
      pincaConta: 0, desenhando: false, disparado: false, armado: false, quietoDesde: 0, pendente: null });
  }

  /** Mão parada, aberta ou relaxada há um tempo = em repouso (a outra mão, ou alguém só assistindo). */
  _atualizarRepouso(m, t) {
    const neutra = m.bruto === 'None' || m.bruto === 'Open_Palm';
    if (!neutra || deriva(m.hist, t, 400) > 0.06) { if (m.repouso || !m.acordouEm) m.acordouEm = t; m.repouso = false; }
    else if (!m.repouso && t - m.nasceu > 1500 && deriva(m.hist, t, 1500) < 0.04) { m.repouso = true; m.acordouEm = 0; m.repousoDesde = t; }
  }

  /** A mão que guia o "ponteiro" do fundo (aurora e partículas). Só isso: gestos valem para todas.
   *  Fica com a mesma mão enquanto ela estiver à vista, para o ponteiro não pular entre as duas. */
  _escolherPrincipal(perto) {
    const atual = this.principal;
    const ocupada = m => m.desenhando || m.carga > .05;
    if (atual && perto.includes(atual) && (ocupada(atual) || !perto.some(m => m !== atual && ocupada(m)))) return atual;
    return perto.find(ocupada) || perto.find(m => !m.repouso) || perto[0] || null;
  }

  _acao(nome, dados, recargaMs) {
    this._ultimaAcao = performance.now();
    this._emitir(nome, dados, recargaMs);
  }

  _atualizarGesto(m, t) {
    // estabiliza o gesto (o classificador oscila entre quadros)
    if (m.bruto === m.candidato) m.conta++;
    else { m.candidato = m.bruto; m.conta = 1; m.candidatoDesde = t; }
    const anterior = m.gesto;
    if (m.conta >= 2 && t - m.candidatoDesde >= ESTAVEL_MS && m.candidato !== m.gesto) {
      m.gesto = m.candidato; m.desde = t; m.disparado = false;
    }

    // "armada" = a mão parou por um instante. Movimentos (deslizar, rolar) só valem a partir daí:
    // assim a volta para a posição neutra, logo depois de um gesto, não conta como outro gesto.
    if (deriva(m.hist, t, 300) < 0.05 && caixa(m.hist, t, 300) < 0.1) {
      // parada desde o ponto mais antigo da janela (com poucos quadros por segundo, não perde tempo)
      if (!m.quietoDesde) m.quietoDesde = m.hist.find(h => t - h.t <= 300)?.t ?? t;
      if (t - m.quietoDesde >= 150) m.armado = true;
      m.ultimoQuieto = t;
      if (m.retorno && !m.retorno.fim) m.retorno.fim = t;   // a mão parou no fim do deslize
    } else m.quietoDesde = 0;
    const livre = t - (this._ultimaAcao || 0) > 900;   // um gesto de cada vez

    // ── punho fechado acumula energia; abrir a mão solta uma explosão ──
    if (m.gesto === 'Closed_Fist') {
      if (!m.punhoDesde) m.punhoDesde = t;
      m.carga = Math.min(1, (t - m.punhoDesde) / 1600);
    } else if (m.punhoDesde) {
      // fechar a mão de passagem (indo para outro gesto) não carrega o suficiente
      if (anterior === 'Closed_Fist' && m.carga >= 0.35) m.soltouPunho = t;
      m.punhoDesde = 0;
    }
    if (m.soltouPunho && m.gesto === 'Open_Palm') {
      if (t - m.soltouPunho < 800) { this._acao('explosao', { x: m.palma.x, y: m.palma.y, carga: m.carga }, 500); m.armado = false; }
      m.soltouPunho = 0; m.carga = 0;
    } else if (m.soltouPunho && t - m.soltouPunho > 800) { m.soltouPunho = 0; m.carga = 0; }
    if (m.gesto !== 'Closed_Fist' && !m.soltouPunho) m.carga = Math.max(0, m.carga - 0.05);

    // ── gestos que disparam ações ao serem mantidos: precisa segurar PARADO ──
    // (uma pose que aparece de passagem, com a mão em movimento, não conta)
    const acao = ACOES[m.gesto];
    if (acao && !m.disparado && livre && t - m.desde > SEGURAR_MS && parada(m.hist, t, SEGURAR_MS)) {
      m.disparado = true; m.armado = false;
      this._acao(acao, { x: m.palma.x, y: m.palma.y }, 1500);
    }

    // ── desenhar no ar: indicador apontado, ou pinça com os outros dedos abertos ──
    const dedosAbertos = dist(m.pontos[12], m.pontos[0]) > 1.5 * m.tamanho;
    m.pincaConta = m.pinca && dedosAbertos && m.candidato !== 'Closed_Fist' ? m.pincaConta + 1 : 0;
    m.desenhando = m.gesto === 'Pointing_Up' || m.pincaConta >= 2;
    if (m.desenhando) m.desenhouEm = t;
    if (m.gesto === 'Closed_Fist' || m.desenhando) { m.armado = false; m.pendente = null; return; }

    // movimento confirmado um instante depois: se a mão saiu por baixo (baixando para descansar), não vale
    if (m.pendente) {
      if (t >= m.pendente.ate) {
        const p = m.pendente; m.pendente = null;
        if (m.palma.y < 0.9 && t - p.criado < 700) {
          this._acao(p.nome, p.dados, 850);
          m.retorno = { eixo: p.eixo, dir: p.dir, t };
        }
      }
      return;
    }

    // ── deslizar (para o lado) e rolar (mão aberta para cima/baixo) ──
    const janela = m.hist.filter(h => t - h.t < 450);
    if (janela.length >= 2) {
      const dx = m.palma.x - janela[0].x, dy = m.palma.y - janela[0].y;
      const lado = Math.abs(dx) > 0.22 && Math.abs(dy) < Math.abs(dx) * 0.6;
      const vertical = !lado && Math.abs(dy) > 0.22 && Math.abs(dx) < Math.abs(dy) * 0.6 && m.gesto === 'Open_Palm';
      if (lado || vertical) {
        const eixo = lado ? 'x' : 'y', dir = Math.sign(lado ? dx : dy);
        // depois de um deslize, o primeiro movimento no sentido contrário é a mão voltando: ignora
        // (se a mão ficou parada no fim por mais de ~1 s, é um deslize de propósito para o outro lado)
        const volta = m.retorno && m.retorno.eixo === eixo && m.retorno.dir === -dir && t - m.retorno.t < 3000
          && (!m.retorno.fim || (m.ultimoQuieto || 0) - m.retorno.fim < 900);
        if (volta) m.retorno = null;
        else if (!m.armado && m.gesto === 'Open_Palm' && t - m.nasceu > 1500 && t - (m.desenhouEm || 0) > 2000
          && t - (this._ultimaAcao || 0) > 2500) {
          this._emitir('dica', { texto: 'Pare a mão por um instante antes de deslizar' }, 15000);   // ensina a regra
        } else if (m.armado && livre && lado) {
          // para o lado vale na hora (mesmo que a mão saia da imagem no fim do movimento)
          this._acao('deslizar', { dir, y: m.palma.y }, 850);
          m.retorno = { eixo, dir, t };
        } else if (m.armado && livre) {
          // para cima/baixo espera um instante: se a mão saiu por baixo (baixando para descansar), não vale
          m.pendente = { nome: 'rolar', eixo, dir, criado: t, ate: t + 180, dados: { dir, x: m.palma.x, y: m.palma.y } };
        }
        m.hist = [m.hist.at(-1)]; m.armado = false; m.quietoDesde = 0;
        return;
      }
    }

    // ── acenar ("tchau"): a palma vai e volta várias vezes, em pouco espaço ──
    if (m.gesto === 'Open_Palm' && m.hist.length > 8 && livre) {
      let viradas = 0, dirAnt = 0, ext = m.hist[0].x;
      for (const h of m.hist) {
        const d = h.x - ext;
        if (Math.abs(d) > 0.06) {   // tremor não é aceno: cada ida/volta precisa de ~6% da tela
          const dir = Math.sign(d);
          if (dirAnt && dir !== dirAnt) viradas++;
          dirAnt = dir; ext = h.x;
        }
      }
      const xs = m.hist.map(h => h.x), amp = Math.max(...xs) - Math.min(...xs);
      if (viradas >= 3 && amp > 0.1 && amp < 0.35) { this._acao('oi', { x: m.palma.x, y: m.palma.y }, 6000); m.hist = [m.hist.at(-1)]; m.armado = false; }
    }
  }
}

/** Pose "segurada": sem deslocamento (deriva) e sem sacudir muito (o tremor normal passa;
 *  gesticular, não). */
function parada(hist, t, ms) {
  return deriva(hist, t, ms) < 0.04 && caixa(hist, t, ms) < 0.12;
}

/** Tamanho da área por onde a palma passou na janela (pega idas e voltas, que a deriva não vê). */
function caixa(hist, t, ms) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (let i = hist.length - 1; i >= 0 && t - hist[i].t <= ms; i--) {
    const h = hist[i];
    x0 = Math.min(x0, h.x); x1 = Math.max(x1, h.x); y0 = Math.min(y0, h.y); y1 = Math.max(y1, h.y);
  }
  return x1 >= x0 ? Math.hypot(x1 - x0, y1 - y0) : 0;
}

/** Quanto a palma realmente se deslocou numa janela de tempo: compara a média do começo com a
 *  média do fim da janela. O tremor natural da mão (e o ruído do detector) se anula na média;
 *  só um movimento de verdade conta. */
function deriva(hist, t, ms) {
  const j = [];
  for (let i = hist.length - 1; i >= 0 && t - hist[i].t <= ms; i--) j.push(hist[i]);
  if (j.length < 2) return Infinity;   // um ponto só não diz se a mão está parada
  const k = Math.ceil(j.length / 2);   // metade mais recente × metade mais antiga
  const media = a => ({ x: a.reduce((s, h) => s + h.x, 0) / a.length, y: a.reduce((s, h) => s + h.y, 0) / a.length });
  return dist(media(j.slice(0, k)), media(j.slice(j.length - k)));
}
