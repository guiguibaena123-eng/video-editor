import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore, projectDuration, clipDur, ASPECTS, DEFAULT_TRANSFORM } from '../store';
import { engine } from '../engine';
import { transformAt, valueAt, applyProp, hasKeyframes, findKey, setKeyframe, removeKeyframe, keyframeTimes, KF_PROPS, EASES } from '../keyframes';
import { addMediaToTimeline, deleteSelection, duplicateSelection, goHome, seek, setClipSpeed, setProjectFormat, splitAtPlayhead } from '../ops';
import { Icon } from '../icons';
import { clamp, fmtDuration } from '../util';
import MTimeline from './Timeline';
import StageGestures from './StageGestures';
import { AddSheet, AnimSheet, TextEditSheet } from './TextSheets';
import { AudioSheet, RecordSheet } from './AudioSheets';
import Diag from './Diag';
import FullControls, { enterFull, exitFull } from './FullControls';
import { Sheet, Slider, Tool, askText, haptic } from './ui';
import { pickFiles, importFiles } from './files';

const MAX_CANVAS_W = 720; // pixels reais do player no celular: o suficiente para uma tela pequena e bem mais leve

export default function MEditor() {
  const [sheet, setSheet] = useState(null);
  const [diag, setDiag] = useState(false);
  const clip = useStore((s) => (s.selection.length === 1 ? s.project.clips.find((c) => c.id === s.selection[0]) : null));
  const clipMedia = useStore((s) => (clip ? s.media.find((m) => m.id === clip.mediaId) : null));
  const closeSheet = () => setSheet(null);

  // Fecha o painel quando o clipe deixa de existir ou de estar selecionado.
  useEffect(() => {
    if (!clip && sheet && sheet !== 'format' && sheet !== 'add' && sheet !== 'record') setSheet(null);
  }, [clip, sheet]);

  const add = async () => {
    const files = await pickFiles();
    if (!files.length) return;
    const added = await importFiles(files);
    for (const m of added) addMediaToTimeline(m, {});
    if (added.length) haptic(10);
  };

  return (
    <div className="medit">
      <TopBar />
      <Stage />
      <Transport onSecret={() => setDiag((d) => !d)} />
      {diag && <Diag onClose={() => setDiag(false)} />}
      <MTimeline onAdd={add} />
      <Toolbar clip={clip} media={clipMedia} onAdd={add} open={setSheet} />

      <Sheet open={sheet === 'add'} onClose={closeSheet} title="Adicionar">
        <AddSheet onClose={closeSheet} />
      </Sheet>
      <Sheet open={sheet === 'text' && !!clip && clip.kind === 'text'} onClose={closeSheet} title={clip?.sticker ? 'Adesivo' : 'Texto'} peek>
        {clip && clip.kind === 'text' && <TextEditSheet clip={clip} />}
      </Sheet>
      <Sheet open={sheet === 'anim' && !!clip && clip.kind === 'text'} onClose={closeSheet} title="Animação" peek>
        {clip && clip.kind === 'text' && <AnimSheet clip={clip} />}
      </Sheet>
      <Sheet open={sheet === 'audio' && !!clip} onClose={closeSheet} title="Som do clipe" peek>
        {clip && <AudioSheet clip={clip} media={clipMedia} />}
      </Sheet>
      <Sheet open={sheet === 'record'} onClose={closeSheet} title="Gravar narração" peek>
        {sheet === 'record' && <RecordSheet onClose={closeSheet} />}
      </Sheet>
      <Sheet open={sheet === 'format'} onClose={closeSheet} title="Formato do projeto">
        <FormatSheet />
      </Sheet>
      <Sheet open={sheet === 'speed' && !!clip} onClose={closeSheet} title="Velocidade" peek>
        {clip && <SpeedSheet clip={clip} media={clipMedia} />}
      </Sheet>
      <Sheet open={sheet === 'volume' && !!clip} onClose={closeSheet} title="Volume" peek>
        {clip && <VolumeSheet clip={clip} />}
      </Sheet>
      <Sheet open={sheet === 'transform' && !!clip} onClose={closeSheet} title="Posição e tamanho" peek>
        {clip && <TransformSheet clip={clip} />}
      </Sheet>
    </div>
  );
}

