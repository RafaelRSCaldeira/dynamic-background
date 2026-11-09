// Palco do Zak: a tela inteira vira a cena do assunto da conversa.
// Uma cena por vez. O texto entra na hora; a foto (4K, já filtrada no servidor) chega depois,
// aparece devagar e tinge o fundo animado com a paleta dela. Sem nada para mostrar, volta ao repouso.
import { esc } from '../util.js';
import { mini } from '../icones.js';
import { paletaDeCores, paletaDeTom } from '../paleta.js';
import { blocoHTML, tiqueContagens, LARGOS } from './blocos.js';

const DURACAO_S = { ambiente: 150, conversa: 75 };
const DEPOIS_DO_ALARME_S = 40;
const HISTORICO = 12;
const MAX_BLOCOS = 4, MAX_BLOCOS_PAINEL = 9;
const PASSO_CARROSSEL_MS = 6500;   // cada carrossel anda um card por vez, defasado dos outros
const K_MIN_PAINEL = 0.62;         // painel: abaixo disso o texto fica pequeno demais de longe — a tela rola devagar

// ── encaixe: nada sai da tela nem vaza do card ──────────────
// 1) cada texto grande que não cabe na largura do seu card/coluna diminui (--f) até caber;
// 2) se a cena inteira passa da altura disponível, ela toda diminui por igual (--k, via zoom).
// Só o que nem assim couber é quebrado no meio da palavra (overflow-wrap no CSS).
// números e títulos podem encolher bastante; textos corridos só até 70% (depois disso a palavra quebra)
const ALVOS = { '.b-titulo, .b-numero, .b-comparacao, .b-clima': 0.42, '.b-fatos, .b-tempo, .b-citacao, .b-lista, .b-passos, .cr-card, .b-tabela, .b-barras, .b-texto': 0.7 };
const K_MIN = 0.45;
const vaza = el => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1;

function encaixarLargura(cena, doZero) {
  cena.classList.add('medindo');
  for (const [seletor, minimo] of Object.entries(ALVOS)) {
    for (const alvo of cena.querySelectorAll(seletor)) {
      let f = doZero ? 1 : parseFloat(alvo.style.getPropertyValue('--f')) || 1;
      alvo.style.setProperty('--f', f);
      const partes = [alvo, ...alvo.querySelectorAll('*')];
      while (f > minimo + 0.001 && partes.some(vaza)) {
        f = Math.max(minimo, f - 0.05);
        alvo.style.setProperty('--f', f.toFixed(2));
      }
    }
  }
  cena.classList.remove('medindo');
}

export function encaixar(cena) {
  if (!cena?.isConnected) return;
  const painel = cena.classList.contains('layout-painel');
  cena.classList.remove('rolar');
  cena.style.setProperty('--k', 1);
  encaixarLargura(cena, true);
  // a altura é medida já com a quebra de palavras normal (ela muda a altura)
  const cs = getComputedStyle(cena);
  const disponivel = cena.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const altura = () => {
    const r = [...cena.children].map(e => e.getBoundingClientRect());
    return Math.max(...r.map(x => x.bottom)) - Math.min(...r.map(x => x.top));
  };
  let k = 1;
  while (k > (painel ? K_MIN_PAINEL : K_MIN) && altura() > disponivel) {
    k -= 0.03;
    cena.style.setProperty('--k', k.toFixed(2));
  }
  // reduzida, a cena muda de forma (um card "estreito" volta a ser "largo" e põe a comparação em colunas): confere de novo
  encaixarLargura(cena, false);
  // painel que nem assim cabe: em vez de letras miúdas, a tela desce devagar até o fim e volta
  const sobra = altura() - disponivel;
  if (painel && sobra > 4) {
    cena.style.setProperty('--rolar', `${(-sobra / k).toFixed(0)}px`);
    cena.style.setProperty('--rolar-s', `${Math.max(24, sobra / 14).toFixed(0)}s`);
    cena.classList.add('rolar');
  }
}

