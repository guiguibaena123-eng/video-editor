import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { engine } from '../engine';
import { Icon } from '../icons';
import { addRecording, cleanError } from '../ops';
import { fmtTimecode } from '../util';

// Grava narração pelo microfone. Enquanto grava, o vídeo toca (sem som, para não vazar no microfone).
export default function VoiceoverDialog() {
  const [devices, setDevices] = useState([]);
  const [deviceId, setDeviceId] = useState('');
  const [phase, setPhase] = useState('idle'); // idle | countdown | recording | saving | error
  const [count, setCount] = useState(3);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState('');
  const [playVideo, setPlayVideo] = useState(true);
  const streamRef = useRef(null);
  const recRef = useRef(null);
  const chunks = useRef([]);
  const startAt = useRef(0);
  const startedWall = useRef(0);
  const fps = useStore((s) => s.project.settings.fps);

  const close = () => {
    if (phase === 'recording' || phase === 'saving' || phase === 'countdown') return;
    useStore.setState({ recordOpen: false });
  };

  // Abre o microfone escolhido e mostra o nível do som.
  useEffect(() => {
    let raf = 0;
    let ctx = null;
    let alive = true;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: deviceId ? { deviceId: { exact: deviceId } } : true });
        if (!alive) return stream.getTracks().forEach((t) => t.stop());
        streamRef.current = stream;
        const list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
        setDevices(list);
        if (!deviceId) setDeviceId(stream.getAudioTracks()[0]?.getSettings().deviceId || '');
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        const tick = () => {
          an.getFloatTimeDomainData(buf);
          let peak = 0;
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          setLevel((l) => Math.max(peak, l * 0.9));
          raf = requestAnimationFrame(tick);
        };
        tick();
      } catch (err) {
        setError(err.name === 'NotAllowedError' ? 'O acesso ao microfone foi negado. No Windows, abra Configurações → Privacidade → Microfone e permita o acesso para aplicativos da área de trabalho.' : err.name === 'NotFoundError' ? 'Nenhum microfone foi encontrado. Conecte um e tente de novo.' : cleanError(err));
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ctx?.close();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [deviceId]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (phase !== 'recording') return;
    const id = setInterval(() => setElapsed((performance.now() - startedWall.current) / 1000), 100);
    return () => clearInterval(id);
  }, [phase]);

  // Ao fechar a janela no meio de algo, o projeto volta a ter som.
  useEffect(() => () => {
    engine.muteAll = false;
  }, []);

  const begin = () => {
    engine.pause();
    setPhase('countdown');
    let n = 3;
    setCount(n);
    const id = setInterval(() => {
      n -= 1;
      if (n > 0) return setCount(n);
      clearInterval(id);
      startRecording();
    }, 1000);
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream) return;
    chunks.current = [];
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 192000 });
    rec.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    rec.onstop = save;
    recRef.current = rec;
    startAt.current = useStore.getState().currentTime;
    startedWall.current = performance.now();
    setElapsed(0);
    rec.start(250);
    if (playVideo) {
      engine.muteAll = true;
      engine.play();
    }
    setPhase('recording');
  };

  const stop = () => {
    engine.pause();
    engine.muteAll = false;
    setPhase('saving');
    recRef.current?.stop();
  };

  const save = async () => {
    try {
      const blob = new Blob(chunks.current, { type: 'audio/webm' });
      const path = await window.api.saveRecording(await blob.arrayBuffer());
      await addRecording(path, startAt.current);
      useStore.getState().notify('Narração adicionada na trilha "Narração".');
      useStore.setState({ recordOpen: false });
    } catch (err) {
      setError('Não foi possível salvar a gravação: ' + cleanError(err));
      setPhase('error');
    }
  };

  const meter = Math.min(1, level * 1.4);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal record-modal" role="dialog" aria-label="Gravar narração">
        <div className="modal-head">
          <h2>Gravar narração</h2>
          {phase !== 'recording' && phase !== 'saving' && phase !== 'countdown' && (
            <button className="icon-btn" onClick={close} aria-label="Fechar">
              <Icon name="close" />
            </button>
          )}
        </div>

        {phase === 'error' ? (
          <div className="export-progress">
            <div className="error-icon">
              <Icon name="warning" size={28} />
            </div>
            <p className="muted">{error}</p>
            <button className="secondary" onClick={() => useStore.setState({ recordOpen: false })}>
              Fechar
            </button>
          </div>
        ) : (
          <div className="record-body">
            <label className="field">
              <span className="field-label">Microfone</span>
              <select value={deviceId} onChange={(e) => setDeviceId(e.target.value)} disabled={phase !== 'idle'} aria-label="Microfone">
                {devices.map((d, i) => (
                  <option key={d.deviceId || i} value={d.deviceId}>
                    {d.label || `Microfone ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="meter" aria-label="Nível do microfone">
              <div style={{ width: `${meter * 100}%`, background: meter > 0.92 ? 'var(--danger)' : meter > 0.7 ? 'var(--accent)' : 'var(--ok)' }} />
            </div>
            <p className="hint">Fale normalmente: a barra deve ficar verde ou amarela. Se ficar vermelha, afaste-se um pouco do microfone.</p>

            <div className="record-center">
              {phase === 'countdown' && <div className="countdown">{count}</div>}
              {phase === 'recording' && (
                <div className="rec-time">
                  <span className="rec-dot" /> {fmtTimecode(elapsed, fps)}
                </div>
              )}
              {phase === 'saving' && (
                <div className="rec-time">
                  <span className="spinner" /> Salvando…
                </div>
              )}
              {phase === 'idle' && (
                <button className="rec-button" onClick={begin} aria-label="Começar a gravar">
                  <span />
                </button>
              )}
              {phase === 'recording' && (
                <button className="rec-button stop" onClick={stop} aria-label="Parar a gravação">
                  <span />
                </button>
              )}
            </div>

            <label className="check-row">
              <input type="checkbox" checked={playVideo} onChange={(e) => setPlayVideo(e.target.checked)} disabled={phase !== 'idle'} />
              Tocar o vídeo enquanto gravo (sem som, para não vazar no microfone)
            </label>
            <p className="hint">A narração começa no ponto do cursor ({fmtTimecode(useStore.getState().currentTime, fps)}) e é salva em Documentos\Video Editor\Narrações.</p>
          </div>
        )}
      </div>
    </div>
  );
}