// ---------- barra de cima ----------
function TopBar() {
  const name = useStore((s) => s.project.name);
  const saving = useStore((s) => s.saving);
  const dirty = useStore((s) => s.dirty);
  const rename = async () => {
    const n = await askText({ title: 'Nome do projeto', value: name, confirm: 'Salvar' });
    if (n) useStore.getState().commit((p) => void (p.name = n.slice(0, 80)));
  };
  return (
    <header className="mtop">
      <button className="m-icon" onClick={() => goHome()} aria-label="Voltar para os projetos">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <button className="mtop-name" onClick={rename}>
        <b>{name}</b>
        <small>{saving ? 'Salvando…' : dirty ? 'Alterações pendentes' : 'Salvo no aparelho'}</small>
      </button>
      <button className="m-pill" onClick={() => useStore.getState().notify('A exportação do celular está sendo construída (próxima etapa).')}>
        <Icon name="export" size={16} strokeWidth={2.2} /> Exportar
      </button>
    </header>
  );
}

// ---------- player ----------
function Stage() {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const settings = useStore((s) => s.project.settings);
  const quality = useStore((s) => s.previewQuality);
  const autoScale = useStore((s) => s.autoScale);
  const empty = useStore((s) => s.project.clips.length === 0);
  const theater = useStore((s) => s.theater);
  const aspect = settings.width / settings.height;

  // Sair da tela cheia pelo sistema (gesto ou "voltar" do aparelho) também fecha o nosso modo.
  useEffect(() => {
    const onFs = () => !document.fullscreenElement && exitFull();
    const onPop = () => {
      // "Voltar" na tela cheia só sai dela. Este aviso chega antes do tratador do app (filhos montam primeiro).
      if (!useStore.getState().theater) return;
      window.__skipPop = true;
      exitFull(true);
    };
    document.addEventListener('fullscreenchange', onFs);
    window.addEventListener('popstate', onPop);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      window.removeEventListener('popstate', onPop);
      exitFull(true);
    };
  }, []);

  useEffect(() => {
    engine.attach(canvasRef.current);
    return () => {
      engine.pause();
      engine.detach();
    };
  }, []);

  useLayoutEffect(() => {
    const el = stageRef.current;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const aw = Math.max(10, r.width - (theater ? 0 : 16));
      const ah = Math.max(10, r.height - (theater ? 0 : 8));
      const w = Math.min(aw, ah * aspect);
      setSize({ w: Math.round(w), h: Math.round(w / aspect) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [aspect, theater]);

  useEffect(() => {
    const c = canvasRef.current;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cap = quality === 'high' ? Infinity : quality === 'low' ? 640 : quality === 'medium' ? 960 : theater ? 1280 : MAX_CANVAS_W;
    let k = Math.min(dpr, cap / Math.max(1, size.w));
    if (quality === 'auto') k *= autoScale;
    c.width = Math.max(2, Math.round(size.w * k));
    c.height = Math.max(2, Math.round(size.h * k));
    engine.requestDraw();
  }, [size, quality, autoScale, theater]);

  return (
    <section className={'mstage' + (theater ? ' full' : '')} ref={stageRef}>
      <div className="canvas-wrap" style={{ width: size.w, height: size.h }}>
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
        {!empty && !theater && <StageGestures w={size.w} h={size.h} />}
        {!empty && !theater && (
          <button className="mfs-btn" onPointerDown={(e) => e.stopPropagation()} onClick={() => enterFull(stageRef.current, aspect)} aria-label="Tela cheia">
            <Icon name="fullscreen" size={18} strokeWidth={2.2} />
          </button>
        )}
      </div>
      {theater && <FullControls />}
    </section>
  );
}

function Time({ onSecret }) {
  const taps = useRef([]);
  const cur = useRef(null);
  const tot = useRef(null);
  const fmt = (v) => {
    const m = Math.floor(v / 60);
    const sec = v - m * 60;
    return `${m}:${sec.toFixed(1).padStart(4, '0')}`;
  };
  // Atualiza o texto direto no elemento (só quando o décimo de segundo muda): sem redesenhar o React a cada quadro.
  useEffect(() => {
    let last = '';
    let lastTotal = '';
    const apply = () => {
      const s = useStore.getState();
      const a = fmt(s.currentTime);
      const b = fmt(projectDuration(s.project));
      if (a !== last && cur.current) cur.current.textContent = last = a;
      if (b !== lastTotal && tot.current) tot.current.textContent = lastTotal = ' / ' + b;
    };
    apply();
    return useStore.subscribe(apply);
  }, []);
  return (
    <div
      className="mtime"
      onClick={() => {
        // 5 toques seguidos abrem o diagnóstico do player.
        const n = performance.now();
        taps.current = [...taps.current.filter((x) => n - x < 1800), n];
        if (taps.current.length >= 5) {
          taps.current = [];
          onSecret?.();
        }
      }}
    >
      <b ref={cur} />
      <span ref={tot} />
    </div>
  );
}

function Transport({ onSecret }) {
  const playing = useStore((s) => s.playing);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const empty = useStore((s) => s.project.clips.length === 0);
  return (
    <div className="mtransport">
      <Time onSecret={onSecret} />
      <button className="m-play" onClick={() => engine.toggle()} disabled={empty} aria-label={playing ? 'Pausar' : 'Reproduzir'}>
        <Icon name={playing ? 'pause' : 'play'} size={26} />
      </button>
      <div className="mundo">
        <button className="m-icon" disabled={!canUndo} onClick={() => useStore.getState().undo()} aria-label="Desfazer">
          <Icon name="undo" size={21} />
        </button>
        <button className="m-icon" disabled={!canRedo} onClick={() => useStore.getState().redo()} aria-label="Refazer">
          <Icon name="redo" size={21} />
        </button>
      </div>
    </div>
  );
}

// ---------- barra de ferramentas ----------
function Toolbar({ clip, media, onAdd, open }) {
  const magnet = useStore((s) => s.project.settings.magnet);
  const snap = useStore((s) => s.project.settings.snap);
  const deselect = () => useStore.getState().select([]);
  const toggle = (key) => useStore.getState().commit((p) => void (p.settings[key] = !p.settings[key]));
  const fit = () => {
    const s = useStore.getState();
    const total = projectDuration(s.project);
    if (total > 0) s.setZoom((window.innerWidth - 100) / total);
  };

  if (!clip) {
    return (
      <nav className="mtools" aria-label="Ferramentas">
        <Tool icon="plus" label="Mídia" onClick={onAdd} />
        <Tool icon="text" label="Texto" onClick={() => open('add')} />
        <Tool icon="mic" label="Gravar" onClick={() => open('record')} />
        <Tool icon="layout" label="Formato" onClick={() => open('format')} />
        <Tool icon="magnet" label="Ímã" active={magnet} onClick={() => toggle('magnet')} />
        <Tool icon="snap" label="Atração" active={snap} onClick={() => toggle('snap')} />
        <Tool icon="fit" label="Ajustar" onClick={fit} />
      </nav>
    );
  }
  const isText = clip.kind === 'text';
  const isEffect = clip.kind === 'effect';
  const hasSound = !isText && !isEffect && media?.hasAudio;
  const visual = isText || media?.type === 'video' || media?.type === 'image';
  return (
    <nav className="mtools sel" aria-label="Ferramentas do clipe">
      <button className="m-icon back" onClick={deselect} aria-label="Concluir seleção">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m15 5-7 7 7 7" />
        </svg>
      </button>
      <Tool icon="split" label="Dividir" onClick={() => { splitAtPlayhead(); haptic(12); }} />
      {isText && <Tool icon={clip.sticker ? 'sticker' : 'text'} label={clip.sticker ? 'Adesivo' : 'Texto'} onClick={() => open('text')} />}
      {isText && <Tool icon="sparkle" label="Animação" onClick={() => open('anim')} />}
      {!isText && !isEffect && media?.type !== 'image' && <Tool icon="stepForward" label="Velocidade" onClick={() => open('speed')} />}
      {hasSound && <Tool icon="volume" label="Volume" onClick={() => open('volume')} />}
      {hasSound && <Tool icon="music" label="Som" onClick={() => open('audio')} />}
      {visual && <Tool icon="crop" label="Posição" onClick={() => open('transform')} />}
      <Tool icon="duplicate" label="Duplicar" onClick={() => { duplicateSelection(); haptic(10); }} />
      <Tool icon="trash" label="Excluir" danger onClick={() => { deleteSelection(); haptic(14); }} />
    </nav>
  );
}

// ---------- painéis ----------
const ASPECT_LIST = [
  ['9:16', 'Vertical'],
  ['16:9', 'Horizontal'],
  ['1:1', 'Quadrado'],
  ['4:5', 'Retrato'],
  ['3:4', '3:4'],
  ['4:3', '4:3'],
  ['21:9', 'Cinema'],
  ['2.39:1', 'Cinemascope'],
];
const FPS_LIST = [24, 25, 30, 60];

function FormatSheet() {
  const settings = useStore((s) => s.project.settings);
  return (
    <>
      <div className="mformats wrap">
        {ASPECT_LIST.map(([a, label]) => {
          const [w, h] = ASPECTS[a];
          return (
            <button key={a} className={'mformat' + (settings.aspect === a ? ' on' : '')} onClick={() => setProjectFormat({ aspect: a })}>
              <span className="mformat-shape" style={{ aspectRatio: `${w} / ${h}` }} />
              <b>{label}</b>
              <small>{a}</small>
            </button>
          );
        })}
      </div>
      <p className="msec">Quadros por segundo</p>
      <div className="mchips">
        {FPS_LIST.map((f) => (
          <button key={f} className={'mchip' + (settings.fps === f ? ' on' : '')} onClick={() => setProjectFormat({ fps: f })}>
            {f} fps
          </button>
        ))}
      </div>
    </>
  );
}

function SpeedSheet({ clip, media }) {
  const speed = clip.speed ?? 1;
  const presets = [0.25, 0.5, 1, 1.5, 2, 4];
  return (
    <>
      <Slider label="Velocidade" value={speed} min={0.1} max={4} step={0.05} defaultValue={1} format={(v) => v.toFixed(2).replace(/\.?0+$/, '') + '×'} onStart={() => setClipSpeed(clip.id, {}, 'start')} onChange={(v) => setClipSpeed(clip.id, { speed: v }, 'live')} onEnd={() => setClipSpeed(clip.id, {}, 'end')} />
      <div className="mchips row">
        {presets.map((v) => (
          <button key={v} className={'mchip' + (Math.abs(speed - v) < 0.001 ? ' on' : '')} onClick={() => setClipSpeed(clip.id, { speed: v })}>
            {v}×
          </button>
        ))}
      </div>
      {media?.hasAudio && (
        <label className="mswitch">
          <span>
            Manter o tom da voz
            <small>Evita a voz “fina” ou “grossa” quando muda a velocidade</small>
          </span>
          <input type="checkbox" checked={clip.keepPitch !== false} onChange={(e) => setClipSpeed(clip.id, { keepPitch: e.target.checked })} />
          <i />
        </label>
      )}
    </>
  );
}

// Losango: marca ou tira um keyframe da propriedade no ponto em que o vídeo está.
function KfDiamond({ clip, prop }) {
  const now = useStore((s) => s.currentTime);
  const fps = useStore((s) => s.project.settings.fps);
  const local = now - clip.start;
  const tol = 0.5 / fps;
  const inside = local >= -1e-6 && local <= clipDur(clip) + 1e-6;
  const has = hasKeyframes(clip, prop);
  const at = findKey(clip, prop, local, tol) >= 0;
  const toggle = () => {
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      if (at) removeKeyframe(c, prop, local, tol);
      else setKeyframe(c, prop, local, valueAt(c, prop, local), tol);
    });
    haptic(at ? 8 : 14);
  };
  return (
    <button className={'mkf' + (at ? ' on' : has ? ' has' : '')} disabled={!inside} onClick={toggle} aria-pressed={at} aria-label={at ? 'Remover keyframe' : 'Adicionar keyframe'}>
      <svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M6 1 11 6 6 11 1 6Z" />
      </svg>
    </button>
  );
}