/** Painel: blocos largos ocupam a linha toda; um bloco estreito que ficaria sozinho na linha também. */
function larguras(blocos) {
  const largo = blocos.map(b => LARGOS.has(b.tipo));
  let sozinho = -1;
  largo.forEach((l, i) => {
    if (l) { if (sozinho >= 0) largo[sozinho] = true; sozinho = -1; }
    else sozinho = sozinho >= 0 ? -1 : i;
  });
  if (sozinho >= 0) largo[sozinho] = true;
  return largo;
}

const comTempo = (p, ms) => Promise.race([p, new Promise((_, n) => setTimeout(() => n(new Error('tempo')), ms))]);

export class Palco {
  constructor({ aoPaleta, aoAlarme, aoMudar } = {}) {
    Object.assign(this, { aoPaleta, aoAlarme, aoMudar });
    this.el = Object.assign(document.createElement('section'), { id: 'palco' });
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `
      <div class="pc-fotos" aria-hidden="true"></div>
      <div class="pc-veu" aria-hidden="true"></div>
      <div class="pc-cenas"></div>
      <p class="pc-aviso" aria-live="polite"></p>
      <div class="pc-gerando" role="status" aria-live="polite">
        <svg class="pg-anel" viewBox="0 0 44 44" aria-hidden="true"><circle class="pg-trilho" cx="22" cy="22" r="19"/><circle class="pg-arco" cx="22" cy="22" r="19" pathLength="100"/></svg>
        <div class="pg-texto"><b class="pg-titulo"></b><small class="pg-detalhe"></small></div>
      </div>
      <header class="pc-topo"><span class="pc-origem"></span><span class="pc-hora"></span></header>
      <footer class="pc-credito"></footer>`;
    document.getElementById('luzes').before(this.el);
    this.$ = s => this.el.querySelector(s);
    this.historico = []; this.pos = -1; this.token = 0; this.atual = null; this.ate = 0;
    setInterval(() => this._tique(), 250);
    let espera = 0;   // tela girada/redimensionada: encaixa de novo
    addEventListener('resize', () => { clearTimeout(espera); espera = setTimeout(() => encaixar(this.$('.pc-cena:not(.sai)')), 200); });
  }

  get ativa() { return !!this.atual; }
  get nome() { return this.atual?.blocos?.[0]?.titulo || ''; }

