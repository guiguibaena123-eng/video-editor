// Câmeras e lentes: emula a "essência" de câmeras e lentes famosas em três camadas.
//  1. Ciência de cor do sensor (ou da película): curva de tons com pé e ombro, contraste, cor da pele,
//     divisão de tons — calculada no OKLab pelo mesmo motor dos looks (src/looks.js) e guardada na LUT 3D.
//  2. Óptica da lente: nitidez ou maciez, vinheta, aberração cromática radial, halação (brilho avermelhado
//     que vaza das luzes na película) e flare anamórfico (rastro horizontal azul das lentes Panavision).
//     Feitos na placa de vídeo (prévia) e com filtros do FFmpeg (exportação), com as mesmas contas.
//  3. Granulação e formato (proporção de tela e fps recomendados).
// Nada aqui é cópia de um produto: cada receita é uma interpretação própria das características
// conhecidas de cada câmera, e todos os parâmetros ficam editáveis.
import { makeLook, NEUTRAL, oklchRgb } from './looks';

export const CAMERA_CATS = [
  ['all', 'Todas'],
  ['cine', 'Cinema digital'],
  ['large', 'Grande formato e IMAX'],
  ['lens', 'Lentes e filtros'],
  ['film', 'Película'],
  ['consumer', 'Celular, ação e drone'],
  ['retro', 'Vídeo antigo'],
];

// Parâmetros da óptica e do sensor (os de cor são os mesmos dos looks: LOOK_PARAMS).
// [chave, nome, mín, máx]
export const OPTICS_PARAMS = [
  ['soft', 'Maciez da lente (− nítido · + suave)', -1, 1],
  ['vig', 'Vinheta (queda de luz nas bordas)', 0, 1],
  ['ca', 'Aberração cromática', 0, 1],
  ['grain', 'Granulação / ruído do sensor', 0, 1],
];
// Halação (círculo, ex.: película) e flare anamórfico (horizontal): cada um é uma camada de brilho.
export const GLOW_LAYERS = [
  ['hal', 'Halação e brilho (difusão)'],
  ['str', 'Flare anamórfico (rastro horizontal)'],
];
export const GLOW_FIELDS = [
  ['A', 'Intensidade', 0, 1],
  ['T', 'Limiar (só luzes acima disso brilham)', 0.3, 0.95],
  ['S', 'Tamanho do brilho', 4, 400],
];

export const NEUTRAL_OPTICS = {
  soft: 0, ca: 0, grain: 0,
  halA: 0, halT: 0.72, halS: 22, halH: 35, halC: 0.8,
  strA: 0, strT: 0.8, strS: 150, strH: 255, strC: 0.65,
};
export const NEUTRAL_CAMERA = { ...NEUTRAL, ...NEUTRAL_OPTICS };

// ---------- receitas ----------
// p = só o que difere do neutro. asp = proporção sugerida; fps = taxa de quadros sugerida.
const C = (cat, id, label, maker, desc, tech, asp, fps, p) => ({ cat, id, label, maker, desc, tech, asp, fps, p });

