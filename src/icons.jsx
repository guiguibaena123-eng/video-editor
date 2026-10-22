const paths = {
  layout: <path d="M4 5.5h16a1 1 0 0 1 1 1V9H3V6.5a1 1 0 0 1 1-1ZM3 11h8.5v8H4a1 1 0 0 1-1-1V11Zm10.5 0H21v7a1 1 0 0 1-1 1h-6.5v-8Z" />,
  play: <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.6-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
      <rect x="13.5" y="5" width="4" height="14" rx="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  stepBack: <path d="M18 6 10 12l8 6V6ZM6 6v12" />,
  stepForward: <path d="m6 6 8 6-8 6V6Zm12 0v12" />,
  toStart: <path d="M6 5v14M19 6l-9 6 9 6V6Z" />,
  toEnd: <path d="M18 5v14M5 6l9 6-9 6V6Z" />,
  undo: <path d="M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />,
  redo: <path d="m15 14 5-5-5-5m5 5H9.5a5.5 5.5 0 0 0 0 11H13" />,
  split: <path d="M12 3v18M7 7 4 12l3 5M17 7l3 5-3 5" />,
  trash: <path d="M4 7h16M9 7V4.5h6V7m-8.5 0 1 12.5h9l1-12.5M10 11v5m4-5v5" />,
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </>
  ),
  magnet: <path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4H6Zm0 4h4m4 0h4" />,
  snap: <path d="M12 3v4m0 10v4M5 12H3m18 0h-2M8 8l-2-2m12 0-2 2m0 8 2 2M6 18l2-2M12 9.5a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5Z" />,
  zoomIn: <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 4v6m-3-3h6m2 5 4.5 4.5" />,
  zoomOut: <path d="M11 4a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm-3 7h6m2 5 4.5 4.5" />,
  fit: <path d="M4 9V5h4M20 9V5h-4M4 15v4h4m12-4v4h-4M8 12h8" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: <path d="M4 4l16 16M10.6 6.6c.45-.06.92-.1 1.4-.1 6 0 9.5 5.5 9.5 5.5s-.9 1.5-2.6 3.1M6.5 7.9C4 9.6 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.45 4.2-1.1M9.9 10a2.8 2.8 0 0 0 4 4" />,
  volume: <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Zm11.5-.5a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11" />,
  mute: <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4Zm11.5 0 5 5m0-5-5 5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  unlock: (
    <>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  import: <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16" />,
  export: <path d="M12 15V4m0 0L7.5 8.5M12 4l4.5 4.5M4.5 14v4.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V14" />,
  film: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7.5 5v14m9-14v14M3.5 9.5h4m-4 5h4m9-5h4m-4 5h4" />
    </>
  ),
  music: <path d="M9 17.5V6l10-2v11.5M9 17.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm10-2a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" />,
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="m4 17 5-5 4 4 2.5-2.5L20 18M15.5 8.5h.01" />
    </>
  ),
  folder: <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.5l2 2.5H19a1.5 1.5 0 0 1 1.5 1.5v7.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5v-10Z" />,
  save: <path d="M5 4h11l3.5 3.5V19a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3 0v5h7V4M7.5 20v-6h9v6" />,
  file: <path d="M6.5 3.5h7l4 4V20a.5.5 0 0 1-.5.5H6.5A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Zm7 0v4h4" />,
  eyedropper: <path d="M14.5 4.5 19.5 9.5M17 7l-9.5 9.5-3 1 1-3L15 5M16.5 3.5a2.1 2.1 0 0 1 3 3l-1 1-3-3 1-1Z" />,
  transition: <path d="M4 6h7v12H4zM13 6h7v12h-7zM9 12h6m-2-2 2 2-2 2" />,
  sparkle: <path d="M12 3.5 13.8 10.2 20.5 12l-6.7 1.8L12 20.5l-1.8-6.7L3.5 12l6.7-1.8L12 3.5ZM18.5 3.5v3m-1.5-1.5h3" />,
  sticker: <path d="M20.5 12A8.5 8.5 0 1 1 12 3.5h3.5a5 5 0 0 1 5 5V12Zm0 0h-4a4 4 0 0 0-4 4v4.5M8.5 10h.01M14 10h.01M8.8 14.2a4 4 0 0 0 3.2 1.3" />,
  flip: <path d="M12 3v18M9 6 3.5 18H9V6Zm6 0 5.5 12H15V6Z" />,
  keyframe: <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />,
  freeze: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.5 4.5 12 6l2.5-1.5M9.5 19.5 12 18l2.5 1.5" />,
  reverse: <path d="M9 5 4 10l5 5M4 10h10.5a5.5 5.5 0 0 1 0 11H11" />,
  mic: <path d="M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3Zm-6 8a6 6 0 0 0 12 0M12 17.5v3m-3 0h6" />,
  text: <path d="M5 6.5V5h14v1.5M12 5v14m-3 0h6" />,
  crop: <path d="M6.5 2.5v13a2 2 0 0 0 2 2h13M2.5 6.5h13a2 2 0 0 1 2 2v13" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  reset: <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4v4h4" />,
  warning: <path d="M12 4 2.8 19.5h18.4L12 4Zm0 6v4.5m0 2.5h.01" />,
  media: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
    </>
  ),
  fullscreen: <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" />,
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
};

export function Icon({ name, size = 18, className = '', strokeWidth = 1.8 }) {
  return (
    <svg className={'icon ' + className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="116" fill="#FFC72C" />
      <g fill="#111" stroke="#111" strokeLinejoin="round">
        <rect x="132" y="128" width="132" height="40" rx="14" strokeWidth="0" />
        <rect x="82" y="164" width="262" height="196" rx="36" strokeWidth="0" />
        <path d="M350 232 L428 186 Q438 180 438 192 L438 332 Q438 344 428 338 L350 292 Z" strokeWidth="16" />
      </g>
      <circle cx="134" cy="214" r="16" fill="#FFC72C" />
      <rect x="166" y="304" width="132" height="18" rx="9" fill="#FFC72C" />
    </svg>
  );
}
