// Estilos prontos (um texto) e modelos (um ou mais textos com animação).
// Cada item de "clips" vira um clipe de texto: style sobrescreve DEFAULT_STYLE.

const S = (id, label, style) => ({ id, label, clips: [{ style }] });

export const TEXT_STYLES = [
  S('classic', 'Clássico', {}),
  S('outline', 'Contorno', { stroke: { enabled: true, color: '#000000', width: 8 } }),
  S('highlight', 'Destaque', { font: 'Anton', bold: false, color: '#ffd400', stroke: { enabled: true, color: '#000000', width: 7 }, shadow: { enabled: true, opacity: 0.7, blur: 0, distance: 8, angle: 60 } }),
  S('soft', 'Sombra suave', { font: 'Poppins', shadow: { enabled: true, opacity: 0.7, blur: 22, distance: 6, angle: 90 } }),
  S('neon-pink', 'Neon rosa', { font: 'Poppins', color: '#fff5fd', glow: { enabled: true, color: '#ff2bd6', strength: 34 } }),
  S('neon-blue', 'Neon azul', { font: 'Poppins', color: '#effcff', glow: { enabled: true, color: '#00c8ff', strength: 34 } }),
  S('box-dark', 'Caixa escura', { font: 'Poppins', size: 72, background: { enabled: true, color: '#000000', opacity: 0.75, radius: 14, padding: 22 } }),
  S('box-yellow', 'Caixa amarela', { size: 72, color: '#111111', background: { enabled: true, color: '#ffc72c', opacity: 1, radius: 10, padding: 22 } }),
  S('sunset', 'Pôr do sol', { font: 'Montserrat', gradient: { enabled: true, from: '#ffd34d', to: '#ff4e7a' }, shadow: { enabled: true, opacity: 0.45, blur: 16, distance: 4, angle: 90 } }),
  S('ocean', 'Oceano', { font: 'Poppins', gradient: { enabled: true, from: '#7af0ff', to: '#2f6bff' }, stroke: { enabled: true, color: '#0a1a3a', width: 5 } }),
  S('retro', 'Retrô', { font: 'Bangers', bold: false, size: 110, color: '#ffe066', letterSpacing: 2, stroke: { enabled: true, color: '#d7263d', width: 7 }, shadow: { enabled: true, color: '#3a0ca3', opacity: 1, blur: 0, distance: 10, angle: 45 } }),
  S('elegant', 'Elegante', { font: 'Playfair Display', italic: true, bold: false, letterSpacing: 2, shadow: { enabled: true, opacity: 0.5, blur: 16, distance: 3, angle: 90 } }),
  S('script', 'Manuscrito', { font: 'Pacifico', bold: false, shadow: { enabled: true, opacity: 0.55, blur: 10, distance: 4, angle: 90 } }),
  S('marker', 'Marcador', { font: 'Permanent Marker', bold: false, stroke: { enabled: true, color: '#000000', width: 5 } }),
  S('cinema', 'Cinema', { font: 'Bebas Neue', bold: false, size: 120, letterSpacing: 14 }),
  S('comic', 'Quadrinhos', { font: 'Bangers', bold: false, size: 120, color: '#ffffff', stroke: { enabled: true, color: '#000000', width: 9 }, shadow: { enabled: true, color: '#000000', opacity: 1, blur: 0, distance: 12, angle: 45 } }),
];

export const TEXT_TEMPLATES = [
  {
    id: 'opening',
    label: 'Abertura',
    clips: [
      { style: { content: 'SEU TÍTULO', size: 150, letterSpacing: 4 }, transform: { y: -0.04 }, anim: { in: { type: 'zoomOut', dur: 0.8 }, out: { type: 'fade', dur: 0.6 } } },
      { style: { content: 'subtítulo aqui', font: 'Poppins', bold: false, size: 46, letterSpacing: 10, color: '#d9d9d9' }, transform: { y: 0.09 }, anim: { in: { type: 'fade', dur: 1.2 }, out: { type: 'fade', dur: 0.6 } } },
    ],
  },
  {
    id: 'lower-third',
    label: 'Nome na tela',
    clips: [
      { style: { content: 'Nome Sobrenome', size: 58, color: '#111111', align: 'left', background: { enabled: true, color: '#ffc72c', opacity: 1, radius: 6, padding: 18 } }, transform: { x: -0.27, y: 0.3 }, anim: { in: { type: 'slideRight', dur: 0.5 }, out: { type: 'slideLeft', dur: 0.4 } } },
      { style: { content: 'Cargo ou descrição', font: 'Poppins', bold: false, size: 36, align: 'left', background: { enabled: true, color: '#000000', opacity: 0.8, radius: 6, padding: 14 } }, transform: { x: -0.28, y: 0.38 }, anim: { in: { type: 'slideRight', dur: 0.7 }, out: { type: 'slideLeft', dur: 0.4 } } },
    ],
  },
  {
    id: 'subscribe',
    label: 'Inscreva-se',
    clips: [{ style: { content: 'INSCREVA-SE', size: 70, letterSpacing: 2, background: { enabled: true, color: '#e1141f', opacity: 1, radius: 16, padding: 24 } }, transform: { y: 0.32 }, anim: { in: { type: 'pop', dur: 0.5 }, out: { type: 'zoomOut', dur: 0.3 }, loop: { type: 'pulse', period: 1 } } }],
  },
  {
    id: 'caption',
    label: 'Legenda',
    clips: [{ style: { content: 'Sua legenda aqui', font: 'Poppins', size: 58, stroke: { enabled: true, color: '#000000', width: 6 } }, transform: { y: 0.36 }, anim: { in: { type: 'fade', dur: 0.25 }, out: { type: 'fade', dur: 0.25 } } }],
  },
  {
    id: 'quote',
    label: 'Citação',
    clips: [{ style: { content: '“Uma frase que marca.”', font: 'Playfair Display', italic: true, bold: false, size: 84, shadow: { enabled: true, opacity: 0.6, blur: 18, distance: 4, angle: 90 } }, anim: { in: { type: 'blur', dur: 1 }, out: { type: 'fade', dur: 0.8 } } }],
  },
  {
    id: 'wow',
    label: 'Impacto',
    clips: [{ style: { content: 'UAU!', font: 'Bangers', bold: false, size: 220, color: '#ffd400', stroke: { enabled: true, color: '#000000', width: 10 }, shadow: { enabled: true, opacity: 1, blur: 0, distance: 14, angle: 45 } }, transform: { rotation: -6 }, anim: { in: { type: 'pop', dur: 0.45 }, out: { type: 'zoomIn', dur: 0.3 }, loop: { type: 'shake', period: 2 } } }],
  },
  {
    id: 'typing',
    label: 'Digitando',
    clips: [{ style: { content: 'digitando uma ideia...', font: 'Courier New', bold: true, size: 64, color: '#7CFC9A', background: { enabled: true, color: '#0b0f0c', opacity: 0.85, radius: 10, padding: 22 } }, anim: { in: { type: 'typewriter', dur: 1.6 }, out: { type: 'fade', dur: 0.4 } } }],
  },
  {
    id: 'neon-sign',
    label: 'Letreiro neon',
    clips: [{ style: { content: 'ABERTO', font: 'Poppins', size: 130, letterSpacing: 8, color: '#fff5fd', glow: { enabled: true, color: '#ff2bd6', strength: 40 } }, anim: { in: { type: 'fade', dur: 0.6 }, out: { type: 'fade', dur: 0.4 }, loop: { type: 'blink', period: 1.6 } } }],
  },
];
