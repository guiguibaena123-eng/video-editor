import { useEffect, useState } from 'react';
import { useStore, clipDur, projectDuration, ASPECTS, DEFAULT_TRANSFORM, croppedSize, isCropped, cropOf } from '../store';
import { Icon } from '../icons';
import { SliderField, Toggle, Section, TabStrip } from './Fields.jsx';
import TextInspector from './TextInspector.jsx';
import AudioInspector from './AudioInspector.jsx';
import SpeedInspector from './SpeedInspector.jsx';
import ColorInspector from './ColorInspector.jsx';
import MaskInspector, { BlendSection, ChromaSection } from './MaskInspector.jsx';
import EffectsInspector, { FlipStabilize, EffectClipInspector } from './EffectsInspector.jsx';
import { KfButton, KeyframeHere, useLocalTime } from './KeyframeControls.jsx';
import { AnimTab } from './TextInspector.jsx';
import { transformAt, applyProp } from '../keyframes';
import { deleteSelection, duplicateSelection, openCrop } from '../ops';
import { fmtTimecode, fmtDuration } from '../util';

// Aplica uma mudança no clipe respeitando o histórico: arrastar slider = 1 passo de desfazer.
function useClipUpdater(clipId) {
  return (mutate) => (value, phase) => {
    const s = useStore.getState();
    const apply = (p) => {
      const c = p.clips.find((x) => x.id === clipId);
      if (c) mutate(c, value);
    };
    if (phase === 'start') s.gestureStart();
    else if (phase === 'live') s.live(apply);
    else if (phase === 'end') s.gestureEnd();
    else s.commit(apply);
  };
}

export default function Inspector() {
  // Gancho dos testes automáticos: simula uma falha ao desenhar (nunca é ligado no uso normal).
  if (useStore((s) => s.__crash)) throw new Error('falha simulada pelo teste');
  const selection = useStore((s) => s.selection);
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : null));

  return (
    <aside className="panel inspector">
      {selection.length > 1 ? (
        <MultiSelection count={selection.length} />
      ) : clip?.kind === 'effect' ? (
        <EffectClipInspector clip={clip} key={clip.id} />
      ) : clip?.kind === 'text' ? (
        <TextInspector clip={clip} key={clip.id} />
      ) : clip ? (
        <ClipInspector clip={clip} key={clip.id} />
      ) : (
        <ProjectInspector />
      )}
    </aside>
  );
}

function MultiSelection({ count }) {
  return (
    <>
      <div className="panel-head">
        <h2>{count} clipes selecionados</h2>
      </div>
      <div className="panel-scroll pad">
        <p className="muted">Arraste qualquer um deles na linha do tempo para mover todos juntos.</p>
        <div className="button-row">
          <button className="secondary" onClick={duplicateSelection}>
            <Icon name="duplicate" size={16} /> Duplicar
          </button>
          <button className="danger" onClick={deleteSelection}>
            <Icon name="trash" size={16} /> Excluir
          </button>
        </div>
      </div>
    </>
  );
}

const TYPE_LABEL = { video: 'Vídeo', audio: 'Áudio', image: 'Imagem' };

function ClipInspector({ clip }) {
  const media = useStore((s) => s.media.find((m) => m.id === clip.mediaId));
  const thumb = useStore((s) => s.cache[clip.mediaId]?.thumbs?.frames?.[0]);
  const settings = useStore((s) => s.project.settings);
  const track = useStore((s) => s.project.tracks.find((t) => t.id === clip.trackId));
  // Um vídeo colocado na trilha de áudio (áudio separado) só tem som.
  const visual = media?.type !== 'audio' && track?.kind !== 'audio';
  const tabs = [visual && ['video', 'Vídeo'], visual && ['anim', 'Animação'], visual && ['color', 'Cor'], visual && ['mask', 'Máscara'], visual && ['fx', 'Efeitos'], media?.hasAudio && ['audio', 'Áudio'], media && media.type !== 'image' && ['speed', 'Velocidade'], ['info', 'Info']].filter(Boolean);
  const [tab, setTab] = useState(tabs[0][0]);
  useEffect(() => {
    if (!tabs.some(([id]) => id === tab)) setTab(tabs[0][0]);
  }, [clip.id]);
  if (!media) return null;

  return (
    <>
      <div className="clip-head">
        <div className="clip-head-thumb">{thumb ? <img src={thumb} alt="" /> : <Icon name={media.type === 'audio' ? 'music' : 'film'} size={20} />}</div>
        <div className="clip-head-text">
          <strong title={media.name}>{media.name}</strong>
          <span className="muted">
            {TYPE_LABEL[media.type]} · {fmtDuration(clipDur(clip))}
            {track?.locked && ' · trilha bloqueada'}
          </span>
        </div>
      </div>
      <TabStrip tabs={tabs} value={tab} onChange={setTab} />
      <div className={'panel-scroll' + (track?.locked ? ' disabled' : '')} key={tab}>
        {tab === 'video' && <VideoTab clip={clip} media={media} settings={settings} />}
        {tab === 'video' && <FlipStabilize clip={clip} media={media} />}
        {tab === 'video' && <BlendSection clip={clip} />}
        {tab === 'video' && <ChromaSection clip={clip} />}
        {tab === 'video' && <KeyframeHere clip={clip} />}
        {tab === 'mask' && <MaskInspector clip={clip} />}
        {tab === 'fx' && <EffectsInspector clip={clip} />}
        {tab === 'anim' && <AnimTab clip={clip} noTypewriter />}
        {tab === 'color' && <ColorInspector clip={clip} media={media} />}
        {tab === 'audio' && <AudioInspector clip={clip} media={media} />}
        {tab === 'speed' && <SpeedInspector clip={clip} media={media} />}
        {tab === 'info' && <InfoTab clip={clip} media={media} fps={settings.fps} />}
      </div>
    </>
  );
}

