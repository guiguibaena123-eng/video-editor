import { needsGLPass } from './effects';
// Aplica a cor do clipe na prévia usando a placa de vídeo (WebGL2):
// nitidez → LUT 3D (todos os ajustes de cor) → vinheta. Mesma ordem da exportação.

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  v_uv.y = 1.0 - v_uv.y;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler2D u_img;
uniform sampler3D u_lut;
uniform float u_useLut;
uniform float u_size;
uniform float u_vig;
uniform float u_sharp;
uniform vec2 u_res;
uniform float u_useKey;
uniform vec3 u_key;
uniform float u_sim;
uniform float u_blend;
uniform float u_ca;
in vec2 v_uv;
out vec4 o;
void main() {
  vec4 c = texture(u_img, v_uv);
  float alpha = c.a;
  if (u_ca > 0.0) {
    // Aberração cromática lateral: vermelho e verde ampliados em relação ao azul, a partir do centro.
    vec2 d = v_uv - 0.5;
    c.r = texture(u_img, 0.5 + d / (1.0 + 2.0 * u_ca)).r;
    c.g = texture(u_img, 0.5 + d / (1.0 + u_ca)).g;
  }
  if (u_useKey > 0.5) {
    // Chroma key igual ao filtro colorkey do FFmpeg (distância RGB até a cor-chave).
    vec3 d = c.rgb * 255.0 - u_key;
    float diff = sqrt(dot(d, d) / (255.0 * 255.0 * 3.0));
    alpha *= u_blend > 0.0001 ? clamp((diff - u_sim) / u_blend, 0.0, 1.0) : (diff > u_sim ? 1.0 : 0.0);
  }
  if (u_sharp != 0.0) {
    // Nitidez (valor positivo) ou maciez (negativo): realça/reduz a diferença para a média 5x5
    // (como o filtro unsharp do FFmpeg).
    vec2 px = 1.0 / u_res;
    vec3 blur = vec3(0.0);
    for (int x = -2; x <= 2; x++)
      for (int y = -2; y <= 2; y++) blur += texture(u_img, v_uv + vec2(float(x), float(y)) * px).rgb;
    blur /= 25.0;
    c.rgb = c.rgb + (c.rgb - blur) * u_sharp;
  }
  c.rgb = clamp(c.rgb, 0.0, 1.0);
  if (u_useLut > 0.5) {
    vec3 coord = c.rgb * ((u_size - 1.0) / u_size) + 0.5 / u_size;
    c.rgb = texture(u_lut, coord).rgb;
  }
  if (u_vig > 0.0) {
    // Vinheta igual à do FFmpeg: cos(ângulo × distância ao centro)^4.
    vec2 d = (v_uv - 0.5) * u_res;
    float dist = length(d) / length(u_res * 0.5);
    float f = cos(u_vig * dist);
    f *= f;
    f *= f;
    c.rgb *= f;
  }
  o = vec4(c.rgb, alpha);
}`;

// Segundo passo (só quando o clipe tem efeitos de imagem): glitch RGB → pixelar → inverter →
// granulado. Mesma ordem e mesmas contas dos filtros do FFmpeg na exportação
// (rgbashift edge=smear, pixelize avg, negate, noise).
const FX = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_shift;
uniform float u_pix;
uniform float u_invert;
uniform float u_grain;
uniform float u_time;
uniform float u_mirror;
uniform float u_split;
uniform float u_useTone;
uniform vec4 u_tone; // brilho, contraste, saturação, matiz (graus) — como eq/hue do FFmpeg
uniform float u_bars;
uniform float u_iris;
in vec2 v_uv;
out vec4 o;
// p em pixels da imagem (origem no canto de cima, como no FFmpeg). A textura do passo 1
// guarda a imagem com o eixo y para cima, então a leitura desvira.
vec4 at(vec2 p) {
  vec2 q = clamp(p, vec2(0.5), u_res - 0.5);
  return texture(u_src, vec2(q.x, u_res.y - q.y) / u_res);
}
// Espelho (metade esquerda refletida) e tela dividida (n×n cópias menores).
vec2 remap(vec2 p) {
  if (u_split > 1.5) p = mod(p * u_split, u_res);
  if (u_mirror > 0.5 && p.x > u_res.x * 0.5) p.x = u_res.x - p.x;
  return p;
}
vec4 glitched(vec2 p) {
  vec4 c = at(remap(p));
  if (u_shift != 0.0) {
    c.r = at(remap(p - vec2(u_shift, 0.0))).r;
    c.b = at(remap(p + vec2(u_shift, 0.0))).b;
  }
  return c;
}
float rnd(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}
// Mesmas contas dos filtros hue e eq do FFmpeg, feitas em YUV (BT.601, faixa de TV),
// que é o formato em que o FFmpeg aplica esses filtros.
vec3 tone(vec3 c) {
  float Y = 16.0 + 65.481 * c.r + 128.553 * c.g + 24.966 * c.b;
  float U = -37.797 * c.r - 74.203 * c.g + 112.0 * c.b;
  float V = 112.0 * c.r - 93.786 * c.g - 18.214 * c.b;
  float h = radians(u_tone.w);
  float u2 = cos(h) * U - sin(h) * V;
  float v2 = sin(h) * U + cos(h) * V;
  // O eq só mexe num canal quando o valor dele muda (sem mudança, o canal passa intacto).
  float y = (u_tone.x == 0.0 && u_tone.y == 1.0) ? Y : clamp(256.0 * (u_tone.y * (Y / 255.0 - 0.5) + 0.5 + u_tone.x), 0.0, 255.0);
  if (u_tone.z != 1.0) {
    u2 = clamp(256.0 * (u_tone.z * ((u2 + 128.0) / 255.0 - 0.5) + 0.5), 0.0, 255.0) - 128.0;
    v2 = clamp(256.0 * (u_tone.z * ((v2 + 128.0) / 255.0 - 0.5) + 0.5), 0.0, 255.0) - 128.0;
  }
  float yy = (y - 16.0) / 219.0;
  return vec3(yy + 1.402 * v2 / 224.0, yy - 0.344136 * u2 / 224.0 - 0.714136 * v2 / 224.0, yy + 1.772 * u2 / 224.0);
}
void main() {
  vec2 p = v_uv * u_res;
  vec4 c;
  if (u_pix > 1.0) {
    vec2 o0 = floor(p / u_pix) * u_pix;
    vec2 size = min(vec2(u_pix), u_res - o0);
    c = vec4(0.0);
    for (int i = 0; i < 6; i++)
      for (int j = 0; j < 6; j++) c += glitched(o0 + (vec2(float(i), float(j)) + 0.5) * size / 6.0);
    c /= 36.0;
  } else c = glitched(p);
  if (u_invert > 0.5) c.rgb = 1.0 - c.rgb;
  if (u_useTone > 0.5) c.rgb = tone(clamp(c.rgb, 0.0, 1.0));
  if (u_grain > 0.0) c.rgb += (rnd(floor(p) + fract(u_time * 13.17) * 91.0) - 0.5) * 1.2 * u_grain / 255.0;
  // Barras de cinema e íris: fora delas a imagem fica transparente.
  if (u_bars > 0.0 && (p.y < u_bars * u_res.y || p.y > u_res.y - u_bars * u_res.y)) c.a = 0.0;
  if (u_iris < 1.0 && length(p - u_res * 0.5) > u_iris * length(u_res * 0.5)) c.a = 0.0;
  o = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
}`;