  /** Mostra uma cena: { origem: 'ambiente'|'conversa', pergunta?, visual: { busca?, cor? }, blocos: [...] } */
  mostrar(cena, { daHistoria = false, sentido = 1 } = {}) {
    const painel = cena.formato === 'painel';
    cena = { ...cena, blocos: (cena.blocos || []).filter(b => b && b.tipo).slice(0, painel ? MAX_BLOCOS_PAINEL : MAX_BLOCOS) };
    if (!cena.blocos.length && !cena.galeria) return;
    const token = ++this.token;
    this._acordar?.();
    if (!daHistoria) {
      this.historico = this.historico.slice(0, this.pos + 1).concat([cena]).slice(-HISTORICO);
      this.pos = this.historico.length - 1;
    }
    this.atual = cena;
    const temContagem = cena.blocos.some(b => b.tipo === 'contagem');
    this.ate = temContagem || cena.galeria ? Infinity : Date.now() + (cena.duracao_s || DURACAO_S[cena.origem] || 120) * 1000;

    const comImagem = cena.visual?.busca || cena.visual?.gerar || cena.foto;
    const layout = cena.galeria ? 'galeria' : painel ? 'painel'
      : cena.layout || (temContagem ? 'foco' : comImagem ? 'foto' : 'texto');
    document.body.classList.add('em-cena');
    document.body.dataset.layout = layout;
    this.aviso('');
    this.gerando(null);
    if (cena.galeria) {
      // só as imagens, em tela cheia: sem texto, sem cards
      this._trocarConteudo(null);
      this.$('.pc-origem').innerHTML = '';
      this._galeria(cena, token);
      this.aoMudar?.(cena);
      return;
    }
    const [heroi, ...resto] = cena.blocos;
    const largo = painel ? larguras(resto) : [];
    const novo = document.createElement('div');
    novo.className = `pc-cena layout-${layout} entra`;
    novo.style.setProperty('--sentido', sentido);
    novo.innerHTML = `
      <div class="pc-heroi">${blocoHTML(heroi, 0)}</div>
      ${resto.length ? `<div class="pc-blocos n${resto.length}">${resto.map((b, i) => blocoHTML(b, i + 1, largo[i])).join('')}</div>` : ''}`;
    this._trocarConteudo(novo);
    encaixar(novo);
    document.fonts?.ready.then(() => { if (token === this.token) encaixar(novo); });

    this.$('.pc-origem').innerHTML = cena.origem === 'conversa'
      ? `${mini.pergunta}<span>${esc(cena.pergunta || 'Você perguntou')}</span>`
      : `${mini.sala}<span>Assunto na sala</span>`;
    tiqueContagens(this.el);
    if (painel) this._fotosDosCards(cena, novo, token);

    // paleta: a do tom pedido agora; a da foto quando ela chegar
    if (cena.visual?.cor) this.aoPaleta?.(paletaDeTom(cena.visual.cor));
    if (cena.foto) this._mostrarFoto(cena.foto, token);
    else if (cena.visual?.busca || cena.visual?.gerar) this._buscarFoto(cena, token);
    else this._limparFotos();
    this.aoMudar?.(cena);
  }

  /** Progresso da geração de imagem, enviado pelo servidor: carregando o modelo, etapa 3 de 9, pronto. */
  progressoImagem(msg) {
    this._prog = { ...msg, t: Date.now() };
    this._pintarGerando();
  }

  /** Status "gerando imagem": 'centro' (ainda não há imagem na tela), 'canto' (pílula discreta) ou null. */
  gerando(modo, rotulo = 'Gerando a imagem') {
    const el = this.$('.pc-gerando');
    if (modo && !this._gerando) this._gerandoDesde = Date.now();
    this._gerando = modo ? { modo, rotulo } : null;
    el.classList.toggle('visivel', !!modo);
    if (modo) { el.classList.toggle('centro', modo === 'centro'); el.classList.toggle('canto', modo === 'canto'); }
    this._pintarGerando();
  }

  _pintarGerando() {
    if (!this._gerando) return;
    const el = this.$('.pc-gerando');
    // um aviso de uma geração que já tinha acabado antes desta espera não vale
    const p = this._prog && !(['pronto', 'erro'].includes(this._prog.estado) && this._prog.t < this._gerandoDesde) ? this._prog : {};
    const seg = Math.round((Date.now() - this._gerandoDesde) / 1000);
    let titulo = this._gerando.rotulo, detalhe = seg >= 2 ? `${seg} s` : '', fracao = null;
    if (p.estado === 'carregando') {
      titulo = 'Preparando o gerador de imagens';
      detalhe = [this._gerando.modo === 'centro' ? 'na primeira vez leva cerca de 1 minuto' : '', seg >= 2 ? `${seg} s` : ''].filter(Boolean).join(' · ');
    } else if (p.estado === 'gerando' && p.total) {
      fracao = p.passo / p.total;
      detalhe = `etapa ${p.passo} de ${p.total}`;
    } else if (p.estado === 'pronto') {
      fracao = 1;
      detalhe = 'finalizando…';
    }
    el.querySelector('.pg-titulo').textContent = titulo;
    el.querySelector('.pg-detalhe').textContent = detalhe;
    el.classList.toggle('indeterminado', fracao == null);
    el.style.setProperty('--prog', (fracao ?? 0).toFixed(3));
  }

