import { useEffect, useRef, useState } from 'react';
import { useStore, projectDuration } from '../store';
import { engine } from '../engine';
import { onTime } from './timebus';
import { seek } from '../ops';
import { Icon } from '../icons';

const fmt = (v) => {
  const m = Math.floor(v / 60);
  return `${m}:${(v - m * 60).toFixed(1).padStart(4, '0')}`;
};

// ---------- tela cheia ----------
// Usa a tela cheia do navegador quando existe (Android) e, onde não existe (iPhone), cobre a janela inteira.
export async function enterFull(el, aspect) {
  if (useStore.getState().theater) return;
  useStore.setState({ theater: true });
  history.pushState({ full: true }, ''); // o botão "voltar" do aparelho só sai da tela cheia
  try {
    await el?.requestFullscreen?.({ navigationUI: 'hide' });
    if (aspect > 1.2) await screen.orientation?.lock?.('landscape');
  } catch {}
}

export function exitFull(fromPop = false) {
  if (!useStore.getState().theater) return;
  useStore.setState({ theater: false });
  try {
    screen.orientation?.unlock?.();
  } catch {}
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  if (!fromPop) {
    window.__skipPop = true; // desfaz o histórico que a entrada criou, sem o app achar que foi "voltar"
    history.back();
  }
}

// Controles sobre o vídeo em tela cheia: somem sozinhos enquanto toca; um toque os mostra de novo.
export default function FullControls() {
  const playing = useStore((s) => s.playing);
  const [show, setShow] = useState(true);
  const hideT = useRef(0);
  const cur = useRef(null);
  const bar = useRef(null);
  const resume = useRef(false);

  const wake = () => {
    setShow(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => useStore.getState().playing && setShow(false), 2800);
  };
  useEffect(() => {
    wake();
    return () => clearTimeout(hideT.current);
  }, [playing]);

  // Barra e contador acompanham o tempo direto no elemento (sem redesenhar o React a cada quadro).
  useEffect(() => {
    const apply = (t) => {
      const total = projectDuration(useStore.getState().project);
      if (bar.current) {
        bar.current.max = String(total || 1);
        if (!bar.current.dataset.drag) bar.current.value = String(t);
        bar.current.style.setProperty('--p', total ? (t / total) * 100 + '%' : '0%');
      }
      if (cur.current) cur.current.textContent = `${fmt(t)} / ${fmt(total)}`;
    };
    return onTime(apply);
  }, []);

  const stop = (e) => e.stopPropagation();
  return (
    <div
      className={'mfull' + (show ? ' show' : '')}
      onClick={() => {
        if (!show) return wake();
        engine.toggle();
        wake();
      }}
    >
      <button
        className="mfull-x"
        onClick={(e) => {
          stop(e);
          exitFull();
        }}
        aria-label="Sair da tela cheia"
      >
        <Icon name="close" size={22} strokeWidth={2.4} />
      </button>
      <div className="mfull-bar" onClick={stop}>
        <button
          className="mfull-play"
          onClick={() => {
            engine.toggle();
            wake();
          }}
          aria-label={playing ? 'Pausar' : 'Reproduzir'}
        >
          <Icon name={playing ? 'pause' : 'play'} size={26} />
        </button>
        <input
          ref={bar}
          type="range"
          min="0"
          max="1"
          step="0.01"
          aria-label="Posição do vídeo"
          onPointerDown={() => {
            bar.current.dataset.drag = '1';
            resume.current = engine.playing;
            if (engine.playing) engine.pause();
            clearTimeout(hideT.current);
          }}
          onInput={(e) => seek(parseFloat(e.target.value))}
          onPointerUp={() => {
            delete bar.current.dataset.drag;
            if (resume.current) engine.play();
            wake();
          }}
          onPointerCancel={() => delete bar.current?.dataset.drag}
        />
        <span ref={cur} className="mfull-time" />
      </div>
    </div>
  );
}