// Brilho de lente (halação e flare anamórfico), em três passos como na exportação do FFmpeg:
// 1) MASK: rampa por canal acima do limiar e média em blocos D×D (== lutrgb + scale=area);
// 2) BLUR: gaussiana separável (== gblur) no quadro pequeno;
// 3) COMP: soma o brilho tingido na imagem com o modo "tela" (== blend=screen) e aplica a vinheta.
const MASK = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform float u_thr;
uniform float u_d;
out vec4 o;
void main() {
  ivec2 base = ivec2(gl_FragCoord.xy) * int(u_d);
  ivec2 lim = textureSize(u_src, 0) - 1;
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 16; j++) {
    if (j >= int(u_d)) break;
    for (int i = 0; i < 16; i++) {
      if (i >= int(u_d)) break;
      vec3 c = texelFetch(u_src, min(base + ivec2(i, j), lim), 0).rgb;
      acc += clamp((c - u_thr) / (1.0 - u_thr), 0.0, 1.0);
    }
  }
  o = vec4(acc / (u_d * u_d), 1.0);
}`;

const BLUR = `#version 300 es
precision highp float;
uniform sampler2D u_in;
uniform vec2 u_dir;
uniform float u_sigma;
out vec4 o;
void main() {
  ivec2 size = textureSize(u_in, 0);
  ivec2 p = ivec2(gl_FragCoord.xy);
  float s = max(u_sigma, 0.05);
  int r = int(ceil(3.0 * s));
  vec3 acc = vec3(0.0);
  float ws = 0.0;
  for (int i = -60; i <= 60; i++) {
    if (i < -r || i > r) continue;
    float w = exp(-0.5 * float(i * i) / (s * s));
    acc += w * texelFetch(u_in, clamp(p + ivec2(u_dir) * i, ivec2(0), size - 1), 0).rgb;
    ws += w;
  }
  o = vec4(acc / ws, 1.0);
}`;

const COMP = `#version 300 es
precision highp float;
uniform sampler2D u_base;
uniform sampler2D u_g0;
uniform sampler2D u_g1;
uniform vec3 u_t0;
uniform vec3 u_t1;
uniform float u_use0;
uniform float u_use1;
uniform float u_vig;
uniform vec2 u_res;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 b = texture(u_base, uv);
  vec3 col = b.rgb;
  if (u_use0 > 0.5) col = 1.0 - (1.0 - col) * (1.0 - clamp(texture(u_g0, uv).rgb * u_t0, 0.0, 1.0));
  if (u_use1 > 0.5) col = 1.0 - (1.0 - col) * (1.0 - clamp(texture(u_g1, uv).rgb * u_t1, 0.0, 1.0));
  if (u_vig > 0.0) {
    vec2 d = (uv - 0.5) * u_res;
    float dist = length(d) / length(u_res * 0.5);
    float f = cos(u_vig * dist);
    f *= f;
    f *= f;
    col *= f;
  }
  o = vec4(clamp(col, 0.0, 1.0), b.a);
}`;

class ColorGL {
  canvas = null;
  gl = null;
  loc = {};
  luts = new Map(); // chave -> { tex, size }

  init() {
    if (this.gl) return true;
    this.canvas = document.createElement('canvas');
    const gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false });
    if (!gl) return false;
    const compile = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const link = (frag) => {
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, frag));
      gl.bindAttribLocation(prog, 0, 'a_pos');
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      return prog;
    };
    const prog = link(FRAG);
    const fxProg = link(FX);
    this.prog = prog;
    this.fxProg = fxProg;
    this.maskProg = link(MASK);
    this.blurProg = link(BLUR);
    this.compProg = link(COMP);
    for (const [prog2, key, names] of [
      [this.maskProg, 'mk', ['u_src', 'u_thr', 'u_d']],
      [this.blurProg, 'bl', ['u_in', 'u_dir', 'u_sigma']],
      [this.compProg, 'cp', ['u_base', 'u_g0', 'u_g1', 'u_t0', 'u_t1', 'u_use0', 'u_use1', 'u_vig', 'u_res']],
    ]) {
      for (const n of names) this.loc[key + n] = gl.getUniformLocation(prog2, n);
    }
    gl.useProgram(this.maskProg);
    gl.uniform1i(this.loc.mku_src, 2);
    gl.useProgram(this.blurProg);
    gl.uniform1i(this.loc.blu_in, 3);
    gl.useProgram(this.compProg);
    gl.uniform1i(this.loc.cpu_base, 2);
    gl.uniform1i(this.loc.cpu_g0, 5);
    gl.uniform1i(this.loc.cpu_g1, 6);
    this.floatRT = !!gl.getExtension('EXT_color_buffer_float');
    this.bank = new Map(); // textura de trabalho por nome: { tex, w, h }
    gl.useProgram(fxProg);
    for (const n of ['u_src', 'u_res', 'u_shift', 'u_pix', 'u_invert', 'u_grain', 'u_time', 'u_mirror', 'u_split', 'u_useTone', 'u_tone', 'u_bars', 'u_iris']) this.loc['fx' + n] = gl.getUniformLocation(fxProg, n);
    gl.uniform1i(this.loc.fxu_src, 2);
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['u_img', 'u_lut', 'u_useLut', 'u_size', 'u_vig', 'u_sharp', 'u_res', 'u_useKey', 'u_key', 'u_sim', 'u_blend', 'u_ca']) this.loc[n] = gl.getUniformLocation(prog, n);
    gl.uniform1i(this.loc.u_img, 0);
    gl.uniform1i(this.loc.u_lut, 1);
    this.frameTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    // Quadro intermediário (resultado da cor) para o passo dos efeitos.
    this.fboTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
      [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_2D, k, v);
    this.fbo = gl.createFramebuffer();
    this.fboSize = [0, 0];
    this.gl = gl;
    return true;
  }

  // Textura de trabalho (RGBA16F se a placa deixar desenhar nela, senão RGBA8) com o tamanho pedido.
  work(name, w, h, unit) {
    const gl = this.gl;
    let e = this.bank.get(name);
    if (!e) {
      e = { tex: gl.createTexture(), w: 0, h: 0 };
      this.bank.set(name, e);
    }
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    if (e.w !== w || e.h !== h) {
      if (this.floatRT) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
      else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [
        [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
        [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
        [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
        [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      ])
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      e.w = w;
      e.h = h;
    }
    return e;
  }

  // Liga a textura como destino do desenho (e já ajusta o viewport).
  target(tex, w, h) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
  }

  // Uma camada de brilho (halação ou flare): rampa → média em blocos → gaussiana. Deixa o resultado
  // na textura de trabalho "name" (tamanho reduzido) e devolve o nome.
  glowLayer(name, L, w, h, unit) {
    const gl = this.gl;
    const sigma = L.sigma * w; // em pixels do quadro
    let D = 4;
    while (sigma / D > 14 && D < 16) D *= 2;
    const sw = Math.max(1, Math.floor(w / D));
    const sh = Math.max(1, Math.floor(h / D));
    const A = this.work(name + 'a', sw, sh, 7);
    const B = this.work(name + 'b', sw, sh, 8);
    // 1) rampa + blocos D×D (lê a imagem do passo 1, na unidade 2)
    gl.useProgram(this.maskProg);
    this.target(A.tex, sw, sh);
    gl.uniform1f(this.loc.mku_thr, L.thr);
    gl.uniform1f(this.loc.mku_d, D);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // 2) gaussiana horizontal (A → B) e vertical (B → A; o flare só borra na horizontal)
    gl.useProgram(this.blurProg);
    const s = sigma / D;
    gl.uniform1f(this.loc.blu_sigma, s);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, A.tex);
    this.target(B.tex, sw, sh);
    gl.uniform2f(this.loc.blu_dir, 1, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!L.horizontal) {
      gl.bindTexture(gl.TEXTURE_2D, B.tex);
      this.target(A.tex, sw, sh);
      gl.uniform2f(this.loc.blu_dir, 0, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      return A;
    }
    return B;
  }

  lutTexture(key, data, size) {
    let entry = this.luts.get(key);
    if (entry) return entry;
    const gl = this.gl;
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB16F, size, size, size, 0, gl.RGB, gl.FLOAT, data);
    for (const [k, v] of [
      [gl.TEXTURE_MIN_FILTER, gl.LINEAR],
      [gl.TEXTURE_MAG_FILTER, gl.LINEAR],
      [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
      [gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE],
    ])
      gl.texParameteri(gl.TEXTURE_3D, k, v);
    entry = { tex, size };
    this.luts.set(key, entry);
    // Mantém só as LUTs recentes na memória da placa.
    if (this.luts.size > 24) {
      const [oldKey, old] = this.luts.entries().next().value;
      gl.deleteTexture(old.tex);
      this.luts.delete(oldKey);
    }
    return entry;
  }

  // Devolve um canvas com o quadro já colorido (no tamanho do quadro, limitado a 1920 px).
  // fx = efeitos de imagem (src/effects.js imageFxAt), em fração da largura do quadro.
  render(src, lut, { vignette = 0, sharpen = 0, chroma = null, fx = null, time = 0, optics = null } = {}) {
    if (!this.init()) return src;
    const gl = this.gl;
    const sw = src.videoWidth || src.naturalWidth || src.displayWidth || src.width;
    const sh = src.videoHeight || src.naturalHeight || src.displayHeight || src.height;
    if (!sw || !sh) return src;
    const k = Math.min(1, 1920 / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * k));
    const h = Math.max(1, Math.round(sh * k));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.useProgram(this.prog);
    const twoPass = needsGLPass(fx);
    const glow = optics && (optics.hal || optics.str) ? optics : null;
    if (twoPass || glow) {
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      if (this.fboSize[0] !== w || this.fboSize[1] !== h) {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        this.fboSize = [w, h];
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
      // A textura do passo 2 não pode estar ligada enquanto é o destino do desenho.
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.uniform1f(this.loc.u_useLut, lut ? 1 : 0);
    if (lut) {
      const entry = this.lutTexture(lut.key, lut.data, lut.size);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, entry.tex);
      gl.uniform1f(this.loc.u_size, lut.size);
    }
    gl.uniform1f(this.loc.u_vig, glow ? 0 : vignette); // com brilho de lente, a vinheta vem depois
    gl.uniform1f(this.loc.u_sharp, sharpen);
    gl.uniform1f(this.loc.u_ca, optics?.ca > 0.004 ? optics.ca * 0.004 : 0);
    gl.uniform2f(this.loc.u_res, w, h);
    gl.uniform1f(this.loc.u_useKey, chroma ? 1 : 0);
    if (chroma) {
      const n = parseInt((chroma.color || '#00ff00').slice(1), 16);
      gl.uniform3f(this.loc.u_key, (n >> 16) & 255, (n >> 8) & 255, n & 255);
      gl.uniform1f(this.loc.u_sim, chroma.similarity ?? 0.3);
      gl.uniform1f(this.loc.u_blend, chroma.smooth ?? 0.1);
    }
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    let fxTex = this.fboTex;
    if (glow) {
      // Brilho de lente: camadas (halação / flare) e soma na imagem já colorida.
      const layers = [glow.hal && this.glowLayer('hal', glow.hal, w, h), glow.str && this.glowLayer('str', glow.str, w, h)];
      const out = this.work('comp', w, h, 9);
      gl.useProgram(this.compProg);
      if (twoPass) this.target(out.tex, w, h);
      else {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, w, h);
      }
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      const bind = (i, unit, L) => {
        gl.uniform1f(this.loc['cpu_use' + i], L ? 1 : 0);
        if (!L) return;
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, layers[i].tex);
        gl.uniform3f(this.loc['cpu_t' + i], L.rgb[0] * L.amount, L.rgb[1] * L.amount, L.rgb[2] * L.amount);
      };
      bind(0, 5, glow.hal);
      bind(1, 6, glow.str);
      gl.uniform1f(this.loc.cpu_vig, vignette);
      gl.uniform2f(this.loc.cpu_res, w, h);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (twoPass) fxTex = out.tex;
    }
    if (twoPass) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      gl.useProgram(this.fxProg);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, fxTex);
      gl.uniform2f(this.loc.fxu_res, w, h);
      gl.uniform1f(this.loc.fxu_shift, (fx.shift || 0) * w);
      gl.uniform1f(this.loc.fxu_mirror, fx.mirror ? 1 : 0);
      gl.uniform1f(this.loc.fxu_split, fx.split || 0);
      gl.uniform1f(this.loc.fxu_useTone, fx.tone ? 1 : 0);
      const tn = fx.tone || { bri: 0, con: 1, sat: 1, hue: 0 };
      gl.uniform4f(this.loc.fxu_tone, tn.bri, tn.con, tn.sat, tn.hue);
      gl.uniform1f(this.loc.fxu_bars, fx.bars || 0);
      gl.uniform1f(this.loc.fxu_iris, fx.iris ?? 1);
      gl.uniform1f(this.loc.fxu_pix, fx.pixel ? Math.max(2, fx.pixel * w) : 0);
      gl.uniform1f(this.loc.fxu_invert, fx.invert ? 1 : 0);
      gl.uniform1f(this.loc.fxu_grain, fx.grain || 0);
      gl.uniform1f(this.loc.fxu_time, time);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    return this.canvas;
  }
}

export const colorGL = new ColorGL();