  /** Recado discreto no meio da tela (galeria: "Buscando imagens…" até a primeira chegar). */
  aviso(texto) {
    const el = this.$('.pc-aviso');
    if (texto) el.textContent = texto;
    el.classList.toggle('visivel', !!texto);
  }

  /** Galeria: uma imagem depois da outra, em tela cheia, até pedirem outra coisa. */
  async _galeria(cena, token) {
    const g = cena.galeria, intervalo = (g.intervalo_s || 14) * 1000;
    const vivo = () => token === this.token;
    const espera = ms => new Promise(ok => { const t = setTimeout(ok, ms); this._acordar = () => { clearTimeout(t); ok(); }; });
    const json = async (url, ms) => { const r = await comTempo(fetch(url), ms); if (!r.ok) throw new Error(r.status); return r.json(); };
    let proxima, gera = false;
    const gerarDe = descricoes => {
      // a mesma descrição volta com outra semente: variações da ideia, sem repetir
      let i = 0;
      gera = true;
      this.aviso('');
      this.gerando('centro');
      return () => {
        const n = i++, p = descricoes[n % descricoes.length], s = Math.floor(n / descricoes.length);
        return json(`/api/imagem/gerar?p=${encodeURIComponent(p)}${s ? `&s=${s}` : ''}`, 600000);
      };
    };
    if (g.gerar) proxima = gerarDe(g.imagens);
    else {
      this.aviso('Buscando imagens…');
      let lista = cena._lista;
      for (let tentativa = 0; !lista && vivo(); tentativa++) {
        try { lista = (await json('/api/imagem/galeria?' + g.imagens.map(q => `q=${encodeURIComponent(q)}`).join('&'), 120000)).itens; }
        catch { if (tentativa >= 2) break; await espera(5000); }
      }
      if (!vivo()) return;
      if (lista?.length) {
        cena._lista = lista;   // no histórico a galeria volta sem buscar de novo
        let i = 0;
        proxima = () => json(`/api/imagem/item/${lista[i++ % lista.length].id}`, 60000);
      } else if (g.reserva?.length) proxima = gerarDe(g.reserva);   // nenhuma foto boa do tema: gera
      else { this.aviso('Não encontrei imagens boas desse tema.'); return; }
    }
    this._limparFotos();
    let falhas = 0, foto = null;
    const buscar = async () => {
      while (vivo()) {
        try { const f = await proxima(); falhas = 0; return f; }
        catch {
          if (++falhas >= 4) {
            if (!foto) { this.gerando(null); this.aviso(gera ? 'O gerador de imagens não respondeu.' : 'Não consegui carregar as imagens.'); }
            await espera(30000);
          }
        }
      }
      return null;
    };
    foto = await buscar();
    while (vivo() && foto) {
      await this._mostrarFoto(foto, token, { galeria: true });
      if (!vivo()) return;
      this.aviso('');
      this.gerando(null);
      // a próxima já vem enquanto esta fica na tela; se ela demorar mais que o intervalo, a pílula do canto avisa
      let chegou = false;
      const prox = buscar().then(f => { chegou = true; return f; });
      await espera(intervalo);
      if (!vivo()) return;
      if (!chegou && gera) this.gerando('canto', 'Gerando a próxima imagem');
      foto = await prox;
    }
    if (vivo()) this.gerando(null);
  }