export const CAMERAS = [
  // ── Cinema digital
  C('cine', 'alexa35', 'Alexa 35', 'ARRI', 'Cor do ARRI: pele quente e natural, realces que rolam suave para o branco, sombras limpas e cores ricas sem exagero.', ['Sensor Super 35 · 17 stops', 'Curva LogC → Rec.709 (ombro longo)', 'Sem nitidez artificial'], '16:9', 24, {
    con: 0.12, roll: 0.7, toe: 0.35, sat: -0.04, temp: 0.05, vib: 0.06, skin: 0.35, ev: -0.04, shH: 205, shA: 0.07, hiH: 60, hiA: 0.07, hsel: [{ h: 55, w: 35, ds: 0.06, dl: 0.02 }, { h: 142, w: 45, ds: -0.1 }], grain: 0.04,
  }),
  C('cine', 'alexamini', 'Alexa Mini LF', 'ARRI', 'Formato grande com a mesma ciência de cor: transição suave, textura cremosa e um leve enfraquecimento nas bordas.', ['Sensor Large Format (36,7 × 25,5 mm)', 'Profundidade de campo curta', 'Cor ARRI Rec.709'], '2.39:1', 24, {
    con: 0.1, roll: 0.72, toe: 0.38, sat: -0.03, temp: 0.04, vib: 0.05, skin: 0.35, ev: -0.04, soft: 0.1, vig: 0.12, shH: 205, shA: 0.06, hiH: 60, hiA: 0.07, hsel: [{ h: 142, w: 45, ds: -0.1 }], grain: 0.04,
  }),
  C('cine', 'red', 'V-Raptor / Monstro', 'RED', 'Imagem digital de impacto: contraste alto, vermelhos vivos, azuis limpos e muita nitidez.', ['Sensor 8K Vista Vision', 'REDWideGamutRGB · contraste médio-alto', 'Nitidez e detalhe máximos'], '2.39:1', 24, {
    con: 0.3, roll: 0.38, toe: 0.2, sat: 0.1, vib: 0.12, skin: 0.3, soft: -0.35, shH: 232, shA: 0.1, hsel: [{ h: 29, w: 30, ds: 0.15 }, { h: 264, w: 45, ds: 0.1 }], blk: -0.08,
  }),
  C('cine', 'venice', 'Venice 2 (S-Cinetone)', 'Sony', 'Pele quente e lisonjeira, contraste suave, sombras levemente magenta e cor muito limpa.', ['Sensor Full Frame 8,6K', 'Curva S-Cinetone', 'Ruído quase invisível'], '16:9', 24, {
    con: 0.1, roll: 0.5, toe: 0.45, sat: 0.05, temp: 0.06, tint: 0.06, vib: 0.08, skin: 0.4, shH: 330, shA: 0.07, hiH: 60, hiA: 0.05, hsel: [{ h: 55, w: 35, ds: 0.08, dl: 0.03 }], grain: 0.03,
  }),
  C('cine', 'bmpcc', 'Pocket Cinema 6K G2', 'Blackmagic', 'Aparência filmica e orgânica: cores densas, realces levemente dessaturados e um ruído fino bonito.', ['Super 35 · 13 stops', 'Blackmagic Gen 5 color science', 'Ruído de sensor "filmico"'], '2.39:1', 24, {
    con: 0.18, roll: 0.55, toe: 0.3, sat: -0.04, temp: 0.1, fade: 0.03, shH: 200, shA: 0.1, hiH: 60, hiA: 0.1, grain: 0.15, hSat: -0.15,
  }),
  C('cine', 'canon', 'C70 / C300 (Cinema EOS)', 'Canon', 'Pele quente e rosada, cor suave e saturada, imagem agradável direto da câmera.', ['Super 35 · Dual Gain Output', 'Canon Cinema Gamut', 'Cor de pele em destaque'], '16:9', 24, {
    temp: 0.12, tint: 0.05, sat: 0.05, con: 0.1, roll: 0.45, toe: 0.3, vib: 0.08, skin: 0.45, hsel: [{ h: 40, w: 30, ds: 0.08 }],
  }),
  C('cine', 'fujieterna', 'X-T4 (Eterna)', 'Fujifilm', 'Simulação de película cinema: contraste suave, cores contidas e sombras esverdeadas.', ['APS-C', 'Simulação Eterna Cinema', 'Cores dessaturadas, sombras abertas'], '16:9', 24, {
    sat: -0.15, con: -0.08, fade: 0.06, roll: 0.5, toe: 0.4, shH: 175, shA: 0.12, hiH: 80, hiA: 0.08, hsel: [{ h: 142, w: 45, ds: -0.1 }],
  }),
  // ── Grande formato e IMAX
  C('large', 'imax70', 'IMAX 70 mm (15 perf)', 'IMAX', 'Resolução monumental: nitidez absoluta, grão quase invisível, pretos profundos e realces limpos.', ['Película 65 mm × 15 perfurações', 'Proporção 1,43:1', '≈ 18K de resolução equivalente'], '1.43:1', 24, {
    con: 0.15, roll: 0.6, toe: 0.25, sat: 0.06, vib: 0.06, blk: -0.06, soft: -0.4, grain: 0.05, skin: 0.25,
  }),
  C('large', 'imaxdigital', 'IMAX Digital (Alexa 65)', 'IMAX', 'Digital grande formato: limpeza total, escala longa de tons e cor neutra e precisa.', ['Sensor 65 mm 6,5K', 'Proporção 1,90:1', 'Cor ARRI com nitidez IMAX'], '1.9:1', 24, {
    con: 0.12, roll: 0.65, toe: 0.3, sat: 0.02, vib: 0.05, soft: -0.3, skin: 0.3, grain: 0.02,
  }),
  C('large', 'dxl2', 'DXL2 (Light Iron)', 'Panavision', 'Sensor 8K Vista Vision com o tratamento de cor Light Iron: natural, cremoso e com pele realçada.', ['Sensor 8K Large Format', 'Light Iron Color 2', 'Pele e ombro suaves'], '2.39:1', 24, {
    con: 0.2, roll: 0.6, toe: 0.3, vib: 0.08, temp: 0.05, skin: 0.4, soft: -0.1, shH: 215, shA: 0.07, hiH: 58, hiA: 0.07, vig: 0.08,
  }),
  C('large', 'alexa65', 'Alexa 65', 'ARRI', 'Médio formato cinematográfico: transições de tom amplas e uma profundidade especial no rosto.', ['Sensor 65 mm (54,12 × 25,58 mm)', 'Profundidade de campo mínima', 'Cor ARRI'], '2.39:1', 24, {
    con: 0.1, roll: 0.75, toe: 0.4, sat: -0.03, temp: 0.04, skin: 0.4, soft: 0.05, vig: 0.1, ev: -0.04, shH: 205, shA: 0.06, grain: 0.03,
  }),
  // ── Lentes e filtros
  C('lens', 'panac', 'C-Series anamórfica', 'Panavision', 'A lente dos clássicos: flare azul horizontal nas luzes, bordas macias, vinheta e leve aberração.', ['Anamórfica 2× · 2,39:1', 'Rastro (streak) azul horizontal', 'Bordas suaves, bokeh oval'], '2.39:1', 24, {
    soft: 0.3, vig: 0.3, ca: 0.35, con: 0.08, roll: 0.4, fade: 0.04, strA: 0.9, strT: 0.72, strS: 190, strH: 258, strC: 0.85, halA: 0.12, halT: 0.8, halS: 14, halH: 50, halC: 0.5, temp: 0.04,
  }),
  C('lens', 'panat', 'T-Series anamórfica', 'Panavision', 'Anamórfica moderna: bem corrigida, rastro ciano discreto e nitidez no centro.', ['Anamórfica 2× · 2,39:1', 'Rastro ciano fino', 'Vinheta leve'], '2.39:1', 24, {
    soft: 0.05, vig: 0.15, ca: 0.15, con: 0.12, roll: 0.45, strA: 0.6, strT: 0.78, strS: 140, strH: 215, strC: 0.7, halA: 0.06, halT: 0.85, halS: 10, halH: 40, halC: 0.4,
  }),
  C('lens', 'primo', 'Primo / Ultra Speed', 'Panavision', 'Esféricas limpas e contrastadas: imagem nítida e neutra, cor consistente.', ['Esférica · Série Primo', 'Alta resolução', 'Distorção mínima'], '2.39:1', 24, {
    soft: -0.2, vig: 0.1, con: 0.15, roll: 0.4, ca: 0.05,
  }),
  C('lens', 'cooke', 'Cooke S4 ("Cooke Look")', 'Cooke', 'Quente, suave e cremosa: contraste gentil, pele lisonjeira e transição macia do foco.', ['Esférica · T2', 'Quentura característica', 'Resolução controlada'], '16:9', 24, {
    temp: 0.15, soft: 0.15, con: 0.05, roll: 0.5, toe: 0.3, skin: 0.5, vig: 0.1, hiH: 60, hiA: 0.08, halA: 0.08, halT: 0.8, halS: 12, halH: 55, halC: 0.5,
  }),
  C('lens', 'zeiss', 'Master Prime', 'Zeiss', 'Clínica e transparente: nitidez total, contraste alto e quase nenhuma aberração.', ['Esférica · T1,3', 'Resolução máxima', 'Distorção e vinheta quase zero'], '16:9', 24, {
    soft: -0.3, con: 0.15, roll: 0.35, sat: 0.02,
  }),
  C('lens', 'leica', 'Summilux-C', 'Leica', 'Contraste local alto com suavidade: cores ricas, pele cremosa e vinheta delicada.', ['Esférica · T1,4', 'Contraste micro elevado', 'Cor ligeiramente quente'], '16:9', 24, {
    temp: 0.06, sat: -0.03, con: 0.16, roll: 0.5, toe: 0.3, soft: -0.05, vig: 0.12, skin: 0.4, halA: 0.05, halT: 0.85, halS: 10, halH: 50, halC: 0.4,
  }),
  C('lens', 'helios', 'Helios 44-2 (vintage)', 'Zeiss/KMZ', 'Lente soviética vintage: brilho difuso, contraste baixo, bordas muito suaves e franjas coloridas.', ['Esférica · 58 mm f/2', 'Contraste baixo, véu de luz', 'Aberração e vinheta marcantes'], '16:9', 24, {
    soft: 0.45, vig: 0.35, ca: 0.5, fade: 0.08, sat: 0.1, temp: 0.1, con: -0.05, halA: 0.4, halT: 0.6, halS: 30, halH: 70, halC: 0.35,
  }),
  C('lens', 'promist', 'Black Pro-Mist 1/4', 'Tiffen', 'Filtro de difusão: as luzes ganham um halo suave, o contraste cai e a imagem fica "de cinema".', ['Filtro de difusão', 'Halo nas altas luzes', 'Pretos levantados'], '16:9', 24, {
    soft: 0.15, fade: 0.05, con: -0.04, halA: 0.55, halT: 0.62, halS: 40, halH: 60, halC: 0.15, roll: 0.3,
  }),
  // ── Película
  C('film', 'panaflex', 'Panaflex 35 mm (500T)', 'Panavision', 'O cinema em película: grão orgânico, halação vermelha nas luzes e ombro suave.', ['Película 35 mm · Vision3 500T', 'Grão médio', 'Halação vermelha leve'], '2.39:1', 24, {
    con: 0.15, roll: 0.55, toe: 0.3, sat: 0.04, temp: 0.12, fade: 0.06, grain: 0.35, shH: 205, shA: 0.12, hiH: 52, hiA: 0.13, halA: 0.35, halT: 0.8, halS: 14, halH: 29, halC: 0.9, vig: 0.1, soft: 0.05,
  }),
  C('film', 'super16', 'Super 16 mm (500T)', 'Kodak', 'Granulado, macio e cru: o visual de cinema independente.', ['Película 16 mm · 7219/500T', 'Grão forte', 'Imagem mais macia'], '1.66:1', 24, {
    con: 0.15, roll: 0.5, toe: 0.3, sat: 0.03, temp: 0.1, fade: 0.08, grain: 0.6, soft: 0.35, vig: 0.15, halA: 0.3, halT: 0.78, halS: 18, halH: 29, halC: 0.9, shH: 200, shA: 0.1,
  }),
  C('film', 'super8', 'Super 8 mm', 'Kodak', 'Filme de família: suave, granulado, cor desbotada e luz vazando nas bordas.', ['Película 8 mm · Ektachrome/200T', 'Grão muito forte', 'Vinheta e halação fortes'], '4:3', 18, {
    soft: 0.6, grain: 0.85, vig: 0.38, fade: 0.15, sat: -0.1, temp: 0.2, tint: 0.1, con: 0.12, roll: 0.4, halA: 0.45, halT: 0.7, halS: 26, halH: 29, halC: 0.9, ca: 0.2,
  }),
  C('film', 'technicolor', 'Technicolor 3 tiras', 'Technicolor', 'Primárias saturadas e densas dos grandes musicais e aventuras dos anos 40 e 50.', ['Processo de 3 tiras', 'Saturação extrema', 'Contraste teatral'], '1.37:1', 24, {
    sat: 0.45, vib: 0.1, con: 0.3, roll: 0.45, temp: 0.08, grain: 0.18, soft: 0.1, vig: 0.15, hsel: [{ h: 29, w: 30, ds: 0.3 }, { h: 142, w: 45, ds: 0.3 }, { h: 264, w: 45, ds: 0.3 }, { h: 110, w: 35, ds: 0.2 }],
  }),
  C('film', 'kodak5219', 'Kodak 5219 em tungstênio', 'Kodak', 'Película de cinema balanceada para luz de tungstênio: azulada na luz do dia, quente e rica à noite.', ['Película 35 mm', 'Balanço tungstênio 3200 K', 'Ombro natural'], '2.39:1', 24, {
    temp: -0.2, con: 0.12, roll: 0.5, toe: 0.3, sat: 0.05, grain: 0.28, shH: 215, shA: 0.15, hiH: 55, hiA: 0.1, halA: 0.28, halT: 0.82, halS: 12, halH: 29, halC: 0.9,
  }),
  // ── Celular, ação e drone
  C('consumer', 'iphone', 'iPhone Pro (HDR)', 'Apple', 'Cor viva e luminosa: sombras abertas, realces contidos pelo HDR e nitidez por processamento.', ['Sensor pequeno · HDR por software', 'Tom mapeado, sombras clareadas', 'Nitidez computacional'], '16:9', 30, {
    blk: 0.1, toe: 0.3, roll: 0.6, sat: 0.14, vib: 0.14, con: 0.1, soft: -0.4, temp: -0.03,
  }),
  C('consumer', 'android', 'Galaxy / Android topo', 'Samsung', 'Mais saturado e contrastado: céu azul forte, verdes intensos e imagem brilhante.', ['Sensor pequeno · processamento vivo', 'Saturação alta', 'Nitidez agressiva'], '16:9', 30, {
    sat: 0.25, vib: 0.12, con: 0.15, roll: 0.5, toe: 0.2, soft: -0.35, ev: 0.04, hsel: [{ h: 264, w: 45, ds: 0.2 }, { h: 142, w: 45, ds: 0.15 }],
  }),
  C('consumer', 'gopro', 'GoPro HERO', 'GoPro', 'Câmera de ação: cores vivas e frias, contraste forte, muito nítida e com vinheta leve.', ['Grande angular · sensor pequeno', 'Contraste e saturação altos', 'Nitidez exagerada'], '16:9', 60, {
    sat: 0.2, con: 0.22, vib: 0.1, temp: -0.08, soft: -0.45, vig: 0.15, ca: 0.2, roll: 0.35, blk: -0.05,
  }),
  C('consumer', 'dji', 'DJI Mavic (drone)', 'DJI', 'Céu azul vivo, verdes ricos, contraste firme e leve vinheta típicos de imagens aéreas.', ['Sensor 1 polegada · drone', 'Azuis e verdes realçados', 'Nitidez moderada'], '16:9', 30, {
    sat: 0.16, con: 0.18, vib: 0.1, soft: -0.2, vig: 0.12, roll: 0.45, temp: -0.02, hsel: [{ h: 264, w: 45, ds: 0.22 }, { h: 142, w: 45, ds: 0.15 }],
  }),
  C('consumer', 'dslr5d', 'DSLR de vídeo (2008)', 'Canon', 'O "look DSLR" que revolucionou o cinema independente: macio, quente, pouca nitidez e ruído leve.', ['Sensor Full Frame · H.264 1080p', 'Cor quente de pele', 'Imagem levemente macia'], '16:9', 24, {
    soft: 0.15, temp: 0.1, sat: 0.05, con: 0.1, roll: 0.3, grain: 0.12, vig: 0.1, skin: 0.35, tint: 0.03,
  }),
  // ── Vídeo antigo
  C('retro', 'minidv', 'Handycam MiniDV', 'Sony', 'Início dos anos 2000: macio, cores vivas, luzes estouradas com brilho e leve aberração.', ['Sensor 1/3″ · MiniDV 480i', 'Luzes brilhantes com bloom', 'Ruído de vídeo'], '4:3', 30, {
    soft: 0.35, sat: 0.12, con: 0.15, grain: 0.22, vig: 0.15, ca: 0.2, halA: 0.3, halT: 0.65, halS: 18, halH: 60, halC: 0.2, temp: 0.04,
  }),
  C('retro', 'vhsc', 'Camcorder VHS-C', 'JVC', 'Fita caseira dos anos 90: muito macio, cor desbotada, ruído forte e franjas coloridas.', ['Fita VHS-C 240 linhas', 'Cores borradas', 'Ruído e vinheta'], '4:3', 30, {
    soft: 0.6, grain: 0.38, sat: -0.1, tint: 0.08, temp: 0.06, fade: 0.12, vig: 0.2, ca: 0.3, con: 0.05, halA: 0.2, halT: 0.7, halS: 16, halH: 330, halC: 0.4,
  }),
  C('retro', 'webcam', 'Webcam 720p', 'Genérica', 'Imagem de videochamada: macia, verde-azulada, ruidosa e sem profundidade.', ['Sensor minúsculo', 'Balanço de branco frio-verde', 'Ruído alto em pouca luz'], '16:9', 30, {
    soft: 0.4, grain: 0.28, sat: -0.1, tint: -0.15, temp: -0.1, con: -0.05, fade: 0.04, roll: 0.3,
  }),
  C('retro', 'cctv', 'Câmera de segurança', 'CCTV', 'Imagem fria de monitoramento: quase sem cor, contraste duro, macia e granulada.', ['Sensor pequeno · baixa resolução', 'Cor quase ausente', 'Granulado forte'], '4:3', 15, {
    sat: -0.7, con: 0.2, soft: 0.5, grain: 0.3, vig: 0.25, tint: -0.1, temp: -0.05, fade: 0.04,
  }),
  C('retro', 'disposable', 'Câmera descartável', 'Kodak FunSaver', 'Foto de festa: flash direto, cores quentes, vinheta forte, grão e vazamento de luz.', ['Filme 400 · lente plástica', 'Vinheta forte', 'Cor quente saturada'], '3:2', 24, {
    temp: 0.18, sat: 0.18, con: 0.15, grain: 0.3, soft: 0.3, vig: 0.45, fade: 0.1, ca: 0.3, halA: 0.25, halT: 0.75, halS: 18, halH: 29, halC: 0.8,
  }),
];
export const CAMERA_BY_ID = Object.fromEntries(CAMERAS.map((c) => [c.id, c]));