// Aparece quando há keyframes: pular entre eles, escolher a suavidade e apagar tudo.
function KeyframeBar({ clip }) {
  const now = useStore((s) => s.currentTime);
  const fps = useStore((s) => s.project.settings.fps);
  const times = keyframeTimes(clip);
  if (!times.length) return null;
  const local = now - clip.start;
  const tol = 0.5 / fps;
  const here = KF_PROPS.filter((p) => findKey(clip, p, local, tol) >= 0);
  const ease = here.length ? clip.keyframes[here[0]][findKey(clip, here[0], local, tol)].ease || 'ease' : null;
  const prev = [...times].reverse().find((t) => t < local - tol);
  const next = times.find((t) => t > local + tol);
  const setEase = (e) =>
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      for (const prop of here) {
        const i = findKey(c, prop, local, tol);
        c.keyframes[prop] = c.keyframes[prop].map((k, j) => (j === i ? { ...k, ease: e } : k));
      }
    });
  return (
    <>
      <p className="msec">Keyframes ({times.length})</p>
      <div className="mchips row">
        <button className="mchip" disabled={prev == null} onClick={() => seek(clip.start + prev)}>
          ‹ Anterior
        </button>
        <button className="mchip" disabled={next == null} onClick={() => seek(clip.start + next)}>
          Próximo ›
        </button>
        {here.length > 0 &&
          EASES.map(([id, label]) => (
            <button key={id} className={'mchip' + (ease === id ? ' on' : '')} onClick={() => setEase(id)}>
              {label}
            </button>
          ))}
        <button className="mchip" onClick={() => useStore.getState().commit((p) => void delete p.clips.find((x) => x.id === clip.id).keyframes)}>
          <Icon name="trash" size={16} /> Apagar
        </button>
      </div>
    </>
  );
}