  /** Fotos dos cards dos carrosséis: uma busca por vez (as primeiras de cada carrossel antes). */
  async _fotosDosCards(cena, raiz, token) {
    cena._fotos ??= {};
    const els = [...raiz.querySelectorAll('.cr-foto[data-foto]')]
      .sort((a, b) => (+a.closest('.cr-card').style.getPropertyValue('--c')) - (+b.closest('.cr-card').style.getPropertyValue('--c')));
    const pintar = (el, url) => { el.style.backgroundImage = `url("${url}")`; el.classList.add('ok'); };
    const fila = [];
    for (const el of els) {
      const q = el.dataset.foto;
      if (cena._fotos[q]) pintar(el, cena._fotos[q]);
      else if (cena._fotos[q] !== null) fila.push(el);
    }
    const trabalhar = async () => {
      while (fila.length && token === this.token) {
        const el = fila.shift(), q = el.dataset.foto;
        try {
          const r = await comTempo(fetch(`/api/imagem/card?q=${encodeURIComponent(q)}`), 40000);
          if (!r.ok) throw new Error(r.status);
          const url = (await r.json()).url;
          cena._fotos[q] = url;
          if (token === this.token) pintar(el, url);
        } catch { cena._fotos[q] = null; el.classList.add('sem'); }
      }
    };
    await Promise.all([trabalhar(), trabalhar()]);
  }

  /** Carrosséis: cada um anda um card a cada poucos segundos; no fim, volta ao começo. */
  _girar() {
    const agora = Date.now();
    [...this.el.querySelectorAll('.pc-cena:not(.sai) .b-carrossel')].forEach((c, k) => {
      if (!c._prox) { c._prox = agora + PASSO_CARROSSEL_MS + k * 1900; c._pos = 0; this._pontos(c, 1); return; }
      if (agora < c._prox) return;
      c._prox = agora + PASSO_CARROSSEL_MS;
      const n = +c.dataset.n, vis = Math.min(n, parseFloat(getComputedStyle(c).getPropertyValue('--vis')) || 1);
      if (n <= vis) return;
      c._pos = c._pos + vis >= n ? 0 : c._pos + 1;
      c.style.setProperty('--pos', c._pos);
      this._pontos(c, vis);
    });
  }

  _pontos(c, vis) {
    [...c.querySelectorAll('.cr-pontos i')].forEach((p, i) => p.classList.toggle('on', i >= (c._pos || 0) && i < (c._pos || 0) + vis));
  }

  repouso() {
    this.token++;
    this._acordar?.();
    this.aviso('');
    this.gerando(null);
    if (!this.atual) return;
    this.atual = null; this.ate = 0;
    this._trocarConteudo(null);
    this._limparFotos();
    this.$('.pc-origem').innerHTML = '';
    document.body.classList.remove('em-cena');
    delete document.body.dataset.layout;
    this.aoPaleta?.(null);
    this.aoMudar?.(null);
  }

  /** ← / → (teclado ou deslizar a mão): anda pelo histórico de cenas. */
  navegar(delta) {
    if (this.atual?.galeria && delta > 0) { this._acordar?.(); return; }   // na galeria: pula para a próxima imagem
    if (!this.historico.length) return;
    if (!this.atual) { this.pos = this.historico.length - 1; this.mostrar(this.historico[this.pos], { daHistoria: true, sentido: -1 }); return; }
    const p = this.pos + delta;
    if (p < 0 || p >= this.historico.length) return;
    this.pos = p;
    this.mostrar(this.historico[p], { daHistoria: true, sentido: delta });
  }

  _trocarConteudo(novo) {
    const caixa = this.$('.pc-cenas');
    for (const velho of caixa.querySelectorAll('.pc-cena:not(.sai)')) {
      velho.classList.remove('entra');
      velho.classList.add('sai');
      setTimeout(() => velho.remove(), 900);
    }
    if (novo) caixa.append(novo);
  }

