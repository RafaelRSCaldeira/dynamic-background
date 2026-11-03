// Detecção de movimento pela webcam — 100% no navegador.
// Usa só 64×48 pixels em tons de cinza; nenhuma imagem é guardada ou enviada.

const W = 64, H = 48;

export class Camera {
  constructor() {
    this.ativa = false;
    this.movimento = 0;   // 0..1 suavizado
    this.x = .5; this.y = .5;
    this.ultimoMovimento = 0;
    this.aoGesto = null;  // callback(x, y) quando há um aceno amplo
    this._canvas = document.createElement('canvas');
    this._canvas.width = W; this._canvas.height = H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: true });
    this._anterior = null;
    this._ultimoGesto = 0;
  }

  async ligar() {
    if (this.ativa) return true;
    try {
      this._stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 240 }, frameRate: { ideal: 15 } }, audio: false });
    } catch (e) {
      console.warn('Câmera indisponível:', e.message);
      return false;
    }
    this._video = Object.assign(document.createElement('video'), { muted: true, playsInline: true, srcObject: this._stream });
    await this._video.play();
    this.ativa = true;
    this._timer = setInterval(() => this._analisar(), 1000 / 15);
    return true;
  }

  desligar() {
    clearInterval(this._timer);
    this._stream?.getTracks().forEach(t => t.stop());
    this._stream = null; this._video = null; this._anterior = null;
    this.ativa = false; this.movimento = 0;
  }

  _analisar() {
    if (!this._video || this._video.readyState < 2) return;
    const ctx = this._ctx;
    ctx.drawImage(this._video, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    const cinza = new Uint8Array(W * H);
    for (let i = 0, j = 0; j < cinza.length; i += 4, j++) cinza[j] = (px[i] * 77 + px[i + 1] * 150 + px[i + 2] * 29) >> 8;

    if (this._anterior) {
      let n = 0, sx = 0, sy = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = y * W + x;
        if (Math.abs(cinza[k] - this._anterior[k]) > 26) { n++; sx += x; sy += y; }
      }
      const frac = n / (W * H);
      const alvo = Math.min(1, frac * 7);
      this.movimento += (alvo - this.movimento) * .35;
      if (n > 12) {
        // espelhado (como um espelho) e com y para cima (coordenadas do shader)
        const cx = 1 - sx / n / W, cy = 1 - sy / n / H;
        this.x += (cx - this.x) * .3; this.y += (cy - this.y) * .3;
        if (frac > .012) this.ultimoMovimento = performance.now();
        if (frac > .28 && performance.now() - this._ultimoGesto > 1800) {
          this._ultimoGesto = performance.now();
          this.aoGesto?.(this.x, this.y);
        }
      }
    }
    this._anterior = cinza;
  }
}