function VideoTab({ clip, media, settings }) {
  const update = useClipUpdater(clip.id);
  const { local, tol } = useLocalTime(clip);
  // Valores do instante atual (com keyframes); mudar grava keyframe se a propriedade já tiver.
  const tr = transformAt(clip, local);
  const setT = (key) => update((c, v) => applyProp(c, key, v, local, tol));
  const W = settings.width;
  const H = settings.height;

  const thumb = useStore((s) => s.cache[clip.mediaId]?.thumbs?.frames?.[0]);
  const { width: mw, height: mh } = croppedSize(media, clip);
  const cropped = isCropped(clip);
  const crop = cropOf(clip);

  // "Preencher" cobre o quadro inteiro, cortando as sobras (como "cover").
  const fitMode = (mode) => {
    const contain = Math.min(W / mw, H / mh);
    const cover = Math.max(W / mw, H / mh);
    const scale = mode === 'fill' ? cover / contain : 1;
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      c.transform = { ...DEFAULT_TRANSFORM, ...c.transform, scale, x: 0, y: 0, rotation: 0 };
    });
  };

  const reset = () =>
    useStore.getState().commit((p) => {
      p.clips.find((x) => x.id === clip.id).transform = { ...DEFAULT_TRANSFORM };
    });

  const clearCrop = () =>
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      delete c.crop;
      delete c.cropRatio;
    });

  return (
    <>
      <Section
        title="Recorte"
        action={
          cropped && (
            <button className="link-btn" onClick={clearCrop} title="Remover recorte">
              <Icon name="reset" size={14} /> Restaurar
            </button>
          )
        }
      >
        <div className="crop-summary">
          <span className="crop-mini" style={{ aspectRatio: `${media.width} / ${media.height}`, backgroundImage: thumb ? `url(${thumb})` : undefined }}>
            <span style={{ left: `${crop.x * 100}%`, top: `${crop.y * 100}%`, width: `${crop.w * 100}%`, height: `${crop.h * 100}%` }} />
          </span>
          <span className="muted">{cropped ? `${Math.round(mw)} × ${Math.round(mh)} px${clip.cropRatio && clip.cropRatio !== 'free' ? ` · ${clip.cropRatio === 'original' ? 'original' : clip.cropRatio}` : ''}` : 'Sem recorte'}</span>
          <button className="secondary small" onClick={openCrop}>
            <Icon name="crop" size={15} /> Recortar
          </button>
        </div>
      </Section>
      <Section
        title="Transformação"
        action={
          <button className="link-btn" onClick={reset} title="Restaurar transformação">
            <Icon name="reset" size={14} /> Restaurar
          </button>
        }
      >
        <SliderField label="Escala" adornment={<KfButton clip={clip} prop="scale" />} value={tr.scale} min={0.05} max={5} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={setT('scale')} />
        <SliderField label="Posição X" adornment={<KfButton clip={clip} prop="x" />} value={tr.x} min={-1} max={1} step={1} unit="px" toDisplay={(v) => v * W} fromDisplay={(v) => v / W} defaultValue={0} onChange={setT('x')} />
        <SliderField label="Posição Y" adornment={<KfButton clip={clip} prop="y" />} value={tr.y} min={-1} max={1} step={1} unit="px" toDisplay={(v) => v * H} fromDisplay={(v) => v / H} defaultValue={0} onChange={setT('y')} />
        <SliderField label="Rotação" adornment={<KfButton clip={clip} prop="rotation" />} value={tr.rotation} min={-180} max={180} step={1} unit="°" defaultValue={0} onChange={setT('rotation')} />
        <div className="button-row">
          <button className="secondary small" onClick={() => fitMode('fit')}>
            Ajustar à tela
          </button>
          <button className="secondary small" onClick={() => fitMode('fill')}>
            Preencher a tela
          </button>
        </div>
      </Section>
      <Section title="Opacidade">
        <SliderField label="Opacidade" adornment={<KfButton clip={clip} prop="opacity" />} value={tr.opacity} min={0} max={1} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={setT('opacity')} />
      </Section>
    </>
  );
}