  /** Foto real (busca) e, se não houver uma bonita o bastante, imagem gerada localmente (gerar). */
  async _buscarFoto(cena, token) {
    const tentativas = [];
    if (cena.visual.busca) tentativas.push([`/api/imagem?q=${encodeURIComponent(cena.visual.busca)}`, 30000]);
    if (cena.visual.gerar) tentativas.push([`/api/imagem/gerar?p=${encodeURIComponent(cena.visual.gerar)}`, 300000]);
    let limpou = false;
    for (const [url, ms] of tentativas) {
      const gerada = url.includes('/gerar');
      if (gerada) this.gerando('canto', 'Gerando a imagem de fundo');
      try {
        const r = await comTempo(fetch(url), ms);
        if (token !== this.token) return;
        if (gerada) this.gerando(null);
        if (!r.ok) {
          if (!limpou) { this._limparFotos(); limpou = true; }   // a foto da cena anterior não fica esperando
          continue;
        }
        const foto = await r.json();
        cena.foto = foto;                     // no histórico a cena já volta com a imagem
        this._mostrarFoto(foto, token);
        return;
      } catch {
        if (token !== this.token) return;
        if (gerada) this.gerando(null);
        if (!limpou) { this._limparFotos(); limpou = true; }
      }
    }
  }

  /** O mesmo assunto continua na conversa: a cena fica mais tempo. */
  manter() {
    if (this.atual && this.ate !== Infinity) this.ate = Date.now() + (this.atual.duracao_s || DURACAO_S[this.atual.origem] || 120) * 1000;
  }

  async _mostrarFoto(foto, token, { galeria = false } = {}) {
    const img = new Image();
    img.src = foto.url;
    img.alt = '';
    try { await comTempo(img.decode(), 15000); } catch { return; }
    if (token !== this.token) return;
    const caixa = this.$('.pc-fotos');
    const atual = caixa.querySelector('.pc-foto:not(.sai)');
    if (atual?.dataset.url === foto.url) return;
    this._fotos = (this._fotos || 0) + 1;
    // duas máscaras aninhadas (uma some para a esquerda, outra para baixo): multiplicam sem depender de mask-composite
    const el = document.createElement('div');
    el.className = `pc-foto${galeria ? ` galeria g${this._fotos % 4}` : ''}`;
    el.dataset.url = foto.url;
    el.style.setProperty('--escurecer', Math.min(.38, Math.max(0, ((foto.brilho ?? .35) - .3) * 1.3)).toFixed(2));
    const v = document.createElement('div');
    v.className = 'pc-foto-v';
    v.append(img);
    el.append(v);
    this._limparFotos();
    caixa.append(el);
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('visivel')));
    if (foto.paleta?.length >= 4) this.aoPaleta?.(paletaDeCores(foto.paleta));
    const autor = foto.autor ? `${esc(foto.autor)} · ` : '';
    const credito = this.$('.pc-credito');
    credito.innerHTML = `${foto.fonte === 'neste computador' ? 'Imagem' : 'Foto'}: ${autor}${esc(foto.licenca || '')} · ${esc(foto.fonte || '')}`;
    credito.classList.add('visivel');
    // na galeria o crédito aparece só no começo de cada imagem e some (a tela é só a imagem)
    clearTimeout(this._creditoT);
    if (galeria) this._creditoT = setTimeout(() => { if (token === this.token) credito.classList.remove('visivel'); }, 5000);
  }

  _limparFotos() {
    for (const f of this.$('.pc-fotos').querySelectorAll('.pc-foto:not(.sai)')) {
      f.classList.remove('visivel'); f.classList.add('sai');
      setTimeout(() => f.remove(), 2200);
    }
    this.$('.pc-credito').classList.remove('visivel');
  }

  _tique() {
    if (!this.atual) return;
    this._girar();
    this._pintarGerando();
    this.$('.pc-hora').textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    for (const el of this.el.querySelectorAll('[data-fuso]')) {   // "hora lá" de um lugar citado, sempre certa
      try { el.textContent = new Date().toLocaleTimeString('pt-BR', { timeZone: el.dataset.fuso, hour: '2-digit', minute: '2-digit' }); } catch { /* fuso inválido */ }
    }
    if (tiqueContagens(this.el)) {
      this.aoAlarme?.(this.atual);
      this.ate = Date.now() + DEPOIS_DO_ALARME_S * 1000;
    }
    if (Date.now() > this.ate) this.repouso();
  }
}
