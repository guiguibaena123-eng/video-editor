import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ThemeButton from './ThemeButton.jsx';
import { Icon, Logo } from '../icons';
import { useStore } from '../store';
import { createProject, createProjectFromFiles, openLibraryProject, openProject, cleanError } from '../ops';
import { fmtDuration } from '../util';
import { askConfirm } from './DialogHost.jsx';

// Tela inicial: todos os projetos do usuário. Minimalista: busca, ordenação, cartões com miniatura.

const FORMATS = [
  ['16:9', 'Horizontal', 'YouTube e TV'],
  ['9:16', 'Vertical', 'Reels, TikTok e Shorts'],
  ['1:1', 'Quadrado', 'Feed'],
  ['4:5', 'Retrato', 'Instagram'],
  ['2.39:1', 'Cinema', 'Filmes e trailers'],
];

const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
function ago(ms) {
  if (!ms) return '';
  const s = (ms - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return 'agora mesmo';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 14) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Home() {
  const [items, setItems] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('recent');
  const [newOpen, setNewOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const search = useRef(null);
  const notify = useStore((s) => s.notify);

  const load = useCallback(() => window.api.libraryList().then(setItems).catch(() => setItems([])), []);
  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const key = (e) => {
      if (newOpen || e.defaultPrevented) return;
      if (e.key !== 'Escape' && e.target.closest?.('input, textarea, select, [role=dialog]')) return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'n') {
        e.preventDefault();
        setNewOpen(true);
      } else if ((e.ctrlKey || e.metaKey) && k === 'o') {
        e.preventDefault();
        openProject();
      } else if (k === '/' || ((e.ctrlKey || e.metaKey) && k === 'f')) {
        if (document.activeElement !== search.current) {
          e.preventDefault();
          search.current?.focus();
        }
      } else if (k === 'escape') {
        setMenu(null);
        setRenaming(null);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [newOpen]);

  useEffect(() => {
    if (!menu) return;
    const close = (e) => !e.target.closest?.('.proj-menu') && setMenu(null);
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = (items || []).filter((i) => !term || (i.name || '').toLowerCase().includes(term));
    list.sort((a, b) => (sort === 'name' ? (a.name || '').localeCompare(b.name || '', 'pt-BR') : sort === 'long' ? (b.duration || 0) - (a.duration || 0) : (b.modified || 0) - (a.modified || 0)));
    return list;
  }, [items, q, sort]);

  const act = async (fn, okMsg) => {
    try {
      await fn();
      if (okMsg) notify(okMsg);
      load();
    } catch (err) {
      notify(cleanError(err), 'error');
    }
  };
  const remove = async (it) => {
    const ok = await askConfirm({ title: `Excluir "${it.name}"?`, message: 'O projeto vai para a Lixeira do Windows. Os vídeos originais não são apagados.', ok: 'Excluir', danger: true });
    if (ok) act(() => window.api.libraryDelete(it.file), 'Projeto movido para a Lixeira.');
  };
  const commitRename = (it, value) => {
    setRenaming(null);
    const v = value.trim();
    if (v && v !== it.name) act(() => window.api.libraryRename(it.file, v));
  };
  const start = (aspect, templates) => {
    try {
      localStorage.setItem('ve.leftTab', templates ? 'templates' : 'media');
    } catch {}
    setNewOpen(false);
    createProject({ aspect });
  };

  const empty = items && items.length === 0;

  // Arrastar arquivos do Windows para cá cria um projeto com eles.
  const [dropping, setDropping] = useState(false);
  const depth = useRef(0);
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  const drag = {
    onDragEnter: (e) => {
      if (!hasFiles(e)) return;
      depth.current++;
      setDropping(true);
    },
    onDragLeave: (e) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDropping(false);
    },
    onDragOver: (e) => hasFiles(e) && e.preventDefault(),
    onDrop: (e) => {
      depth.current = 0;
      setDropping(false);
      if (!hasFiles(e)) return;
      e.preventDefault();
      createProjectFromFiles(e.dataTransfer.files).catch((err) => notify(cleanError(err), 'error'));
    },
  };

  return (
    <div className="home" {...drag}>
      <div className="home-top">
        <div className="home-top-in">
          <div className="home-brand">
            <Logo size={22} />
            <span>Video Editor</span>
          </div>
        </div>
      </div>

      <main className="home-main">
        <header className="home-head">
          <div>
            <h1>Projetos</h1>
            <p className="muted">{items === null ? 'Carregando…' : empty ? 'Nada por aqui ainda' : `${items.length} ${items.length === 1 ? 'projeto' : 'projetos'}`}</p>
          </div>
          <div className="home-actions">
            <ThemeButton />
            {!empty && (
              <label className="home-search">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
                <input ref={search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar  ( / )" aria-label="Buscar projetos" spellCheck={false} />
              </label>
            )}
            {!empty && (
              <select className="home-sort" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Ordenar">
                <option value="recent">Mais recentes</option>
                <option value="name">Nome</option>
                <option value="long">Mais longos</option>
              </select>
            )}
            <button className="ghost" onClick={openProject} title="Abrir um arquivo .vedit (Ctrl+O)">
              <Icon name="folder" size={16} /> Abrir arquivo
            </button>
            <button className="primary" onClick={() => setNewOpen(true)} title="Novo projeto (Ctrl+N)">
              <Icon name="plus" size={16} /> Novo projeto
            </button>
          </div>
        </header>

        {empty ? (
          <div className="home-empty">
            <div className="home-empty-logo">
              <Logo size={64} />
            </div>
            <h2>Crie seu primeiro vídeo</h2>
            <p className="muted">Seus projetos ficam salvos aqui automaticamente. Arraste vídeos e fotos para esta janela, comece do zero ou use um modelo pronto.</p>
            <div className="home-empty-actions">
              <button className="primary big" onClick={() => setNewOpen(true)}>
                <Icon name="plus" size={18} /> Novo projeto
              </button>
              <button className="secondary big" onClick={() => start('16:9', true)}>
                <Icon name="layout" size={18} /> Começar de um modelo
              </button>
            </div>
          </div>
        ) : (
          <section className="proj-grid" aria-label="Seus projetos">
            <button className="proj-new" onClick={() => setNewOpen(true)} aria-label="Novo projeto">
              <span className="proj-new-plus">
                <Icon name="plus" size={22} />
              </span>
              <span>Novo projeto</span>
            </button>
            {items === null && Array.from({ length: 5 }, (_, i) => <div key={i} className="proj-skel" />)}
            {shown.map((it, i) => (
              <article
                key={it.file}
                className="proj-card"
                style={{ '--i': Math.min(i, 14) }}
                tabIndex={0}
                onClick={() => renaming !== it.file && openLibraryProject(it.file)}
                onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && openLibraryProject(it.file)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenu({ it, x: e.clientX, y: e.clientY });
                }}
              >
                <div className={'proj-thumb' + (it.width && it.height && it.width < it.height ? ' tall' : '')}>
                  {it.thumb ? <img src={it.thumb} alt="" decoding="async" draggable={false} /> : <Logo size={30} />}
                  {it.duration > 0 && <span className="proj-dur">{fmtDuration(it.duration)}</span>}
                  {it.aspect && <span className="proj-aspect">{it.aspect}</span>}
                  <button
                    className="proj-more"
                    aria-label="Mais ações"
                    onClick={(e) => {
                      e.stopPropagation();
                      const r = e.currentTarget.getBoundingClientRect();
                      setMenu({ it, x: r.right, y: r.bottom + 4 });
                    }}
                  >
                    <span aria-hidden="true">⋯</span>
                  </button>
                </div>
                <div className="proj-info">
                  {renaming === it.file ? (
                    <input
                      className="proj-rename"
                      autoFocus
                      defaultValue={it.name}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={(e) => commitRename(it, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.target.blur();
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                    />
                  ) : (
                    <h3 title={it.name}>{it.name || 'Projeto sem título'}</h3>
                  )}
                  <p>
                    {ago(it.modified)}
                    {it.clips != null && ` · ${it.clips} ${it.clips === 1 ? 'clipe' : 'clipes'}`}
                  </p>
                </div>
              </article>
            ))}
            {items && shown.length === 0 && q && <p className="home-none muted">Nenhum projeto com "{q}".</p>}
          </section>
        )}
      </main>

      {menu && (
        <div className="proj-menu" style={{ left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 220) }} role="menu">
          <button role="menuitem" onClick={() => { setMenu(null); openLibraryProject(menu.it.file); }}>
            Abrir
          </button>
          <button role="menuitem" onClick={() => { setRenaming(menu.it.file); setMenu(null); }}>
            Renomear
          </button>
          <button role="menuitem" onClick={() => { const f = menu.it.file; setMenu(null); act(() => window.api.libraryDuplicate(f), 'Projeto duplicado.'); }}>
            Duplicar
          </button>
          <button role="menuitem" onClick={() => { window.api.libraryReveal(menu.it.file); setMenu(null); }}>
            Mostrar na pasta
          </button>
          <hr />
          <button role="menuitem" className="danger" onClick={() => { const it = menu.it; setMenu(null); remove(it); }}>
            Excluir
          </button>
        </div>
      )}

      {dropping && (
        <div className="drop-overlay">
          <div>Solte para criar um projeto com estes arquivos</div>
        </div>
      )}
      {newOpen && <NewProject onClose={() => setNewOpen(false)} onPick={start} />}
    </div>
  );
}

function NewProject({ onClose, onPick }) {
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="newproj" role="dialog" aria-label="Novo projeto">
        <h2>Novo projeto</h2>
        <p className="muted">Escolha o formato. Dá para mudar depois.</p>
        <div className="newproj-grid">
          {FORMATS.map(([id, label, desc]) => {
            const [w, h] = id.includes('.') ? [parseFloat(id), 1] : id.split(':').map(Number);
            const ratio = w / h;
            return (
              <button key={id} className="newproj-tile" onClick={() => onPick(id, false)} autoFocus={id === '16:9'}>
                <span className="newproj-shape-wrap">
                  <span className="newproj-shape" style={{ aspectRatio: ratio, width: ratio >= 1 ? 52 : undefined, height: ratio < 1 ? 52 : undefined }} />
                </span>
                <strong>{label}</strong>
                <span className="muted">{id} · {desc}</span>
              </button>
            );
          })}
        </div>
        <button className="link-btn" onClick={() => onPick('16:9', true)}>
          <Icon name="layout" size={14} /> Ou começar de um modelo pronto
        </button>
      </div>
    </div>
  );
}
