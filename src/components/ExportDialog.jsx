import { useEffect, useRef, useState } from 'react';
import { hasImageFx, exportFx, withTrackFx } from '../effects';
import { useStore, projectDuration, clipDur } from '../store';
import { curveSegments } from '../speed';
import { isAnimated } from '../keyframes';
import { visualFrames, volumeSamples } from '../exportAnim';
import { hasColor, hasSpatial, parseCube, toCube } from '../color';
import { lutFor, spatialOf } from '../colorRuntime';
import { hasMask, maskPng, BLEND_NEUTRAL } from '../masks';
import { effectiveAudio } from '../transitions';
import { engine } from '../engine';
import { Icon } from '../icons';
import { cleanError } from '../ops';
import { renderTextAssets, textFrameCount } from '../exportText';
import { needsProxy, proxyPath } from '../audio';
import { duckGainAt, duckActive } from '../audioPro';
import { fmtDuration } from '../util';

const RESOLUTIONS = [
  [480, '480p'],
  [720, '720p'],
  [1080, '1080p'],
  [1440, '2K'],
  [2160, '4K'],
];
const QUALITY = [
  [26, 'Menor arquivo'],
  [21, 'Recomendada'],
  [17, 'Alta'],
  [14, 'Máxima'],
];
const FPS = [24, 25, 30, 50, 60];
const PREFS_KEY = 've.exportPrefs';

function loadPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function outputSize(settings, shortSide) {
  const even = (n) => Math.round(n / 2) * 2;
  const { width, height } = settings;
  return width >= height ? { width: even((shortSide * width) / height), height: shortSide } : { width: shortSide, height: even((shortSide * height) / width) };
}

