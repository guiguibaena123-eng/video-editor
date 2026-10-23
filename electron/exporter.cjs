// Monta a linha de comando do FFmpeg que renderiza o projeto.
const path = require('path');
const fs = require('fs');
const os = require('os');


const even = (n) => Math.max(2, Math.round(n / 2) * 2);

// Muda a velocidade do áudio. Mantendo o tom: atempo (aceita 0.5 a 100 por etapa, então encadeia).
// Sem manter o tom: muda a taxa de amostragem (fica mais grave/agudo, como fita acelerada).
function tempoFilters(v, keepPitch) {
  if (Math.abs(v - 1) < 1e-4) return [];
  if (!keepPitch) return [`asetrate=${Math.round(48000 * v)}`, 'aresample=48000'];
  const out = [];
  let r = v;
  while (r < 0.5) {
    out.push('atempo=0.5');
    r /= 0.5;
  }
  while (r > 100) {
    out.push('atempo=100');
    r /= 100;
  }
  out.push(`atempo=${(Math.round(r * 1e4) / 1e4).toString()}`);
  return out;
}
// Redução de tamanho: Lanczos de 2 lóbulos (o padrão de 3 lóbulos realça bordas ~4% a mais que uma redução neutra e cria halos).
// "exatas": arredondamento preciso e croma completo, para o vídeo não perder cor nem nitidez na conversão.
const SCALE = 'flags=lanczos+accurate_rnd+full_chroma_int:param0=2';
const EXACT = 'flags=accurate_rnd+full_chroma_int';
const num = (n) => (Math.round(n * 1000) / 1000).toString();

