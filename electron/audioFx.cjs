// Efeitos de áudio feitos pelo FFmpeg. A mesma cadeia gera o áudio da prévia
// (arquivo processado) e o da exportação, então os dois soam iguais.

const VOICES = {
  chipmunk: 'rubberband=pitch=1.7',
  deep: 'rubberband=pitch=0.7',
  monster: 'rubberband=pitch=0.55,aecho=0.8:0.7:60:0.3',
  robot: "afftfilt=real='hypot(re,im)*sin(0)':imag='hypot(re,im)*cos(0)':win_size=512:overlap=0.75",
  echo: 'aecho=0.8:0.85:300|600:0.45|0.25',
  hall: 'aecho=0.8:0.9:40|70|110|170:0.35|0.28|0.22|0.15',
  phone: 'highpass=f=400,lowpass=f=3200',
  megaphone: 'highpass=f=500,lowpass=f=3500,volume=4,asoftclip',
  radio: 'highpass=f=300,lowpass=f=2500,acrusher=bits=10:mix=0.3',
  underwater: 'lowpass=f=450,vibrato=f=4:d=0.3',
};

const DENOISE = {
  low: 'afftdn=nr=10:nf=-40',
  medium: 'afftdn=nr=20:nf=-35',
  high: 'afftdn=nr=33:nf=-30',
};

// Cadeia de filtros para os efeitos "pesados" de um clipe, ou null se não houver.
function fxChain(fx) {
  if (!fx) return null;
  const parts = [];
  if (DENOISE[fx.denoise]) parts.push(DENOISE[fx.denoise]);
  if (VOICES[fx.voice]) parts.push(VOICES[fx.voice]);
  if (fx.normalize) parts.push('loudnorm=I=-16:TP=-1.5:LRA=11');
  return parts.length ? parts.join(',') : null;
}

module.exports = { fxChain, VOICES, DENOISE };