export default function ExportDialog() {
  const project = useStore((s) => s.project);
  const media = useStore((s) => s.media);
  const prefs = useRef(loadPrefs()).current;
  const [name, setName] = useState(project.name);
  const [res, setRes] = useState(prefs.res || 1080);
  const [fps, setFps] = useState(prefs.fps || project.settings.fps);
  const [crf, setCrf] = useState(prefs.crf || 21);
  const [codec, setCodec] = useState(prefs.codec || 'h264');
  const [format, setFormat] = useState(prefs.format || 'mp4');
  const [phase, setPhase] = useState('setup'); // setup | running | done | error
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [outPath, setOutPath] = useState('');
  const startedAt = useRef(0);
  const canceled = useRef(false);
  const [prepLabel, setPrepLabel] = useState('Preparando…');
  const [now, setNow] = useState(Date.now());

  const size = outputSize(project.settings, res);
  const total = projectDuration(project);
  const busy = phase === 'running' || phase === 'preparing';
  const close = () => !busy && useStore.setState({ exportOpen: false });

  useEffect(() => {
    engine.pause();
    const off = window.api.onExportProgress((v) => setProgress(v));
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => {
      off();
      window.removeEventListener('keydown', onKey);
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== 'running') return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [phase]);

  const start = async () => {
    const mediaMap = new Map(media.map((m) => [m.id, m]));
    const used = new Map();
    for (const c of project.clips) {
      const m = media.find((x) => x.id === c.mediaId);
      if (m) used.set(m.id, m);
    }
    const missing = [...used.values()].filter((m) => m.missing);
    if (missing.length) {
      setError(`Arquivos ausentes: ${missing.map((m) => m.name).join(', ')}. Remova esses clipes ou restaure os arquivos.`);
      setPhase('error');
      return;
    }
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ res, fps, crf, codec, format }));
    } catch {}
    // Duração, trechos de velocidade e animação quadro a quadro, com a mesma conta da prévia.
    const videoTrack = new Set(project.tracks.filter((t) => t.kind === 'video').map((t) => t.id));
    const colorExtra = new Map(); // clipe -> { _lut, _vig, _sharp } (preenchido ao preparar as cores)
    const withTiming = (c) => {
      const m = used.get(c.mediaId);
      const visual = m && m.type !== 'audio' && !c.kind && videoTrack.has(c.trackId);
      return {
        ...c,
        _dur: clipDur(c),
        _segs: c.curve ? curveSegments(c) : undefined,
        _frames: visual && isAnimated(c, project) ? visualFrames(c, m, { ...size, fps, settings: project.settings, project }) : undefined,
        // Durante transições o som de um clipe diminui enquanto o do outro aumenta.
        audio: effectiveAudio(project, c),
        _chroma: visual && c.chroma?.on ? { color: '0x' + (c.chroma.color || '#00ff00').slice(1), similarity: c.chroma.similarity ?? 0.3, smooth: c.chroma.smooth ?? 0.1 } : undefined,
        _blend: visual && c.blend && c.blend !== 'normal' ? c.blend : undefined,
        _blendNeutral: visual && c.blend ? BLEND_NEUTRAL[c.blend] : undefined,
        _vol: volumeSamples(c, 30, duckActive(c) ? (local) => duckGainAt(project, useStore.getState().cache, mediaMap, c, local) : undefined),
        // Efeitos de imagem com os mesmos valores da prévia (glitch quadro a quadro).
        _fx: visual && hasImageFx(withTrackFx(project, c)) ? exportFx(withTrackFx(project, c), m, fps, clipDur(c)) : undefined,
        ...colorExtra.get(c.id),
      };
    };
    const safeName = (name.trim() || 'video').replace(/[<>:"/\\|?*]+/g, '-');
    const output = await window.api.chooseExportPath(safeName, format);
    if (!output) return;
    setOutPath(output);
    setProgress(0);
    startedAt.current = Date.now();
    canceled.current = false;

    // Textos visíveis viram imagens antes de chamar o FFmpeg.
    const visible = new Set(project.tracks.filter((t) => !t.hidden).map((t) => t.id));
    const texts = project.clips.filter((c) => c.kind === 'text' && visible.has(c.trackId));
    let assetDir = null;
    let textAssets = null;
    try {
      // Áudios com efeito (voz, ruído, normalização) usam o mesmo arquivo processado da prévia.
      const audioProxies = {};
      const audible = new Set(project.tracks.filter((t) => !t.hidden && !t.muted).map((t) => t.id));
      const fxClips = project.clips.filter((c) => audible.has(c.trackId) && !c.audioDetached && needsProxy(c.audio) && used.get(c.mediaId)?.hasAudio);
      if (fxClips.length) {
        setPhase('preparing');
        setPrepLabel('Processando o áudio…');
        let n = 0;
        for (const c of fxClips) {
          if (canceled.current) throw new Error('canceled');
          audioProxies[c.id] = await proxyPath(used.get(c.mediaId), c.audio);
          setProgress(++n / fxClips.length);
        }
      }
      // Máscaras: imagem cinza com o mesmo desenho da prévia, no tamanho do quadro.
      const masked = project.clips.filter((c) => hasMask(c) && visible.has(c.trackId) && used.get(c.mediaId) && used.get(c.mediaId).type !== 'audio');
      if (masked.length) {
        setPrepLabel('Preparando as máscaras…');
        setPhase('preparing');
        assetDir = assetDir || (await window.api.exportAssetDir());
        const folder = assetDir.split(/[\\/]/).pop();
        for (const c of masked) {
          const m = used.get(c.mediaId);
          const k = Math.min(1, 1920 / Math.max(m.width, m.height));
          await window.api.writeExportAsset(assetDir, `${c.id}-mask.png`, await maskPng(c.mask, Math.max(2, Math.round(m.width * k)), Math.max(2, Math.round(m.height * k))));
          colorExtra.set(c.id, { ...colorExtra.get(c.id), _mask: `${folder}/${c.id}-mask.png` });
        }
      }
      // Cor: cada clipe colorido ganha um arquivo .cube com a mesma LUT da prévia.
      const colored = project.clips.filter((c) => c.color && visible.has(c.trackId) && used.get(c.mediaId) && (hasColor(c.color) || hasSpatial(c.color)));
      if (colored.length) {
        setPrepLabel('Preparando as cores…');
        setPhase('preparing');
        assetDir = assetDir || (await window.api.exportAssetDir());
        const folder = assetDir.split(/[\\/]/).pop();
        for (const c of colored) {
          // LUT importada precisa estar carregada antes de montar a tabela final.
          if (c.color.lut && !useStore.getState().lutFiles[c.color.lut.path]?.data) {
            const data = parseCube(await window.api.readLut(c.color.lut.path));
            useStore.setState((s) => ({ lutFiles: { ...s.lutFiles, [c.color.lut.path]: { data } } }));
          }
          const lut = lutFor(c.color, true);
          const extra = { ...spatialOf(c.color) };
          if (lut) {
            await window.api.writeExportAsset(assetDir, `${c.id}.cube`, new TextEncoder().encode(toCube(lut.data, lut.size)));
            extra._lut = `${folder}/${c.id}.cube`;
          }
          colorExtra.set(c.id, { ...colorExtra.get(c.id), _lut: extra._lut, _vig: extra.vignette, _sharp: extra.sharpen, _cam: extra.optics || extra.grain ? { ...(extra.optics || {}), grain: extra.grain } : undefined });
        }
      }
      if (texts.length) {
        setPrepLabel('Preparando os textos…');
        setPhase('preparing');
        assetDir = assetDir || (await window.api.exportAssetDir());
        const totalFrames = textFrameCount(texts, fps);
        let done = 0;
        textAssets = await renderTextAssets(texts, {
          ...size,
          fps,
          settings: project.settings,
          dir: assetDir,
          isCanceled: () => canceled.current,
          onFrame: () => setProgress(++done / totalFrames),
        });
        setProgress(0);
      }
      setPhase('running');
      const job = {
        // Duração e trechos de velocidade calculados aqui, com a mesma conta da prévia.
        project: { settings: project.settings, tracks: project.tracks, clips: project.clips.map((c) => withTiming(c)) },
        media: Object.fromEntries([...used.values()].map((m) => [m.id, { path: m.path, type: m.type, width: m.width, height: m.height, hasAudio: m.hasAudio }])),
        output: { ...size, fps, crf, codec, output },
        assetDir,
        textAssets,
        audioProxies,
      };
      const r = await window.api.startExport(job);
      if (r.ok) {
        setProgress(1);
        setPhase('done');
      } else setPhase('setup');
    } catch (err) {
      if (canceled.current) setPhase('setup');
      else {
        setError(cleanError(err));
        setPhase('error');
      }
    } finally {
      if (assetDir) window.api.cleanExportAssets(assetDir);
    }
  };

  const elapsed = (now - startedAt.current) / 1000;
  const remaining = progress > 0.03 ? (elapsed / progress) * (1 - progress) : null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal export-modal" role="dialog" aria-label="Exportar">
        <div className="modal-head">
          <h2>Exportar vídeo</h2>
          {!busy && (
            <button className="icon-btn" onClick={close} aria-label="Fechar">
              <Icon name="close" />
            </button>
          )}
        </div>

        {phase === 'setup' && (
          <>
            <div className="export-body">
              <label className="field">
                <span className="field-label">Nome</span>
                <input className="text-input" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <Choice label="Resolução" value={res} onChange={setRes} options={RESOLUTIONS} />
              <Choice label="Taxa de quadros" value={fps} onChange={setFps} options={FPS.map((f) => [f, `${f} fps`])} />
              <Choice label="Qualidade" value={crf} onChange={setCrf} options={QUALITY} />
              <Choice
                label="Codec"
                value={codec}
                onChange={setCodec}
                options={[
                  ['h264', 'H.264'],
                  ['h265', 'HEVC (H.265)'],
                ]}
              />
              <Choice
                label="Formato"
                value={format}
                onChange={setFormat}
                options={[
                  ['mp4', 'MP4'],
                  ['mov', 'MOV'],
                ]}
              />
              <p className="hint">
                {size.width}×{size.height} · {fmtDuration(total)} · {codec === 'h265' ? 'HEVC gera arquivos menores, mas alguns aparelhos antigos não reproduzem.' : 'H.264 reproduz em praticamente qualquer aparelho.'}
              </p>
            </div>
            <div className="modal-foot">
              <button className="secondary" onClick={close}>
                Cancelar
              </button>
              <button className="primary" onClick={start}>
                <Icon name="export" size={16} /> Exportar
              </button>
            </div>
          </>
        )}

        {phase === 'preparing' && (
          <div className="export-progress">
            <div className="big-pct">{Math.round(progress * 100)}%</div>
            <div className="progress">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="muted">{prepLabel}</p>
            <button className="secondary" onClick={() => (canceled.current = true)}>
              Cancelar exportação
            </button>
          </div>
        )}

        {phase === 'running' && (
          <div className="export-progress">
            <div className="big-pct">{Math.round(progress * 100)}%</div>
            <div className="progress">
              <div style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="muted">
              {fmtDuration(elapsed)} decorrido{remaining !== null && ` · cerca de ${fmtDuration(remaining)} restante`}
            </p>
            <button className="secondary" onClick={() => window.api.cancelExport()}>
              Cancelar exportação
            </button>
          </div>
        )}

        {phase === 'done' && (
          <div className="export-progress">
            <div className="done-icon">
              <Icon name="check" size={30} strokeWidth={2.6} />
            </div>
            <strong>Vídeo exportado</strong>
            <p className="muted path">{outPath}</p>
            <div className="button-row center">
              <button className="secondary" onClick={() => window.api.showItem(outPath)}>
                <Icon name="folder" size={16} /> Mostrar na pasta
              </button>
              <button className="primary" onClick={close}>
                Concluir
              </button>
            </div>
          </div>
        )}

        {phase === 'error' && (
          <div className="export-progress">
            <div className="error-icon">
              <Icon name="warning" size={28} />
            </div>
            <strong>A exportação falhou</strong>
            <pre className="error-text">{error}</pre>
            <div className="button-row center">
              <button className="secondary" onClick={() => setPhase('setup')}>
                Voltar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Choice({ label, value, onChange, options }) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="seg">
        {options.map(([v, text]) => (
          <button key={v} className={value === v ? 'on' : ''} onClick={() => onChange(v)} aria-pressed={value === v}>
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}