function buildExport(job) {
  const { tracks, clips, settings } = job.project;
  const media = job.media;
  const { width: W, height: H, fps, crf, codec, output } = job.output;
  // _dur e _segs vêm calculados do app (velocidade constante ou curva de velocidade).
  const dur = (c) => c._dur ?? (c.out - c.in) / (c.speed || 1);
  const total = Math.max(0.1, ...clips.map((c) => c.start + dur(c)));

  const args = ['-y', '-hide_banner', '-v', 'error', '-progress', 'pipe:1', '-nostats'];
  const graph = [];
  // Arquivos de comandos (animação) ficam na pasta temporária; o FFmpeg roda com ela como pasta atual.
  const stamp = Date.now();
  const temps = [];
  const writeTemp = (name, text) => {
    const file = `video-editor-${stamp}-${name}`;
    fs.writeFileSync(path.join(os.tmpdir(), file), text);
    temps.push(path.join(os.tmpdir(), file));
    return file;
  };
  const bg = (settings.background || '#000000').replace('#', '0x');
  args.push('-f', 'lavfi', '-i', `color=c=${bg}:s=${W}x${H}:r=${fps}:d=${num(total)}`);
  let inputs = 1;
  let base = '[0:v]';
  const clipInput = {};
  let v = 0;

  const byStart = (a, b) => a.start - b.start;
  // Modo de mesclagem: o clipe é montado sobre uma cor neutra (que não muda nada no modo)
  // do tamanho do vídeo, e essa camada é mesclada com o que já está embaixo.
  const layerTarget = (c) => {
    if (!c._blend) return base;
    args.push('-f', 'lavfi', '-i', `color=c=${c._blendNeutral}:s=${W}x${H}:r=${fps}:d=${num(total)}`);
    return `[${inputs++}:v]`;
  };
  const finishLayer = (c, k) => {
    if (c._blend) {
      graph.push(`${base}format=gbrp[bb${k}]`);
      graph.push(`[ly${k}]format=gbrp[lb${k}]`);
      graph.push(`[bb${k}][lb${k}]blend=all_mode=${c._blend}[b${k}]`);
    }
    base = `[b${k}]`;
  };
  const videoTracks = tracks.filter((t) => t.kind === 'video' && !t.hidden).reverse();
  for (const t of videoTracks) {
    for (const c of clips.filter((x) => x.trackId === t.id).sort(byStart)) {
      // Texto: sequências de PNG do tamanho do vídeo, geradas pelo app (mesmo desenho da prévia).
      if (c.kind === 'text') {
        const assets = job.textAssets && job.textAssets[c.id];
        if (!assets || !job.assetDir) continue;
        for (const seg of assets.segments) {
          if (seg.kind === 'seq') args.push('-framerate', String(fps), '-start_number', '0', '-i', path.join(job.assetDir, seg.pattern));
          else args.push('-loop', '1', '-framerate', String(fps), '-t', num(seg.dur), '-i', path.join(job.assetDir, seg.file));
          const i = inputs++;
          const end = seg.start + seg.dur - 0.5 / fps;
          graph.push(`[${i}:v]format=rgba,setpts=PTS-STARTPTS+${num(seg.start)}/TB[v${v}]`);
          graph.push(`${base}[v${v}]overlay=0:0:eof_action=pass:enable='between(t,${num(seg.start)},${num(end)})'[b${v}]`);
          base = `[b${v}]`;
          v++;
        }
        continue;
      }
      const m = media[c.mediaId];
      if (!m || !m.width || !m.height) continue;
      const d = dur(c);
      if (m.type === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', num(d), '-i', m.path);
      else args.push('-ss', num(c.in), '-t', num(c.out - c.in), '-i', m.path);
      const i = inputs++;
      clipInput[c.id] = i;

      const tr = c.transform || {};
      const crop = c.crop || { x: 0, y: 0, w: 1, h: 1 };
      const srcW = m.width * crop.w;
      const srcH = m.height * crop.h;
      const scale = tr.scale ?? 1;
      const fit = Math.min(W / srcW, H / srcH) * scale;
      const w = even(srcW * fit);
      const h = even(srcH * fit);
      const opacity = tr.opacity ?? 1;
      const rad = ((tr.rotation || 0) * Math.PI) / 180;
      // Velocidade: curva = trechos com velocidades diferentes emendados; constante = um setpts só.
      let src = `[${i}:v]`;
      const chain = ['setpts=PTS-STARTPTS'];
      if (m.type !== 'image' && c._segs) {
        const n = c._segs.length;
        graph.push(`${src}split=${n}${c._segs.map((_, k) => `[vs${v}_${k}]`).join('')}`);
        c._segs.forEach((g, k) => graph.push(`[vs${v}_${k}]trim=start=${num(g.s0)}:end=${num(g.s1)},setpts=(PTS-STARTPTS)/${num(g.v)}[vp${v}_${k}]`));
        graph.push(`${c._segs.map((_, k) => `[vp${v}_${k}]`).join('')}concat=n=${n}:v=1:a=0[vc${v}]`);
        src = `[vc${v}]`;
      } else if (m.type !== 'image' && Math.abs((c.speed || 1) - 1) > 1e-4) {
        chain.push(`setpts=PTS/${num(c.speed)}`);
      }
      chain.push(`fps=${fps}`);
      // Cor: nitidez → LUT 3D (filtro, ajustes, LUT importada) → vinheta. Mesma ordem da prévia,
      // e antes do recorte, como na prévia (que colore o quadro inteiro).
      // Chroma key (fundo verde) igual ao da prévia: distância RGB até a cor-chave.
      if (c._chroma) chain.push('format=rgba', `colorkey=${c._chroma.color}:${num(c._chroma.similarity)}:${num(c._chroma.smooth)}`);
      // Câmera (aberração cromática): vermelho e verde ampliados em relação ao azul, a partir do centro
      // (a mesma conta da prévia). Roda no quadro original, antes da nitidez e da cor.
      const cam = c._cam;
      const W0 = m.width;
      const H0 = m.height;
      // Fecha a corrente atual num rótulo (usado pelas etapas com vários ramos).
      const camCut = (name) => {
        graph.push(`${src}${chain.join(',')}[${name}]`);
        chain.length = 0;
        chain.push('setpts=PTS');
      };
      if (cam && cam.ca > 0.004) {
        const k = cam.ca * 0.004;
        const sz = (f) => `w=${Math.round(W0 * f)}:h=${Math.round(H0 * f)}`;
        chain.push('format=gbrp', 'split=3');
        camCut(`cpa${v}][cpb${v}][cpc${v}`);
        graph.push(`[cpa${v}]extractplanes=g,scale=${sz(1 + k)}:flags=bicubic,crop=${W0}:${H0},setsar=1[cpg${v}]`);
        graph.push(`[cpb${v}]extractplanes=b,setsar=1[cpbb${v}]`);
        graph.push(`[cpc${v}]extractplanes=r,scale=${sz(1 + 2 * k)}:flags=bicubic,crop=${W0}:${H0},setsar=1[cpr${v}]`);
        graph.push(`[cpg${v}][cpbb${v}][cpr${v}]mergeplanes=0x001020:gbrp[cpo${v}]`);
        src = `[cpo${v}]`;
      }
      // Nitidez (+) ou maciez (−): o tamanho do filtro acompanha a largura do vídeo (5 px em 1920).
      if (c._sharp) {
        const ms = Math.max(5, Math.min(23, 2 * Math.floor((5 * W0) / 1920 / 2) + 1));
        chain.push(`unsharp=${ms}:${ms}:${num(c._sharp)}:${ms}:${ms}:0`);
      }
      if (c._lut || c._vig > 0) chain.push('format=rgba');
      if (c._lut) chain.push(`lut3d=file=${c._lut}:interp=trilinear`);
      // Câmera (brilho de lente): cada camada = rampa por canal acima do limiar → média em blocos D×D →
      // gaussiana (a do flare só na horizontal) → ampliação suave → tinge → "tela" sobre a imagem.
      for (const [tag, L] of [['hl', cam?.hal], ['sk', cam?.str]]) {
        if (!L) continue;
        const sigma = L.sigma * W0;
        let D = 4;
        while (sigma / D > 14 && D < 16) D *= 2;
        const sw = Math.max(1, Math.floor(W0 / D));
        const sh = Math.max(1, Math.floor(H0 / D));
        const ramp = (ch) => `${ch}='clip((val/maxval-${num(L.thr)})/(1-${num(L.thr)}),0,1)*maxval'`;
        chain.push('format=gbrp', 'split=2');
        camCut(`${tag}a${v}][${tag}b${v}`);
        graph.push(`[${tag}b${v}]lutrgb=${ramp('r')}:${ramp('g')}:${ramp('b')},scale=${sw}:${sh}:flags=area,gblur=sigma=${num(sigma / D)}:sigmaV=${L.horizontal ? 0 : num(sigma / D)}:steps=3,scale=${W0}:${H0}:flags=bilinear,setsar=1,colorchannelmixer=rr=${num(L.rgb[0] * L.amount)}:gg=${num(L.rgb[1] * L.amount)}:bb=${num(L.rgb[2] * L.amount)}[${tag}c${v}]`);
        graph.push(`[${tag}a${v}][${tag}c${v}]blend=all_mode=screen[${tag}o${v}]`);
        src = `[${tag}o${v}]`;
      }
      if (c._vig > 0) chain.push(`vignette=angle=${num(c._vig)}`);
      if (cam?.grain) chain.push('format=yuva444p', `noise=c0s=${cam.grain}:c0f=t`);
      // Efeitos de imagem (mesma ordem da prévia): glitch RGB → pixelar → inverter → granulado → brilho.
      const fx = c._fx;
      if (fx) {
        // Fecha a corrente atual num rótulo para montar trechos com vários ramos.
        const cut = (name) => {
          graph.push(`${src}${chain.join(',')}[${name}]`);
          chain.length = 0;
          chain.push('setpts=PTS');
          return `[${name}]`;
        };
        // Comandos por quadro (sendcmd) só quando o valor muda.
        const cmdFile = (name, rows, toCmds) => {
          const lines = [];
          let last = null;
          rows.forEach((r, k) => {
            const key = JSON.stringify(r);
            if (key === last) return;
            lines.push(`${num(k / fps)} ${toCmds(r).map((x) => '[enter] ' + x).join(', ')};`);
            last = key;
          });
          return writeTemp(`${name}-${v}.txt`, lines.join('\n') || '0 [enter] all ping 0;');
        };
        // Peça que só vale num trecho do clipe (trilha de efeito): ":enable='between(t,a,b)+…'".
        const when = fx.when || {};
        const en = (k) => (when[k] ? `:enable='${when[k].map(([a, b]) => `between(t\\,${num(a)}\\,${num(b)})`).join('+')}'` : '');
        // Ramo que só aparece num trecho: guarda o original e cobre com o ramo só nesse trecho.
        const keep = (k, name) => {
          if (!when[k]) return null;
          chain.push('format=rgba', 'split');
          cut(`${name}k${v}][${name}i${v}`);
          src = `[${name}i${v}]`;
          chain.length = 0;
          return `[${name}k${v}]`;
        };
        const unkeep = (k, kept, out) => {
          if (!kept) return;
          graph.push(`${kept}${src}overlay=0:0:format=rgb${en(k)}[${out}x${v}]`);
          src = `[${out}x${v}]`;
          chain.length = 0;
          chain.push('setpts=PTS');
        };
        // Tela dividida: n×n cópias menores; espelho: metade esquerda + reflexo.
        if (fx.split) {
          const kept = keep('split', 'sp');
          const k = fx.split;
          const sw = Math.max(2, Math.floor(fx.w / k / 2) * 2);
          const sh = Math.max(2, Math.floor(fx.h / k / 2) * 2);
          chain.push(`scale=${sw}:${sh}`, `split=${k * k}${Array.from({ length: k * k }, (_, i) => `[sp${v}_${i}]`).join('')}`);
          graph.push(`${src}${chain.join(',')}`);
          for (let r = 0; r < k; r++) graph.push(`${Array.from({ length: k }, (_, i) => `[sp${v}_${r * k + i}]`).join('')}hstack=inputs=${k}[spr${v}_${r}]`);
          graph.push(`${Array.from({ length: k }, (_, r) => `[spr${v}_${r}]`).join('')}vstack=inputs=${k},scale=${fx.w}:${fx.h}[spo${v}]`);
          src = `[spo${v}]`;
          chain.length = 0;
          chain.push('setpts=PTS');
          unkeep('split', kept, 'spo');
        }
        if (fx.mirror) {
          const kept = keep('mirror', 'mr');
          const half = Math.max(2, Math.floor(fx.w / 4) * 2);
          chain.push(`crop=${half}:ih:0:0`, 'split');
          cut(`mra${v}][mrb${v}`);
          graph.push(`[mrb${v}]hflip[mrc${v}]`);
          graph.push(`[mra${v}][mrc${v}]hstack,scale=${fx.w}:${fx.h}[mro${v}]`);
          src = `[mro${v}]`;
          chain.length = 0;
          chain.push('setpts=PTS');
          unkeep('mirror', kept, 'mro');
        }
        if (fx.shift) {
          const lim = (x) => Math.max(-255, Math.min(255, x));
          chain.push('format=gbrap', `sendcmd=f=${cmdFile('fxg', fx.shift, (g) => [`fxg${v} rh ${lim(g)}`, `fxg${v} bh ${lim(-g)}`])}`, `rgbashift@fxg${v}=rh=${lim(fx.shift[0])}:bh=${lim(-fx.shift[0])}:edge=smear`);
        }
        if (fx.pixel) chain.push('format=gbrap', `pixelize=w=${fx.pixel}:h=${fx.pixel}:m=avg${en('pixel')}`);
        if (fx.invert) chain.push('format=gbrap', when.invert ? `negate=${en('invert').slice(1)}` : 'negate');
        // Tom (brilho, contraste, saturação, matiz) quadro a quadro, em YUV como na prévia.
        if (fx.tone) {
          const [b0, c0, s0, h0] = fx.tone[0];
          chain.push(
            'format=yuva444p',
            `sendcmd=f=${cmdFile('fxt', fx.tone, ([b, cc, ss, h]) => [`fxh${v} h ${h}`, `fxe${v} brightness ${b}`, `fxe${v} contrast ${cc}`, `fxe${v} saturation ${ss}`])}`,
            `hue@fxh${v}=h=${h0}`,
            `eq@fxe${v}=brightness=${b0}:contrast=${c0}:saturation=${s0}:eval=frame`,
          );
        }
        // Granulado só na luz (Y), como a prévia (o mesmo ruído nos três canais).
        if (fx.grain) chain.push('format=yuva444p', `noise=c0s=${fx.grain}:c0f=t${en('grain')}`);
        if (fx.glow) {
          chain.push('format=gbrap', 'split');
          cut(`gwa${v}][gwb${v}`);
          graph.push(`[gwb${v}]gblur=sigma=${num(fx.glow.sigma)}[gwc${v}]`);
          graph.push(`[gwa${v}][gwc${v}]blend=all_mode=screen:all_opacity=${num(fx.glow.opacity)}${en('glow')}[gw${v}]`);
          src = `[gw${v}]`;
        }
        // Barras de cinema e íris: uma máscara cinza (branco = aparece) multiplicada na
        // transparência do clipe. A íris é um círculo desenhado uma vez e redimensionado a cada
        // quadro; as barras são retângulos pretos com altura por quadro (valores vindos do app).
        if (fx.bars || fx.iris) {
          const W0 = fx.w;
          const H0 = fx.h;
          const nf = (fx.bars || fx.iris).length;
          const len = num(nf / fps);
          let mask;
          if (fx.iris) {
            const half = Math.hypot(W0 / 2, H0 / 2);
            const D = Math.ceil(half * 2 / 2) * 2 + 4;
            const diam = (r) => Math.max(2, Math.round((r * half * 2) / 2) * 2);
            const f = cmdFile('fxi', fx.iris, (r) => [`fxi${v} w ${diam(r)}`, `fxi${v} h ${diam(r)}`]);
            args.push('-f', 'lavfi', '-i', `color=c=black:s=1024x1024:r=${fps}:d=${num(1 / fps)}`);
            const di = inputs++;
            graph.push(`[${di}:v]format=gray,geq=lum='255*lte(hypot(X-511.5\,Y-511.5)\,511.5)',loop=loop=-1:size=1,trim=duration=${len},setpts=N/(${fps}*TB),sendcmd=f=${f},scale@fxi${v}=w=${diam(fx.iris[0])}:h=${diam(fx.iris[0])}:eval=frame,pad=w=${D}:h=${D}:x=(ow-iw)/2:y=(oh-ih)/2:color=black:eval=frame,crop=${W0}:${H0}:(iw-${W0})/2:(ih-${H0})/2[irm${v}]`);
            mask = `[irm${v}]`;
          } else {
            args.push('-f', 'lavfi', '-i', `color=c=white:s=${W0}x${H0}:r=${fps}:d=${len}`);
            const wi = inputs++;
            graph.push(`[${wi}:v]format=gray[wm${v}]`);
            mask = `[wm${v}]`;
          }
          if (fx.bars) {
            const bh = (b) => Math.max(0, Math.round(b * H0));
            // Altura 0 no drawbox quer dizer "altura toda": sem barra, a caixa de 1 px vai para fora do quadro.
            const box = (x) => {
              const h = bh(x);
              return { h: Math.max(1, h), top: h ? 0 : -4, bottom: h ? H0 - h : H0 + 4 };
            };
            const f = cmdFile('fxb', fx.bars, (x) => {
              const k = box(x);
              return [`fxbt${v} h ${k.h}`, `fxbt${v} y ${k.top}`, `fxbb${v} h ${k.h}`, `fxbb${v} y ${k.bottom}`];
            });
            const k0 = box(fx.bars[0]);
            graph.push(`${mask}sendcmd=f=${f},drawbox@fxbt${v}=x=0:y=${k0.top}:w=iw:h=${k0.h}:color=black:t=fill,drawbox@fxbb${v}=x=0:y=${k0.bottom}:w=iw:h=${k0.h}:color=black:t=fill[bm${v}]`);
            mask = `[bm${v}]`;
          }
          chain.push('format=rgba', 'split');
          cut(`ima${v}][imb${v}`);
          graph.push(`[imb${v}]alphaextract[ial${v}]`);
          graph.push(`[ial${v}]${mask}blend=all_mode=multiply[iam${v}]`);
          graph.push(`[ima${v}][iam${v}]alphamerge[imo${v}]`);
          src = `[imo${v}]`;
        }
      }
      // Máscara: imagem cinza (branco = aparece) multiplicada na transparência do clipe.
      if (c._mask) {
        graph.push(`${src}${chain.join(',')}[mk${v}]`);
        chain.length = 0;
        args.push('-loop', '1', '-framerate', String(fps), '-t', num(d), '-i', c._mask);
        const mi = inputs++;
        graph.push(`[${mi}:v]format=gray[mg${v}]`);
        graph.push(`[mg${v}][mk${v}]scale2ref[ms${v}][mc${v}]`);
        graph.push(`[mc${v}]format=rgba,split[mca${v}][mcb${v}]`);
        graph.push(`[mcb${v}]alphaextract[al${v}]`);
        graph.push(`[al${v}][ms${v}]blend=all_mode=multiply[alm${v}]`);
        graph.push(`[mca${v}][alm${v}]alphamerge[mo${v}]`);
        src = `[mo${v}]`;
        chain.push('setpts=PTS');
      }
      if (c.crop) chain.push(`crop=w=iw*${num(crop.w)}:h=ih*${num(crop.h)}:x=iw*${num(crop.x)}:y=ih*${num(crop.y)}:exact=1`);
      // Espelhar: depois do recorte, como na prévia.
      if (c.flipH) chain.push('hflip');
      if (c.flipV) chain.push('vflip');
      if (c._frames) {
        // Clipe animado (keyframes/animação): tamanho, giro, opacidade e posição mudam a cada
        // quadro. Os valores vêm calculados do app e entram como comandos (sendcmd).
        const { D, f } = c._frames;
        const [w0, h0, a0, op0, x0, y0, b0] = f[0];
        const hasBlur = f.some((r) => r[6] > 0.05);
        const local = [];
        const abs = [];
        let prev = [];
        f.forEach((r, k) => {
          const t = k / fps;
          const cmds = [];
          if (r[0] !== prev[0] || r[1] !== prev[1]) cmds.push(`kfs${v} w ${r[0]}`, `kfs${v} h ${r[1]}`);
          if (r[2] !== prev[2]) cmds.push(`kfr${v} a ${r[2]}`);
          if (r[3] !== prev[3]) cmds.push(`kfa${v} aa ${r[3]}`);
          if (hasBlur && r[6] !== prev[6]) cmds.push(`kfb${v} sigma ${r[6]}`);
          if (cmds.length) local.push(`${num(t)} ${cmds.map((x) => '[enter] ' + x).join(', ')};`);
          if (r[4] !== prev[4] || r[5] !== prev[5]) abs.push(`${num(c.start + t)} [enter] kfo${v} x ${r[4]}, [enter] kfo${v} y ${r[5]};`);
          prev = r;
        });
        const lf = writeTemp(`kf-${v}.txt`, local.join('\n') || '0 [enter] all ping 0;');
        const af = writeTemp(`kfo-${v}.txt`, abs.join('\n') || '0 [enter] all ping 0;');
        chain.push('format=rgba', `sendcmd=f=${lf}`, `scale@kfs${v}=w=${w0}:h=${h0}:eval=frame:flags=bicubic`, `pad@kfp${v}=w=${D}:h=${D}:x=(ow-iw)/2:y=(oh-ih)/2:eval=frame:color=0x00000000`, `rotate@kfr${v}=a=${a0}:ow=${D}:oh=${D}:c=none`, `colorchannelmixer@kfa${v}=aa=${op0}`);
        if (hasBlur) chain.push(`gblur@kfb${v}=sigma=${b0}`);
        chain.push(`scale=out_color_matrix=bt709:out_range=tv:${EXACT}`, 'format=yuva420p');
        chain.push(`setpts=PTS+${num(c.start)}/TB`);
        graph.push(`${src}${chain.join(',')}[v${v}]`);
        const target = layerTarget(c);
        graph.push(`${target}sendcmd=f=${af}[bs${v}]`);
        graph.push(`[bs${v}][v${v}]overlay@kfo${v}=x=${x0}:y=${y0}:eval=frame:eof_action=pass:enable='between(t,${num(c.start)},${num(c.start + d)})'[${c._blend ? 'ly' : 'b'}${v}]`);
        finishLayer(c, v);
        v++;
        continue;
      }
      // Clipe sem transparência, giro nem efeitos de cor/máscara: fica em YUV o caminho todo (sem ida e volta por RGB),
      // então o vídeo sai igual ao original (só reduzido, se for o caso).
      const alphaFree = opacity >= 1 && !rad && !(c._chroma || c._lut || c._vig > 0 || c._cam || c._fx || c._mask);
      // Um único scale faz tudo (tamanho + matriz BT.709 de entrada e saída): se a fonte não tem a matriz marcada, um segundo
      // scale a trataria como BT.601 e mudaria as cores.
      if (alphaFree) chain.push(`scale=${w}:${h}:${SCALE}:in_color_matrix=bt709:out_color_matrix=bt709:out_range=tv`, 'format=yuv420p');
      else chain.push(`scale=${w}:${h}:${SCALE}:in_color_matrix=bt709`, 'format=rgba');
      if (opacity < 1) chain.push(`colorchannelmixer=aa=${num(opacity)}`);
      if (rad) chain.push(`rotate=${num(rad)}:ow=rotw(${num(rad)}):oh=roth(${num(rad)}):c=none`);
      // Volta para YUV com a matriz BT.709 explícita (o padrão do FFmpeg seria BT.601 e deslocaria as cores).
      if (!alphaFree) chain.push(`scale=out_color_matrix=bt709:out_range=tv:${EXACT}`, 'format=yuva420p');
      chain.push(`setpts=PTS+${num(c.start)}/TB`);
      graph.push(`${src}${chain.join(',')}[v${v}]`);
      const x = `(main_w-overlay_w)/2+${num((tr.x || 0) * W)}`;
      const y = `(main_h-overlay_h)/2+${num((tr.y || 0) * H)}`;
      graph.push(`${layerTarget(c)}[v${v}]overlay=x=${x}:y=${y}:eof_action=pass:enable='between(t,${num(c.start)},${num(c.start + d)})'[${c._blend ? 'ly' : 'b'}${v}]`);
      finishLayer(c, v);
      v++;
    }
  }
  graph.push(`${base}format=yuv420p[vout]`);

  const audioLabels = [];
  for (const t of tracks) {
    if (t.muted || t.hidden) continue;
    for (const c of clips.filter((x) => x.trackId === t.id)) {
      const m = media[c.mediaId];
      const vol = c.volume ?? 1;
      // audioDetached: o som deste vídeo foi separado para um clipe na trilha de áudio.
      if (!m || !m.hasAudio || vol <= 0 || c.audioDetached) continue;
      // Com efeitos de voz/ruído/normalização, usa o mesmo arquivo processado da prévia.
      const proxy = job.audioProxies && job.audioProxies[c.id];
      let i = proxy ? undefined : clipInput[c.id];
      if (i === undefined) {
        args.push('-ss', num(c.in), '-t', num(c.out - c.in), '-i', proxy || m.path);
        i = inputs++;
      }
      const ms = Math.round(c.start * 1000);
      const dur = c._dur ?? (c.out - c.in) / (c.speed || 1);
      const fx = c.audio || {};
      const keepPitch = c.keepPitch !== false;
      let asrc = `[${i}:a]`;
      const pre = ['asetpts=PTS-STARTPTS', 'aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
      let speedF = [];
      if (c._segs) {
        const n = c._segs.length;
        const L = audioLabels.length;
        graph.push(`${asrc}${pre.join(',')},asplit=${n}${c._segs.map((_, k) => `[as${L}_${k}]`).join('')}`);
        c._segs.forEach((g, k) => graph.push(`[as${L}_${k}]atrim=start=${num(g.s0)}:end=${num(g.s1)},asetpts=PTS-STARTPTS${tempoFilters(g.v, keepPitch).map((x) => ',' + x).join('')}[ap${L}_${k}]`));
        graph.push(`${c._segs.map((_, k) => `[ap${L}_${k}]`).join('')}concat=n=${n}:v=0:a=1[ac${L}]`);
        asrc = `[ac${L}]`;
      } else {
        speedF = tempoFilters(c.speed || 1, keepPitch);
      }
      const fadeIn = Math.min(fx.fadeIn || 0, dur);
      const fadeOut = Math.min(fx.fadeOut || 0, dur - fadeIn);
      const chain = [...(c._segs ? ['asetpts=PTS-STARTPTS'] : [...pre, ...speedF])];
      if (c._vol) {
        // Volume com keyframes: comandos 30 vezes por segundo no filtro de volume.
        const L = audioLabels.length;
        const vf = writeTemp(`kfv-${L}.txt`, c._vol.map(([t, x]) => `${num(t)} [enter] kfv${L} volume ${x};`).join('\n'));
        chain.push(`asendcmd=f=${vf}`, `volume@kfv${L}=volume=${c._vol[0][1]}:eval=frame`);
      } else chain.push(`volume=${num(vol)}`);
      if (fadeIn > 0.01) chain.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
      if (fadeOut > 0.01) chain.push(`afade=t=out:st=${num(dur - fadeOut)}:d=${num(fadeOut)}`);
      if (ms > 0) chain.push(`adelay=${ms}:all=1`);
      graph.push(`${asrc}${chain.join(',')}[a${audioLabels.length}]`);
      audioLabels.push(`[a${audioLabels.length}]`);
    }
  }
  if (audioLabels.length === 0) {
    args.push('-f', 'lavfi', '-t', num(total), '-i', 'anullsrc=r=48000:cl=stereo');
    graph.push(`[${inputs++}:a]anull[aout]`);
  } else if (audioLabels.length === 1) {
    graph.push(`${audioLabels[0]}anull[aout]`);
  } else {
    graph.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0[aout]`);
  }

  const script = path.join(os.tmpdir(), `video-editor-graph-${Date.now()}.txt`);
  fs.writeFileSync(script, graph.join(';\n'));
  const isHevc = codec === 'h265';
  args.push(
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', '[aout]',
    '-c:v', isHevc ? 'libx265' : 'libx264', '-preset', 'medium', '-crf', String(crf),
    ...(isHevc ? ['-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : []),
    '-pix_fmt', 'yuv420p', '-r', String(fps),
    // Cores marcadas como BT.709 (HD/4K): todos os players mostram igual ao editor.
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-c:a', 'aac', '-b:a', '192k',
    '-t', num(total), '-movflags', '+faststart', output,
  );
  return { args, script, total, temps };
}

module.exports = { buildExport };
