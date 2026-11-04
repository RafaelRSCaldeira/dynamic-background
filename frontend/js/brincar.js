// Brincadeiras com as mãos: liga os gestos (maos.js) aos efeitos (luzes.js) e às mudanças na tela.
import { Maos } from './maos.js';
import { Luzes } from './luzes.js';
import { guardar, bus } from './util.js';

export const CENAS = [
  { id: 'real', nome: 'Clima de agora', emoji: '🌤️' },
  { id: 'estrelas', nome: 'Noite estrelada', emoji: '🌌' },
  { id: 'neve', nome: 'Neve', emoji: '❄️' },
  { id: 'tempestade', nome: 'Tempestade', emoji: '⛈️' },
  { id: 'vagalumes', nome: 'Vaga-lumes', emoji: '✨' },
  { id: 'magia', nome: 'Magia', emoji: '🔮' },
];

export const GESTOS = [
  ['👋', 'Acene', 'o painel dá oi e mostra este guia'],
  ['🫲', 'Pare a mão e deslize', 'para o lado: troca o card em destaque'],
  ['🖐️', 'Mão aberta para cima ou para baixo', 'rola a lista da Sala'],
  ['✊', 'Feche a mão', 'junta energia… abra para explodir'],
  ['☝️', 'Aponte ou faça pinça', 'desenha com luz no ar'],
  ['👍', 'Joinha', 'fogos de artifício'],
  ['✌️', 'Paz e amor', 'troca a cena do fundo'],
  ['🤟', 'Te amo', 'chuva de corações'],
  ['👎', 'Polegar para baixo', 'limpa tudo e volta ao normal'],
];

const DEBUG = new URLSearchParams(location.search).has('debug');

export class Brincar {
  /**
   * @param camera     instância de Camera (fornece o <video>)
   * @param particulas fundo de partículas (atração/explosão)
   * @param destaque   modo destaque (deslizar)
   * @param onda(x,y)  onda no shader (coordenadas 0..1, y para cima)
   * @param cena(id)   troca a cena do fundo ('real' volta ao clima)
   */
  constructor({ camera, particulas, destaque, onda, cena, distanciaMax = 2, campoVisao = 65 }) {
    Object.assign(this, { camera, particulas, destaque, onda, definirCena: cena });
    this.ativo = guardar.ler('gestos', true);
    this.maos = new Maos({ distanciaMax, campoVisao });
    this.luzes = new Luzes(document.getElementById('luzes'));
    this.cenaAtual = 0;
    this.maos.aoEvento = (n, d) => this._evento(n, d);
    this.maos.aoEstado = () => this.aoEstado?.(this.maos.estado);

    this.aviso = Object.assign(document.createElement('div'), { id: 'aviso-gesto' });
    this.aviso.setAttribute('aria-live', 'polite');
    this.aviso.innerHTML = '<span class="ag-emoji"></span><span class="ag-txt"></span>';
    this.guia = Object.assign(document.createElement('aside'), { id: 'guia-gestos' });
    this.guia.innerHTML = `<h3>Brinque com as mãos</h3><ul>${GESTOS.map(([e, t, d]) =>
      `<li><span class="gg-emoji">${e}</span><span><b>${t}</b><small>${d}</small></span></li>`).join('')}</ul>`;
    document.body.append(this.aviso, this.guia);
  }

  get estado() { return this.maos.estado; }
  get presente() { return this.maos.maos.length > 0; }

  async sincronizar() {
    if (this.ativo && this.camera.ativa && this.camera.video) await this.maos.ligar(this.camera.video);
    else this.maos.desligar();
  }

  async alternar() {
    this.ativo = !this.ativo;
    guardar.gravar('gestos', this.ativo);
    await this.sincronizar();
    return this.ativo;
  }

  avisar(emoji, texto, ms = 2200) {
    this.aviso.querySelector('.ag-emoji').textContent = emoji;
    this.aviso.querySelector('.ag-txt').textContent = texto;
    this.aviso.classList.remove('visivel'); void this.aviso.offsetWidth; // reinicia a animação
    this.aviso.classList.add('visivel');
    clearTimeout(this._tAviso);
    this._tAviso = setTimeout(() => this.aviso.classList.remove('visivel'), ms);
  }

