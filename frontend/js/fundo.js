// Fundo animado em WebGL: aurora fluida (domain warping) que reage a mouse, câmera, cliques e voz.

const VERT = `attribute vec2 a; varying vec2 vUv;
void main(){ vUv = a * .5 + .5; gl_Position = vec4(a, 0., 1.); }`;

const FRAG = `precision highp float;
varying vec2 vUv;
uniform vec2 uRes;
uniform float uT, uNuvem, uFlash, uEnergia;
uniform vec3 uP1, uP2, uClique;       // xy + força | xy + idade
uniform vec3 uC0, uC1, uC2, uC3;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

void main(){
  vec2 asp = vec2(uRes.x / uRes.y, 1.);
  vec2 uv = vUv, p = uv * asp;
  float t = uT;

  // redemoinhos ao redor do mouse e do movimento captado pela câmera
  vec2 d1 = (uv - uP1.xy) * asp; float f1 = exp(-dot(d1, d1) * 5.) * uP1.z;
  vec2 d2 = (uv - uP2.xy) * asp; float f2 = exp(-dot(d2, d2) * 3.5) * uP2.z;
  vec2 c1 = uP1.xy * asp; p = c1 + rot(f1 * 1.5) * (p - c1);
  vec2 c2 = uP2.xy * asp; p = c2 + rot(-f2 * 1.3) * (p - c2);

  // onda do clique
  vec2 dc = (uv - uClique.xy) * asp; float dist = length(dc), idade = uClique.z;
  float onda = exp(-pow((dist - idade * .55) * 11., 2.)) * exp(-idade * 1.3);
  p += dc / (dist + 1e-3) * onda * .05;

  vec2 q = vec2(fbm(p * 1.3 + vec2(0., t * .9)), fbm(p * 1.3 + vec2(5.2, 1.3) - t * .7));
  vec2 r = vec2(fbm(p * 1.1 + 2.4 * q + vec2(1.7, 9.2) + t * .5), fbm(p * 1.1 + 2.4 * q + vec2(8.3, 2.8) - t * .4));
  float n = fbm(p * .9 + 2. * r);
  float cortina = smoothstep(.45, .95, fbm(vec2(p.x * 2.2 + r.x * 1.6, t * .5 + q.y))) * smoothstep(.1, .9, uv.y);

  vec3 col = uC0;
  col = mix(col, uC1, smoothstep(.15, .85, n));
  col = mix(col, uC2, smoothstep(.5, 1.1, length(q)) * .75);
  col = mix(col, uC3, clamp(smoothstep(.6, 1., r.y) * .5 + cortina * .45 * (1. - uNuvem), 0., 1.));

  // nuvens: dessatura e acrescenta véu
  float l = dot(col, vec3(.299, .587, .114));
  col = mix(col, vec3(l) * vec3(.92, .96, 1.04), uNuvem * .55);

  // luz dos ponteiros, onda e energia (voz/movimento)
  col += uC3 * f1 * .22 + mix(uC2, uC3, .5) * f2 * .3;
  col += onda * .22 * mix(uC3, vec3(1.), .35);
  col *= 1. + uEnergia * .18;

  // legibilidade: escurece embaixo e nas bordas
  col *= mix(.6, 1.02, smoothstep(0., 1., uv.y));
  vec2 v = uv - .5; col *= 1. - dot(v, v) * .85;

  col += vec3(.55, .6, .9) * uFlash;
  col += (hash(gl_FragCoord.xy + fract(t * 7.)) - .5) * (2.5 / 255.);  // dithering contra banding
  gl_FragColor = vec4(col, 1.);
}`;

export class Fundo {
  constructor(canvas, escala = 0.5) {
    this.canvas = canvas;
    this.escala = Math.min(1, Math.max(0.25, escala));
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.ok = !!gl;
    if (!gl) { document.body.classList.add('sem-webgl'); return; }
    this.gl = gl;

    const compilar = (tipo, src) => {
      const s = gl.createShader(tipo); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compilar(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compilar(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    gl.useProgram(prog);

    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(prog, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);

    this.u = {};
    for (const n of ['uRes', 'uT', 'uNuvem', 'uFlash', 'uEnergia', 'uP1', 'uP2', 'uClique', 'uC0', 'uC1', 'uC2', 'uC3'])
      this.u[n] = gl.getUniformLocation(prog, n);

    this.redimensionar();
    addEventListener('resize', () => this.redimensionar());
  }

  redimensionar() {
    if (!this.ok) return;
    // o fundo é suave: renderiza em resolução reduzida e o navegador amplia (leve até em 4K)
    const k = this.escala * Math.min(devicePixelRatio || 1, 2);
    const w = Math.min(Math.round(innerWidth * k), 2048);
    const h = Math.round(w * innerHeight / innerWidth);
    this.canvas.width = w; this.canvas.height = h;
    this.gl.viewport(0, 0, w, h);
  }

  desenhar(e) {
    if (!this.ok) return;
    const { gl, u } = this;
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(u.uT, e.tempo);
    gl.uniform1f(u.uNuvem, e.nuvem);
    gl.uniform1f(u.uFlash, e.flash);
    gl.uniform1f(u.uEnergia, e.energia);
    gl.uniform3f(u.uP1, e.p1.x, e.p1.y, e.p1.forca);
    gl.uniform3f(u.uP2, e.p2.x, e.p2.y, e.p2.forca);
    gl.uniform3f(u.uClique, e.clique.x, e.clique.y, e.clique.idade);
    e.cores.forEach((c, i) => gl.uniform3f(u['uC' + i], c[0], c[1], c[2]));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
