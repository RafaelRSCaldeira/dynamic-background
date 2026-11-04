// Worker (clássico) do reconhecimento de mãos. Roda o MediaPipe fora da thread principal:
// assim a análise de cada quadro da câmera não trava a animação da página.
// Recebe: { tipo:'iniciar' } e { tipo:'quadro', imagem: ImageBitmap, t }
// Envia:  { tipo:'pronto', delegate } | { tipo:'erro', erro } | { tipo:'resultado', maos, ms }

self.exports = {};          // o bundle CommonJS do MediaPipe escreve aqui
importScripts('/visao/vision_bundle.cjs');
const { FilesetResolver, GestureRecognizer } = self.exports;

let reconhecedor = null;

async function iniciar(preferido = 'CPU') {
  const arquivos = await FilesetResolver.forVisionTasks('/visao/wasm');
  const criar = delegate => GestureRecognizer.createFromOptions(arquivos, {
    baseOptions: { modelAssetPath: '/visao/gesture_recognizer.task', delegate },
    runningMode: 'VIDEO', numHands: 3,  // a sua mão, a outra e a de quem estiver do lado: nenhuma "rouba" a vaga
    minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4,
  });
  const ordem = preferido === 'GPU' ? ['GPU', 'CPU'] : ['CPU', 'GPU'];
  try {
    reconhecedor = await criar(ordem[0]);
    return ordem[0];
  } catch (e) {
    reconhecedor = await criar(ordem[1]);
    return ordem[1];
  }
}

self.onmessage = async ({ data }) => {
  if (data.tipo === 'iniciar') {
    try { postMessage({ tipo: 'pronto', delegate: await iniciar(data.delegate) }); }
    catch (e) { postMessage({ tipo: 'erro', erro: String(e?.message || e) }); }
    return;
  }
  if (data.tipo === 'quadro') {
    const img = data.imagem;
    if (!reconhecedor) { img.close(); return; }
    const t0 = performance.now();
    let maos = [];
    try {
      const r = reconhecedor.recognizeForVideo(img, data.t);
      maos = (r.landmarks || []).map((lm, i) => {
        const g = r.gestures?.[i]?.[0];
        return {
          pontos: lm.map(p => [p.x, p.y]),
          mundo: (r.worldLandmarks?.[i] || []).map(p => [p.x, p.y]),  // em metros: dá o tamanho real da mão
          gesto: g?.categoryName || 'None', score: g?.score || 0,
          lado: r.handedness?.[i]?.[0]?.categoryName || '',   // esquerda/direita: ajuda a não trocar as mãos
        };
      });
    } catch (e) { /* quadro ruim: ignora */ }
    img.close();
    postMessage({ tipo: 'resultado', maos, ms: performance.now() - t0 });
  }
};
