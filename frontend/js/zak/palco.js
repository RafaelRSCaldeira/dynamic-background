// Palco do Zak: a tela inteira vira a cena do assunto da conversa.
// Uma cena por vez. O texto entra na hora; a foto (4K, já filtrada no servidor) chega depois,
// aparece devagar e tinge o fundo animado com a paleta dela. Sem nada para mostrar, volta ao repouso.
import { esc } from '../util.js';
import { mini } from '../icones.js';
import { paletaDeCores, paletaDeTom } from '../paleta.js';
import { blocoHTML, tiqueContagens } from './blocos.js';

const DURACAO_S = { ambiente: 150, conversa: 75 };
const DEPOIS_DO_ALARME_S = 40;
const HISTORICO = 12;
const MAX_BLOCOS = 4;

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
      <header class="pc-topo"><span class="pc-origem"></span><span class="pc-hora"></span></header>
      <footer class="pc-credito"></footer>`;
    document.getElementById('luzes').before(this.el);
    this.$ = s => this.el.querySelector(s);
    this.historico = []; this.pos = -1; this.token = 0; this.atual = null; this.ate = 0;
    setInterval(() => this._tique(), 250);
  }

  get ativa() { return !!this.atual; }
  get nome() { return this.atual?.blocos?.[0]?.titulo || ''; }

  /** Mostra uma cena: { origem: 'ambiente'|'conversa', pergunta?, visual: { busca?, cor? }, blocos: [...] } */
  mostrar(cena, { daHistoria = false, sentido = 1 } = {}) {
    const token = ++this.token;
    cena = { ...cena, blocos: (cena.blocos || []).filter(b => b && b.tipo).slice(0, MAX_BLOCOS) };
    if (!cena.blocos.length) return;
    if (!daHistoria) {
      this.historico = this.historico.slice(0, this.pos + 1).concat([cena]).slice(-HISTORICO);
      this.pos = this.historico.length - 1;
    }
    this.atual = cena;
    const temContagem = cena.blocos.some(b => b.tipo === 'contagem');
    this.ate = temContagem ? Infinity : Date.now() + (cena.duracao_s || DURACAO_S[cena.origem] || 120) * 1000;

    const comImagem = cena.visual?.busca || cena.visual?.gerar || cena.foto;
    const layout = cena.layout || (temContagem ? 'foco' : comImagem ? 'foto' : 'texto');
    const [heroi, ...resto] = cena.blocos;
    const novo = document.createElement('div');
    novo.className = `pc-cena layout-${layout} entra`;
    novo.style.setProperty('--sentido', sentido);
    novo.innerHTML = `
      <div class="pc-heroi">${blocoHTML(heroi, 0)}</div>
      ${resto.length ? `<div class="pc-blocos n${resto.length}">${resto.map((b, i) => blocoHTML(b, i + 1)).join('')}</div>` : ''}`;
    this._trocarConteudo(novo);

    this.$('.pc-origem').innerHTML = cena.origem === 'conversa'
      ? `${mini.pergunta}<span>${esc(cena.pergunta || 'Você perguntou')}</span>`
      : `${mini.sala}<span>Assunto na sala</span>`;
    document.body.classList.add('em-cena');
    document.body.dataset.layout = layout;
    tiqueContagens(this.el);

    // paleta: a do tom pedido agora; a da foto quando ela chegar
    if (cena.visual?.cor) this.aoPaleta?.(paletaDeTom(cena.visual.cor));
    if (cena.foto) this._mostrarFoto(cena.foto, token);
    else if (cena.visual?.busca || cena.visual?.gerar) this._buscarFoto(cena, token);
    else this._limparFotos();
    this.aoMudar?.(cena);
  }

  repouso() {
    this.token++;
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
    if (cena.visual.busca) tentativas.push([`/api/imagem?q=${encodeURIComponent(cena.visual.busca)}`, 15000]);
    if (cena.visual.gerar) tentativas.push([`/api/imagem/gerar?p=${encodeURIComponent(cena.visual.gerar)}`, 90000]);
    let limpou = false;
    for (const [url, ms] of tentativas) {
      try {
        const r = await comTempo(fetch(url), ms);
        if (token !== this.token) return;
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
        if (!limpou) { this._limparFotos(); limpou = true; }
      }
    }
  }

  /** O mesmo assunto continua na conversa: a cena fica mais tempo. */
  manter() {
    if (this.atual && this.ate !== Infinity) this.ate = Date.now() + (this.atual.duracao_s || DURACAO_S[this.atual.origem] || 120) * 1000;
  }

  async _mostrarFoto(foto, token) {
    const img = new Image();
    img.src = foto.url;
    img.alt = '';
    try { await comTempo(img.decode(), 15000); } catch { return; }
    if (token !== this.token) return;
    const caixa = this.$('.pc-fotos');
    const atual = caixa.querySelector('.pc-foto:not(.sai)');
    if (atual?.dataset.url === foto.url) return;
    // duas máscaras aninhadas (uma some para a esquerda, outra para baixo): multiplicam sem depender de mask-composite
    const el = document.createElement('div');
    el.className = 'pc-foto';
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
    this.$('.pc-credito').innerHTML = `Foto: ${autor}${esc(foto.licenca || '')} · ${esc(foto.fonte || '')}`;
    this.$('.pc-credito').classList.add('visivel');
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
