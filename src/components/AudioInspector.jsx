import { useEffect, useState } from 'react';
import { useStore, clipDur } from '../store';
import { Icon } from '../icons';
import { SliderField, Section, Switch } from './Fields.jsx';
import { withAudio, VOICES, DENOISE, needsProxy, ensureProxy } from '../audio';
import { detachAudio, cutToBeats } from '../ops';
import { withDuck, detectBeats } from '../audioPro';
import { engine } from '../engine';
import { KfButton, useLocalTime } from './KeyframeControls.jsx';
import { valueAt, applyProp } from '../keyframes';

const toDb = (v) => (v <= 0 ? '-∞' : (20 * Math.log10(v)).toFixed(1));

// Atualiza o clipe; arrastar slider conta como um só passo de desfazer.
function useUpdater(clipId) {
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

export default function AudioInspector({ clip, media }) {
  const update = useUpdater(clip.id);
  const audio = withAudio(clip.audio);
  const dur = clipDur(clip);
  const { local, tol } = useLocalTime(clip);
  const volume = valueAt(clip, 'volume', local);
  const setA = (key) => update((c, v) => (c.audio = { ...withAudio(c.audio), [key]: v }));
  const commitA = (key, v) => setA(key)(v, 'set');
  const proxy = useStore((s) => {
    if (!needsProxy(clip.audio)) return null;
    return Object.entries(s.proxies).find(([k]) => k === `${media.id}|${audio.denoise}|${audio.voice}|${audio.normalize ? 1 : 0}`)?.[1] || null;
  });
  const maxFade = Math.max(0.1, Math.min(10, dur / 2));
  const duck = withDuck(audio);
  const setDuck = (patch) => update((c, v) => (c.audio = { ...withAudio(c.audio), duck: { ...withDuck(c.audio), ...v } }))(patch, 'set');
  const setDuckLive = (key) => update((c, v) => (c.audio = { ...withAudio(c.audio), duck: { ...withDuck(c.audio), [key]: v } }));
  const wave = useStore((s) => s.cache[media.id]?.wave);
  const beatInfo = audio.beats && wave ? detectBeats(wave) : null;
  const [every, setEvery] = useState(1);

  // Começa a processar assim que um efeito é escolhido (não espera dar play).
  useEffect(() => {
    if (media.hasAudio && needsProxy(clip.audio)) ensureProxy(media, clip.audio);
  }, [media.id, audio.denoise, audio.voice, audio.normalize]);

  // Ao escolher um efeito, já começa a processar e toca um trecho para ouvir.
  const chooseVoice = (voice) => {
    commitA('voice', voice);
    if (voice === 'none') return;
    const next = { ...audio, voice };
    ensureProxy(media, next);
    const t = useStore.getState().currentTime;
    const inside = t >= clip.start && t < clip.start + dur;
    const from = inside ? t : clip.start;
    setTimeout(() => engine.playRange(from, Math.min(clip.start + dur - 0.001, from + 4)), 50);
  };

  if (clip.audioDetached) {
    return (
      <Section title="Áudio">
        <p className="hint">O som deste vídeo foi separado e está num clipe da trilha de áudio. Selecione aquele clipe para ajustar volume e efeitos.</p>
        <button className="secondary small" onClick={() => update((c) => delete c.audioDetached)(null, 'set')}>
          <Icon name="volume" size={15} /> Reativar o som original aqui
        </button>
      </Section>
    );
  }

  return (
    <>
      <Section title="Volume">
        <SliderField label="Volume" adornment={<KfButton clip={clip} prop="volume" />} value={volume} min={0} max={2} step={1} unit="%" toDisplay={(v) => v * 100} fromDisplay={(v) => v / 100} defaultValue={1} onChange={update((c, v) => applyProp(c, 'volume', v, local, tol))} />
        <p className="hint">{toDb(volume)} dB · acima de 100% amplifica o som.</p>
      </Section>

      <Section title="Fade">
        <SliderField label="Entrada (aumentar aos poucos)" value={Math.min(audio.fadeIn, maxFade)} min={0} max={maxFade} step={0.1} unit="s" decimals={1} defaultValue={0} onChange={setA('fadeIn')} />
        <SliderField label="Saída (diminuir aos poucos)" value={Math.min(audio.fadeOut, maxFade)} min={0} max={maxFade} step={0.1} unit="s" decimals={1} defaultValue={0} onChange={setA('fadeOut')} />
      </Section>

      <Section title="Ducking automático" action={<Switch label="Ducking automático" checked={duck.on} onChange={(v) => setDuck({ on: v })} />}>
        <p className="hint">Use na música: o volume dela abaixa sozinho quando outro clipe (uma fala, uma narração) está falando e volta depois. Funciona igual na prévia e no vídeo final.</p>
        {duck.on && (
          <>
            <SliderField label="Quanto abaixar" value={duck.amount} min={3} max={30} step={1} unit=" dB" decimals={0} defaultValue={14} onChange={setDuckLive('amount')} />
            <SliderField label="Sensibilidade à voz" value={duck.sens} min={0.05} max={0.6} step={1} toDisplay={(v) => Math.round(v * 100)} fromDisplay={(v) => v / 100} unit="%" defaultValue={0.2} onChange={setDuckLive('sens')} />
            <p className="hint">Sensibilidade alta = qualquer sussurro abaixa a música; baixa = só falas fortes.</p>
          </>
        )}
      </Section>

      <Section title="Batida" action={<Switch label="Marcar batidas" checked={!!audio.beats} onChange={(v) => commitA('beats', v)} />}>
        <p className="hint">Marca as batidas da música na linha do tempo. Os clipes que você arrastar encaixam nelas.</p>
        {audio.beats && !wave && <p className="hint">Analisando o som…</p>}
        {beatInfo && beatInfo.beats.length < 4 && <p className="hint">Não encontrei um ritmo claro neste áudio.</p>}
        {beatInfo && beatInfo.beats.length >= 4 && (
          <>
            <p className="hint">
              Andamento: <b>{Math.round(beatInfo.bpm)} batidas por minuto</b> · {beatInfo.confidence > 0.6 ? 'ritmo bem marcado' : 'ritmo fraco: confira as marcas'}. Marca grossa = início de cada compasso (4 batidas).
            </p>
            <SliderField label="Ajuste fino das marcas" value={audio.beatShift || 0} min={-0.25} max={0.25} step={0.01} unit="s" decimals={2} defaultValue={0} onChange={setA('beatShift')} />
            <div className="seg">
              {[1, 2, 4].map((n) => (
                <button key={n} className={every === n ? 'on' : ''} onClick={() => setEvery(n)} aria-pressed={every === n}>
                  {n === 1 ? 'Toda batida' : `A cada ${n}`}
                </button>
              ))}
            </div>
            <button className="secondary small" onClick={() => cutToBeats(clip.id, every)}>
              <Icon name="music" size={15} /> Ajustar clipes às batidas
            </button>
            <p className="hint">Apara o final dos vídeos e fotos da trilha principal para cada troca cair numa batida (não estica nem acelera nada). Dá para desfazer com Ctrl+Z.</p>
          </>
        )}
      </Section>

      <Section title="Redução de ruído">
        <div className="seg">
          {DENOISE.map(([id, label]) => (
            <button key={id} className={audio.denoise === id ? 'on' : ''} onClick={() => commitA('denoise', id)} aria-pressed={audio.denoise === id}>
              {label}
            </button>
          ))}
        </div>
        <p className="hint">Tira chiado e ruído de fundo constante (ventilador, ar-condicionado). Use "Forte" só quando o ruído for alto: pode deixar a voz abafada.</p>
      </Section>

      <Section
        title="Normalizar volume"
        action={<Switch label="Normalizar volume" checked={audio.normalize} onChange={(v) => commitA('normalize', v)} />}
      >
        <p className="hint">Deixa o volume no padrão das redes sociais (-16 LUFS): partes baixas sobem e picos são contidos.</p>
      </Section>

      <Section title="Efeitos de voz" defaultOpen={false}>
        <div className="anim-grid">
          {VOICES.map(([id, label]) => (
            <button key={id} className={'anim-chip' + (audio.voice === id ? ' on' : '')} onClick={() => chooseVoice(id)} aria-pressed={audio.voice === id}>
              <VoiceGlyph id={id} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      </Section>

      {proxy && (
        <div className={'fx-status ' + proxy.status}>
          {proxy.status === 'pending' && (
            <>
              <span className="spinner" /> Processando o áudio… a prévia usa o som original até terminar.
            </>
          )}
          {proxy.status === 'ready' && (
            <>
              <Icon name="check" size={14} strokeWidth={2.6} /> Efeitos aplicados na prévia e na exportação.
            </>
          )}
          {proxy.status === 'error' && (
            <>
              <Icon name="warning" size={14} /> Não foi possível processar: {proxy.error}
            </>
          )}
        </div>
      )}

      {media.type === 'video' && (
        <Section title="Separar áudio">
          <p className="hint">Coloca o som deste vídeo num clipe próprio na trilha de áudio, para mover ou editar separado da imagem.</p>
          <button className="secondary small" onClick={() => detachAudio(clip.id)}>
            <Icon name="music" size={15} /> Separar áudio
          </button>
        </Section>
      )}
    </>
  );
}

function VoiceGlyph({ id }) {
  const d = {
    none: 'M6 6l12 12',
    chipmunk: 'M8 18c0-5 1.5-9 4-9s4 4 4 9M9 9 7 4m8 5 2-5M12 13h.01',
    deep: 'M4 16c2-6 4-6 6 0s4 6 6 0 3-4 4-2',
    monster: 'M6 10l3-4 3 3 3-3 3 4v8H6v-8Zm3 4h.01M15 14h.01M10 18v-2m4 2v-2',
    robot: 'M7 9h10v9H7zM12 9V6m-2 7h.01M14 13h.01M10 16h4M5 12v3m14-3v3',
    echo: 'M5 12a7 7 0 0 1 7-7m-4 7a4 4 0 0 1 4-4m-1 4a1 1 0 0 1 1-1m8 1a7 7 0 0 1-7 7',
    hall: 'M4 20V10l8-6 8 6v10M9 20v-6h6v6',
    phone: 'M7 4h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 5 6a2 2 0 0 1 2-2Z',
    megaphone: 'M4 10v4h3l8 4V6l-8 4H4Zm15-1v6',
    radio: 'M5 9h14v10H5zM8 9l8-4m-8 9h.01M15 14a2 2 0 1 0 0 .01',
    underwater: 'M3 15c2-2 4-2 6 0s4 2 6 0 4-2 6 0M8 9a1.5 1.5 0 1 0 0 .01M13 6a2 2 0 1 0 0 .01',
  }[id];
  return (
    <svg className="anim-glyph" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