// ---------- parâmetros e funções ----------

// Parâmetros completos de uma câmera: neutro + receita + ajustes do usuário.
export function cameraParams(cam) {
  const base = cam?.id ? CAMERA_BY_ID[cam.id] : null;
  return { ...NEUTRAL_CAMERA, ...(base?.p || {}), ...(cam?.p || {}) };
}

export const hasCamera = (cam) => !!cam && (cam.intensity ?? 1) > 0;

// Função de cor da câmera (entra na LUT 3D).
export function makeCamera(cam) {
  return makeLook({ p: cameraParams(cam), intensity: cam?.intensity ?? 1 });
}

// Tom da luz de brilho: cor do matiz OKLCh normalizada para que o canal mais forte seja 1.
export function glowTint(hue, sat) {
  if (sat <= 0.001) return [1, 1, 1];
  const [r, g, b] = oklchRgb(0.82, 0.16 * sat, hue);
  const m = Math.max(r, g, b, 1e-3);
  return [r / m, g / m, b / m];
}

// Óptica da câmera pronta para a placa de vídeo e para o FFmpeg: tamanhos em fração da largura do
// quadro, intensidades já multiplicadas pela intensidade geral. null se não há nada para fazer.
export function opticsOf(cam) {
  if (!hasCamera(cam)) return null;
  const P = cameraParams(cam);
  const k = Math.min(1.5, cam.intensity ?? 1);
  const out = { ca: P.ca * k };
  const layer = (name, gain, horizontal) => {
    const A = P[name + 'A'] * k;
    if (A <= 0.004) return null;
    return {
      amount: +(A * gain).toFixed(4),
      thr: P[name + 'T'],
      sigma: P[name + 'S'] / 1920, // em frações da largura
      horizontal,
      rgb: glowTint(P[name + 'H'], P[name + 'C']),
    };
  };
  out.hal = layer('hal', 2.2, false);
  out.str = layer('str', 2.0, true);
  out.soft = P.soft * k;
  out.vig = P.vig * k;
  out.grain = P.grain * k;
  return out.ca > 0.004 || out.hal || out.str ? out : { soft: out.soft, vig: out.vig, grain: out.grain, ca: 0, hal: null, str: null };
}

// Resumo da receita em frases curtas.
export function describeCamera(cam) {
  const P = cameraParams(cam);
  const out = [];
  const pct = (v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
  if (P.roll) out.push(`Ombro de realces ${Math.round(P.roll * 100)}%`);
  if (P.toe) out.push(`Pé de sombras ${Math.round(P.toe * 100)}%`);
  if (P.con) out.push(`Contraste ${pct(P.con)}`);
  if (P.soft > 0.02) out.push(`Lente macia ${Math.round(P.soft * 100)}%`);
  if (P.soft < -0.02) out.push(`Nitidez ${Math.round(-P.soft * 100)}%`);
  if (P.vig) out.push(`Vinheta ${Math.round(P.vig * 100)}%`);
  if (P.ca) out.push(`Aberração ${Math.round(P.ca * 100)}%`);
  if (P.halA) out.push(`Halação ${Math.round(P.halA * 100)}%`);
  if (P.strA) out.push(`Flare anamórfico ${Math.round(P.strA * 100)}%`);
  if (P.grain) out.push(`Grão ${Math.round(P.grain * 100)}%`);
  if (P.skin) out.push('Pele protegida');
  return out;
}
