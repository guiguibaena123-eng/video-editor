import { useEffect, useRef, useState } from 'react';
import { useStore, clipDur } from '../store';
import { engine } from '../engine';
import { withAudio } from '../audio';
import { withDuck } from '../audioPro';
import { addRecording, detachAudio, cleanError } from '../ops';
import { storeFiles } from '../web/api';
import { Icon } from '../icons';
import { Slider, haptic } from './ui';

const edit = (clipId, mutate, phase = 'set') => {
  const s = useStore.getState();
  const apply = (p) => {
    const c = p.clips.find((x) => x.id === clipId);
    if (c) mutate(c);
  };
  if (phase === 'start') s.gestureStart();
  else if (phase === 'live') s.live(apply);
  else if (phase === 'end') s.gestureEnd();
  else s.commit(apply);
};

// ---------- som do clipe: entrada/saída suaves e ducking ----------
export function AudioSheet({ clip, media }) {
  const audio = withAudio(clip.audio);
  const duck = withDuck(audio);
  const dur = clipDur(clip);
  const maxFade = Math.max(0.1, Math.min(10, dur / 2));
  const setA = (key, v, phase) => edit(clip.id, (c) => void (c.audio = { ...withAudio(c.audio), [key]: v }), phase);
  const setD = (key, v, phase) => edit(clip.id, (c) => void (c.audio = { ...withAudio(c.audio), duck: { ...withDuck(c.audio), [key]: v } }), phase);
  const sec = (v) => v.toFixed(1) + ' s';
  return (
    <>
      <Slider label="Entrada suave" value={Math.min(audio.fadeIn, maxFade)} min={0} max={maxFade} step={0.1} defaultValue={0} format={sec} onStart={() => setA('', 0, 'start')} onChange={(v) => setA('fadeIn', v, 'live')} onEnd={() => setA('', 0, 'end')} />
      <Slider label="Saída suave" value={Math.min(audio.fadeOut, maxFade)} min={0} max={maxFade} step={0.1} defaultValue={0} format={sec} onStart={() => setA('', 0, 'start')} onChange={(v) => setA('fadeOut', v, 'live')} onEnd={() => setA('', 0, 'end')} />
      <div className="mgroup">
        <label className="mswitch">
          <span>
            Ducking automático
            <small>Abaixa esta música sozinha quando outro clipe tem voz</small>
          </span>
          <input type="checkbox" checked={duck.on} onChange={(e) => setD('on', e.target.checked)} />
          <i />
        </label>
        {duck.on && (
          <>
            <Slider label="Quanto abaixar" value={duck.amount} min={3} max={30} step={1} defaultValue={14} format={(v) => Math.round(v) + ' dB'} onStart={() => setD('', 0, 'start')} onChange={(v) => setD('amount', v, 'live')} onEnd={() => setD('', 0, 'end')} />
            <Slider label="Sensibilidade à voz" value={Math.round(duck.sens * 100)} min={5} max={60} step={1} defaultValue={20} format={(v) => Math.round(v) + '%'} onStart={() => setD('', 0, 'start')} onChange={(v) => setD('sens', v / 100, 'live')} onEnd={() => setD('', 0, 'end')} />
          </>
        )}
      </div>
      {clip.kind !== 'text' && media?.type === 'video' && media.hasAudio && !clip.audioDetached && (
        <div className="mchips">
          <button className="mchip" onClick={() => { detachAudio(clip.id); haptic(12); }}>
            <Icon name="music" size={16} /> Separar o áudio do vídeo
          </button>
        </div>
      )}
    </>
  );
}

// ---------- gravar narração pelo microfone ----------
export function RecordSheet({ onClose }) {
  const [phase, setPhase] = useState('idle'); // idle | count | rec | saving | error
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [withVideo, setWithVideo] = useState(true);
  const stream = useRef(null);
  const rec = useRef(null);
  const chunks = useRef([]);
  const startAt = useRef(0);
  const wall = useRef(0);
  const phaseRef = useRef('idle');
  phaseRef.current = phase;

  const stopStream = () => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };

  useEffect(() => {
    let raf = 0;
    let ctx = null;
    let alive = true;
    (async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (!alive) return s.getTracks().forEach((t) => t.stop());
        stream.current = s;
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(s).connect(an);
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          setLevel((l) => Math.max(peak, l * 0.88));
          if (phaseRef.current === 'rec') setElapsed((performance.now() - wall.current) / 1000);
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(err.name === 'NotAllowedError' ? 'O acesso ao microfone foi negado. Permita o microfone para este site nas configurações do navegador.' : err.name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : cleanError(err));
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ctx?.close?.();
      if (rec.current?.state === 'recording') rec.current.stop();
      stopStream();
      engine.muteAll = false;
    };
  }, []);

  const begin = () => {
    setPhase('count');
    let n = 3;
    setCount(n);
    const tick = setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      clearInterval(tick);
      start();
    }, 800);
  };

  const start = () => {
    const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((m) => window.MediaRecorder?.isTypeSupported?.(m));
    const r = new MediaRecorder(stream.current, mime ? { mimeType: mime } : undefined);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.onstop = save;
    rec.current = r;
    startAt.current = useStore.getState().currentTime;
    wall.current = performance.now();
    r.start(250);
    haptic(20);
    if (withVideo) {
      engine.muteAll = true;
      engine.play();
    }
    setPhase('rec');
  };

  const stop = () => {
    engine.pause();
    engine.muteAll = false;
    if (rec.current?.state === 'recording') rec.current.stop();
    setPhase('saving');
  };

  const save = async () => {
    try {
      const type = rec.current.mimeType || 'audio/webm';
      const blob = new Blob(chunks.current, { type });
      const ext = type.includes('mp4') ? 'm4a' : 'webm';
      const file = new File([blob], `Narração ${new Date().toLocaleTimeString('pt-BR').replace(/:/g, '-')}.${ext}`, { type });
      const [path] = await storeFiles([file]);
      await addRecording(path, startAt.current);
      haptic([20, 40, 20]);
      onClose();
    } catch (err) {
      setError('Não foi possível salvar a gravação: ' + cleanError(err));
      setPhase('error');
    }
  };

  const fmt = (v) => `${Math.floor(v / 60)}:${Math.floor(v % 60).toString().padStart(2, '0')}`;
  return (
    <div className="mrec">
      {phase === 'error' ? (
        <p className="mhint">{error}</p>
      ) : (
        <>
          <div className="mrec-meter" aria-hidden="true">
            <i style={{ transform: `scaleX(${Math.min(1, level * 1.6)})` }} />
          </div>
          <div className="mrec-time">{phase === 'count' ? count : phase === 'saving' ? 'Salvando…' : fmt(elapsed)}</div>
          <button className={'mrec-btn' + (phase === 'rec' ? ' on' : '')} disabled={phase === 'count' || phase === 'saving' || !stream.current} onClick={phase === 'rec' ? stop : begin} aria-label={phase === 'rec' ? 'Parar gravação' : 'Gravar'}>
            <i />
          </button>
          <p className="mhint center">{phase === 'rec' ? 'Gravando… toque para parar.' : 'A gravação começa no ponto em que o vídeo está.'}</p>
          <label className="mswitch">
            <span>
              Tocar o vídeo enquanto grava
              <small>O som do vídeo fica mudo para não entrar no microfone</small>
            </span>
            <input type="checkbox" checked={withVideo} disabled={phase !== 'idle'} onChange={(e) => setWithVideo(e.target.checked)} />
            <i />
          </label>
        </>
      )}
    </div>
  );
}