  mostrarGuia(ms = 9000) {
    this.guia.classList.add('visivel');
    clearTimeout(this._tGuia);
    this._tGuia = setTimeout(() => this.guia.classList.remove('visivel'), ms);
  }

  esconderGuia() { this.guia.classList.remove('visivel'); }

  _evento(nome, d) {
    if (DEBUG) console.log('[gesto]', nome, JSON.stringify(d));
    const W = innerWidth, H = innerHeight;
    const px = (d.x ?? .5) * W, py = (d.y ?? .5) * H;
    if (nome !== 'apareceu' && nome !== 'oi') this.esconderGuia();
    switch (nome) {
      case 'apareceu':
        this.avisar('🖐️', 'Mão detectada! Acene para ver os gestos');
        break;
      case 'oi':
        this.avisar('👋', 'Oi!');
        this.mostrarGuia();
        this.luzes.coracoes(px, py);
        break;
      case 'joinha':
        this.avisar('👍', 'Fogos!');
        this.luzes.fogos(px, py);
        this.onda(d.x, 1 - d.y);
        break;
      case 'coracoes':
        this.avisar('🤟', 'Te amo também!');
        this.luzes.coracoes(px, py);
        break;
      case 'cena': {
        this.cenaAtual = (this.cenaAtual + 1) % CENAS.length;
        const c = CENAS[this.cenaAtual];
        this.definirCena(c.id);
        this.avisar(c.emoji, c.id === 'real' ? 'De volta ao clima de agora' : `Cena: ${c.nome}`);
        break;
      }
      case 'desfazer':
        this.luzes.limpar();
        this.destaque.sair();
        if (this.cenaAtual) { this.cenaAtual = 0; this.definirCena('real'); }
        this.avisar('🧹', 'Tudo limpo');
        break;
      case 'explosao':
        this.luzes.explosao(px, py, d.carga);
        this.particulas.explosao(px, py, 1 + d.carga * 3);
        this.onda(d.x, 1 - d.y);
        if (d.carga > .85) this.avisar('💥', 'Kabum!', 1400);
        break;
      case 'rolar':
        bus.emit('rolar-sala', d.dir);
        this.avisar(d.dir < 0 ? '⬆️' : '⬇️', d.dir < 0 ? 'Lista da Sala: mais antigos' : 'Lista da Sala: mais recentes', 1300);
        break;
      case 'longe':
        this.avisar('🚶', `Chegue mais perto: os gestos valem a até ${this.maos.distanciaMax.toLocaleString('pt-BR')} m`, 3200);
        break;
      case 'deslizar':
        this.luzes.deslize(d.y, d.dir);
        this.destaque.ir(d.dir);
        this.avisar(d.dir > 0 ? '👉' : '👈', this.destaque.nome, 1500);
        break;
    }
  }

  /** Volta a cena para o clima real (ex.: a cena forçada expirou). */
  cenaExpirou() { this.cenaAtual = 0; }

  /**
   * Chamado a cada quadro. Devolve o "ponteiro" da mão principal para o shader/partículas:
   * { x, y (px), forca, atrair } ou null.
   */
  quadro(dt, acento) {
    if (acento) this.luzes.acento = acento;
    const maos = this.maos.maos, W = innerWidth, H = innerHeight;
    const ids = new Set();
    for (const m of maos) {
      ids.add(m.id);
      if (m.ativa && m.desenhando) this.luzes.tracar(m.id, m.indicador.x * W, m.indicador.y * H);
      else this.luzes.soltarTraco(m.id);
      if (m.ativa && m.carga > .05) this.luzes.sugar(m.palma.x * W, m.palma.y * H, m.carga, dt);
    }
    for (const id of [...this.luzes.tracos.keys()]) if (!ids.has(id)) this.luzes.soltarTraco(id);
    if (maos.length || !this.luzes.ocioso) this.luzes.quadro(dt, maos);
    else if (!this._limpo) { this.luzes.quadro(dt, []); }
    this._limpo = !maos.length && this.luzes.ocioso;

    const m = maos.find(x => x.ativa);   // só a mão que comanda mexe no fundo
    if (!m) return null;
    const alvo = m.desenhando ? m.indicador : m.palma;
    return { x: alvo.x * W, y: alvo.y * H, forca: m.carga > .05 ? 0 : 1, atrair: m.carga };
  }
}