// Slider ligado a uma propriedade do clipe (respeita keyframes: com keyframes grava no instante atual).
function PropSlider({ clip, prop, label, min, max, step, scale = 1, format, def }) {
  const now = useStore((s) => s.currentTime);
  const fps = useStore((s) => s.project.settings.fps);
  const local = clamp(now - clip.start, 0, clipDur(clip));
  const raw = prop === 'volume' ? valueAt(clip, 'volume', local) : transformAt(clip, local)[prop];
  const tol = 0.5 / fps;
  return (
    <Slider
      label={label}
      value={raw * scale}
      min={min}
      max={max}
      step={step}
      defaultValue={def * scale}
      format={format}
      accessory={<KfDiamond clip={clip} prop={prop} />}
      onStart={() => useStore.getState().gestureStart()}
      onChange={(v) =>
        useStore.getState().live((q) => {
          const c = q.clips.find((x) => x.id === clip.id);
          if (!c) return;
          const loc = clamp(useStore.getState().currentTime - c.start, 0, clipDur(c));
          applyProp(c, prop, v / scale, loc, tol);
        })
      }
      onEnd={() => useStore.getState().gestureEnd()}
    />
  );
}

function VolumeSheet({ clip }) {
  const vol = clip.volume ?? 1;
  return (
    <>
      <PropSlider clip={clip} prop="volume" label="Volume" min={0} max={200} step={1} scale={100} def={1} format={(v) => Math.round(v) + '%'} />
      <KeyframeBar clip={clip} />
      <div className="mchips row">
        <button className={'mchip' + (vol === 0 ? ' on' : '')} onClick={() => useStore.getState().commit((p) => void (p.clips.find((c) => c.id === clip.id).volume = vol === 0 ? 1 : 0))}>
          <Icon name="mute" size={16} /> {vol === 0 ? 'Ativar som' : 'Silenciar'}
        </button>
        {[50, 100, 150].map((v) => (
          <button key={v} className="mchip" onClick={() => useStore.getState().commit((p) => void (p.clips.find((c) => c.id === clip.id).volume = v / 100))}>
            {v}%
          </button>
        ))}
      </div>
    </>
  );
}

