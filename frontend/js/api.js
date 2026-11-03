// Comunicação com o servidor local

export async function getJSON(url) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

// Busca periódica; em caso de erro tenta de novo mais cedo
export function periodico(url, ms, aoReceber, aoFalhar) {
  let timer;
  const rodar = async () => {
    try { aoReceber(await getJSON(url)); timer = setTimeout(rodar, ms); }
    catch (e) { aoFalhar?.(e); timer = setTimeout(rodar, Math.min(ms, 60000)); }
  };
  rodar();
  return () => clearTimeout(timer);
}

export function conectar(aoReceber, aoMudarConexao) {
  let ws, tentativas = 0;
  const abrir = () => {
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    ws.onopen = () => { tentativas = 0; aoMudarConexao?.(true); };
    ws.onmessage = e => { try { aoReceber(JSON.parse(e.data)); } catch { /* ignora */ } };
    ws.onclose = () => { aoMudarConexao?.(false); setTimeout(abrir, Math.min(10000, 500 * 2 ** tentativas++)); };
  };
  abrir();
  return { enviar: obj => ws?.readyState === 1 && ws.send(JSON.stringify(obj)) };
}