function InfoTab({ clip, media, fps }) {
  const rows = [
    ['Início na linha do tempo', fmtTimecode(clip.start, fps)],
    ['Duração', fmtTimecode(clipDur(clip), fps)],
    media.type !== 'image' && ['Trecho do original', `${fmtTimecode(clip.in, fps)} – ${fmtTimecode(clip.out, fps)}`],
    media.width && ['Resolução', `${media.width}×${media.height}`],
    media.fps && ['Taxa de quadros', `${media.fps} fps`],
    ['Arquivo', media.path],
  ].filter(Boolean);
  return (
    <Section title="Informações">
      <dl className="info-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd title={v}>{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

const MAIN_ASPECTS = ['16:9', '9:16', '1:1', '4:5', '4:3', '2.39:1'];
const BG_PRESETS = ['#000000', '#ffffff', '#1f2937', '#ffc72c', '#2563eb', '#16a34a', '#dc2626', '#9333ea'];

function ProjectInspector() {
  const settings = useStore((s) => s.project.settings);
  const total = useStore((s) => projectDuration(s.project));
  const clipCount = useStore((s) => s.project.clips.length);
  const [moreAspects, setMoreAspects] = useState(false);
  const set = (patch) => useStore.getState().commit((p) => Object.assign(p.settings, patch));

  return (
    <>
      <div className="panel-head">
        <h2>Projeto</h2>
      </div>
      <div className="panel-scroll">
        <Section title="Proporção">
          <div className="aspect-grid">
            {Object.entries(ASPECTS).filter(([key]) => moreAspects || MAIN_ASPECTS.includes(key) || key === settings.aspect).map(([key, [w, h]]) => {
              const k = 22 / Math.max(w, h);
              return (
                <button key={key} className={'aspect' + (settings.aspect === key ? ' on' : '')} onClick={() => set({ aspect: key, width: w, height: h })} aria-pressed={settings.aspect === key}>
                  <span className="aspect-shape" style={{ width: w * k, height: h * k }} />
                  {key}
                </button>
              );
            })}
          </div>
          <button className="link-btn" onClick={() => setMoreAspects((v) => !v)}>
            {moreAspects ? 'Menos formatos' : 'Mais formatos (cinema, 3:4, 3:2…)'}
          </button>
        </Section>
        <Section title="Taxa de quadros">
          <div className="seg">
            {[24, 25, 30, 50, 60].map((f) => (
              <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => set({ fps: f })} aria-pressed={settings.fps === f}>
                {f}
              </button>
            ))}
          </div>
        </Section>
        <Section title="Cor de fundo">
          <div className="swatches">
            {BG_PRESETS.map((c) => (
              <button key={c} className={'swatch' + (settings.background === c ? ' on' : '')} style={{ background: c }} onClick={() => set({ background: c })} aria-label={`Fundo ${c}`} />
            ))}
            <label className="swatch custom" title="Outra cor">
              <input type="color" value={settings.background} onChange={(e) => set({ background: e.target.value })} />
              <Icon name="plus" size={14} />
            </label>
          </div>
        </Section>
        <Section title="Linha do tempo">
          <Toggle label="Ímã da trilha principal" hint="Mantém os clipes da trilha principal colados, sem espaços." checked={settings.magnet} onChange={(v) => set({ magnet: v })} />
          <Toggle label="Encaixe automático" hint="Alinha clipes às bordas e ao cursor ao arrastar." checked={settings.snap} onChange={(v) => set({ snap: v })} />
        </Section>
        <Section title="Resumo">
          <dl className="info-list">
            <div>
              <dt>Resolução</dt>
              <dd>
                {settings.width}×{settings.height}
              </dd>
            </div>
            <div>
              <dt>Duração</dt>
              <dd>{fmtTimecode(total, settings.fps)}</dd>
            </div>
            <div>
              <dt>Clipes</dt>
              <dd>{clipCount}</dd>
            </div>
          </dl>
        </Section>
      </div>
    </>
  );
}
