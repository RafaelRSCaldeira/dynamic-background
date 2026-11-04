// Demonstração do palco do Zak (/?zak&demo): cenas de exemplo, sem voz nem IA ainda.
// Teclas: 1–5 mostram uma cena · 0 volta ao repouso · espaço pausa/retoma o ciclo automático.

const hora = fuso => new Date().toLocaleTimeString('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit' });

export const CENAS = () => [
  {
    origem: 'ambiente',
    visual: { busca: 'Lisbon Alfama', cor: '#e08a5f' },
    blocos: [
      { tipo: 'destaque', kicker: 'Portugal', titulo: 'Lisboa', sub: 'A viagem que vocês estão planejando' },
      { tipo: 'fatos', itens: [
        { rotulo: 'Hora lá', valor: hora('Europe/Lisbon') },
        { rotulo: 'Fuso', valor: '3 h à frente' },
        { rotulo: 'Voo de SP', valor: '≈ 10 h' },
        { rotulo: 'Moeda', valor: 'Euro (€)' },
      ] },
    ],
  },
  {
    origem: 'ambiente',
    visual: { cor: '#7c6cff' },
    blocos: [
      { tipo: 'destaque', kicker: 'Projeto em pauta', titulo: 'Lançamento do app', sub: 'O que foi dito sobre o cronograma' },
      { tipo: 'linha_tempo', itens: [
        { quando: 'Segunda', texto: 'Design final', feito: true },
        { quando: 'Quarta', texto: 'Testes com usuários', atual: true },
        { quando: 'Sexta', texto: 'Publicação nas lojas' },
      ] },
    ],
  },
  {
    origem: 'conversa',
    pergunta: 'Ei, Zak, qual a altura do Everest?',
    fala: 'O Everest tem 8.849 metros. É o ponto mais alto da Terra.',
    visual: { busca: 'Mount Everest', cor: '#4aa3ff' },
    blocos: [
      { tipo: 'numero', rotulo: 'Monte Everest', valor: '8.849', unidade: 'm', detalhe: 'Medição oficial de 2020, feita por China e Nepal.' },
      { tipo: 'comparacao', lados: [
        { nome: 'Everest', valor: '8.849 m', detalhe: 'Nepal · China' },
        { nome: 'Pico da Neblina', valor: '2.995 m', detalhe: 'o mais alto do Brasil' },
      ] },
    ],
  },
  {
    origem: 'conversa',
    pergunta: 'Ei, Zak, coloca um timer de 5 minutos pro café',
    fala: 'Pronto, 5 minutos. Te aviso quando acabar.',
    visual: { cor: '#d9893f' },
    blocos: [{ tipo: 'contagem', segundos: 300, rotulo: 'Café' }],
  },
  {
    origem: 'ambiente',
    visual: { busca: 'Tokyo night', cor: '#3d7bff' },
    blocos: [
      { tipo: 'destaque', kicker: 'Japão', titulo: 'Tóquio', sub: 'Assunto da conversa: a conferência de dezembro' },
      { tipo: 'fatos', itens: [
        { rotulo: 'Hora lá', valor: hora('Asia/Tokyo') },
        { rotulo: 'Fuso', valor: '12 h à frente' },
        { rotulo: 'Região', valor: '37 milhões' },
      ] },
      { tipo: 'lista', titulo: 'Vocês citaram', itens: ['Shibuya', 'Trem-bala até Kyoto', 'Inverno: leve casaco'] },
    ],
  },
];

export function iniciarDemo({ palco, presenca, automatico = true }) {
  let i = -1, pausado = !automatico, timer;
  const etiqueta = Object.assign(document.createElement('div'), { id: 'zak-demo', textContent: 'Demonstração · 1–5 cenas · 0 repouso · espaço pausa' });
  document.body.append(etiqueta);

  const mostrar = k => {
    clearTimeout(timer);
    const cena = CENAS()[k];
    if (!cena) return;
    i = k;
    if (cena.origem === 'conversa') {
      // como vai ser de verdade: ouve → pensa → a tela muda e ele responde
      presenca.estado('ouvindo'); presenca.ouviu(cena.pergunta);
      setTimeout(() => presenca.estado('pensando'), 1300);
      setTimeout(() => { palco.mostrar(cena); presenca.falar(cena.fala); }, 1900);
    } else {
      presenca.ouviu('');
      palco.mostrar(cena);
    }
    agendar();
  };
  const agendar = () => {
    clearTimeout(timer);
    if (pausado) return;
    // repouso de vez em quando, como na vida real: a tela só muda quando há assunto
    timer = setTimeout(() => {
      if (palco.ativa && (i + 1) % 2 === 0) { palco.repouso(); timer = setTimeout(() => mostrar((i + 1) % CENAS().length), 7000); }
      else mostrar((i + 1) % CENAS().length);
    }, 16000);
  };

  addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey || document.querySelector('dialog[open]')) return;
    if (/^[1-9]$/.test(e.key)) mostrar(+e.key - 1);
    else if (e.key === '0') { clearTimeout(timer); palco.repouso(); agendar(); }
    else if (e.key === ' ') { pausado = !pausado; etiqueta.classList.toggle('pausado', pausado); agendar(); }
  });
  if (!pausado) timer = setTimeout(() => mostrar(0), 5000);
  return { mostrar };
}