function TransformSheet({ clip }) {
  const reset = () =>
    useStore.getState().commit((p) => {
      const c = p.clips.find((x) => x.id === clip.id);
      c.transform = { ...DEFAULT_TRANSFORM };
      delete c.keyframes;
    });
  return (
    <>
      <PropSlider clip={clip} prop="scale" label="Tamanho" min={10} max={400} step={1} scale={100} def={1} format={(v) => Math.round(v) + '%'} />
      <PropSlider clip={clip} prop="rotation" label="Giro" min={-180} max={180} step={1} def={0} format={(v) => Math.round(v) + '°'} />
      <PropSlider clip={clip} prop="opacity" label="Opacidade" min={0} max={100} step={1} scale={100} def={1} format={(v) => Math.round(v) + '%'} />
      <PropSlider clip={clip} prop="x" label="Horizontal" min={-100} max={100} step={1} scale={100} def={0} format={(v) => Math.round(v) + '%'} />
      <PropSlider clip={clip} prop="y" label="Vertical" min={-100} max={100} step={1} scale={100} def={0} format={(v) => Math.round(v) + '%'} />
      <KeyframeBar clip={clip} />
      <div className="mchips">
        <button className="mchip" onClick={reset}>
          <Icon name="reset" size={16} /> Redefinir
        </button>
      </div>
    </>
  );
}
