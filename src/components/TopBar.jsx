import { useState } from 'react';
import { useStore } from '../store';
import { Icon, Logo } from '../icons';
import { goHome, saveProject } from '../ops';

export default function TopBar({ onShortcuts }) {
  const name = useStore((s) => s.project.name);
  const dirty = useStore((s) => s.dirty);
  const saving = useStore((s) => s.saving);
  const hasClips = useStore((s) => s.project.clips.length > 0);
  const [editing, setEditing] = useState(false);

  const rename = (value) => {
    setEditing(false);
    const v = value.trim();
    if (v && v !== name) useStore.getState().commit((p) => { p.name = v; });
  };

  return (
    <header className="topbar">
      <button className="brand brand-btn" onClick={goHome} title="Voltar para os projetos">
        <Logo size={24} />
        <span>Projetos</span>
      </button>
      <nav className="menu">
        <button className="ghost" onClick={() => saveProject(false)} title="Salvar agora (o projeto também salva sozinho) · Ctrl+S · Salvar uma cópia: Ctrl+Shift+S">
          <Icon name="save" size={16} /> Salvar
        </button>
        <button className="ghost" onClick={onShortcuts} title="Atalhos de teclado (?)">
          <Icon name="keyboard" size={16} /> Atalhos
        </button>
      </nav>
      <div className="title">
        {editing ? (
          <input
            autoFocus
            defaultValue={name}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.target.blur();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
        ) : (
          <button className="title-btn" onClick={() => setEditing(true)} title="Renomear projeto">
            {name}
          </button>
        )}
      </div>
      <span className={'save-state' + (dirty || saving ? ' busy' : '')} role="status" title="O projeto salva sozinho na pasta Documentos\Video Editor\Projetos">
        <i />
        {dirty || saving ? 'Salvando…' : 'Salvo'}
      </span>
      <button className="primary export-btn" disabled={!hasClips} onClick={() => useStore.setState({ exportOpen: true })} title="Exportar (Ctrl+E)">
        <Icon name="export" size={16} /> Exportar
      </button>
    </header>
  );
}
