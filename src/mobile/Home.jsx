import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { createProject, fillOne, openLibraryProject, cleanError } from '../ops';
import { Icon, Logo } from '../icons';
import { fmtDuration } from '../util';
import { Sheet, askConfirm, askText, haptic } from './ui';
import { pickFiles } from './files';
import { importWithPrep } from './prep';
import { useInstall } from './install';

const FORMATS = [
  { aspect: '9:16', label: 'Vertical', hint: 'Reels, TikTok, Shorts', w: 9, h: 16 },
  { aspect: '16:9', label: 'Horizontal', hint: 'YouTube, TV', w: 16, h: 9 },
  { aspect: '1:1', label: 'Quadrado', hint: 'Feed', w: 1, h: 1 },
  { aspect: '4:5', label: 'Retrato', hint: 'Feed do Instagram', w: 4, h: 5 },
];

export default function MHome() {
  const [list, setList] = useState(null);
  const [newOpen, setNewOpen] = useState(false);
  const [menu, setMenu] = useState(null);
  const view = useStore((s) => s.view);
  const install = useInstall();

  const reload = useCallback(async () => {
    try {
      setList(await window.api.libraryList());
    } catch {
      setList([]);
    }
  }, []);
  useEffect(() => {
    if (view === 'home') reload();
  }, [view, reload]);

  // "Projeto 1", "Projeto 2"...: um nome diferente para cada um.
  const nextName = () => {
    const used = new Set((list || []).map((p) => p.name));
    let n = (list || []).length + 1;
    while (used.has('Projeto ' + n)) n++;
    return 'Projeto ' + n;
  };

  // Novo projeto a partir da galeria: o seletor tem de abrir direto do toque.
  const fromGallery = async () => {
    const files = await pickFiles();
    if (!files.length) return;
    setNewOpen(false);
    await createProject({ name: nextName() });
    // Cada arquivo entra na linha do tempo assim que fica pronto: o primeiro não espera os outros.
    let n = 0;
    await importWithPrep(files, (m) => fillOne(m, n++ === 0));
    if (n) useStore.getState().notify(`Projeto criado com ${n} ${n === 1 ? 'arquivo' : 'arquivos'}.`);
    useStore.getState().select([]);
  };
  const empty = async (aspect) => {
    setNewOpen(false);
    haptic(8);
    await createProject({ aspect, name: nextName() });
  };

  const rename = async (p) => {
    setMenu(null);
    const name = await askText({ title: 'Renomear projeto', value: p.name, confirm: 'Salvar' });
    if (name) {
      await window.api.libraryRename(p.file, name);
      reload();
    }
  };
  const duplicate = async (p) => {
    setMenu(null);
    await window.api.libraryDuplicate(p.file);
    useStore.getState().notify('Projeto duplicado.');
    reload();
  };
  const remove = async (p) => {
    setMenu(null);
    const ok = await askConfirm({ title: 'Excluir projeto?', message: `“${p.name}” e os arquivos dele neste aparelho serão apagados.`, confirm: 'Excluir', danger: true });
    if (!ok) return;
    try {
      await window.api.libraryDelete(p.file);
      reload();
    } catch (err) {
      useStore.getState().notify('Erro ao excluir: ' + cleanError(err), 'error');
    }
  };

  return (
    <div className="mhome">
      <header className="mhome-head">
        <Logo size={34} />
        <div>
          <h1>Video Editor</h1>
          <p>{list === null ? ' ' : list.length ? `${list.length} ${list.length === 1 ? 'projeto' : 'projetos'}` : 'Comece um projeto'}</p>
        </div>
      </header>

      {install.show && (
        <div className="m-banner">
          <Icon name="import" size={18} />
          <p>{install.ios ? 'Para instalar: toque em Compartilhar e depois em “Adicionar à Tela de Início”.' : 'Instale o app para abrir em tela cheia e guardar seus projetos com segurança.'}</p>
          {install.canPrompt && <button onClick={install.prompt}>Instalar</button>}
          <button className="ghost" onClick={install.dismiss} aria-label="Dispensar">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      {list !== null && list.length === 0 ? (
        <div className="mhome-empty">
          <div className="mhome-empty-art">
            <Icon name="film" size={34} />
          </div>
          <h2>Seu primeiro vídeo começa aqui</h2>
          <p>Escolha vídeos e fotos da galeria e edite com os dedos.</p>
        </div>
      ) : (
        <div className="mgrid">
          {(list || []).map((p) => (
            <ProjectCard key={p.file} p={p} onOpen={() => openLibraryProject(p.file)} onMenu={() => setMenu(p)} />
          ))}
        </div>
      )}

      <div className="mfab-bar">
        <button className="mfab" onClick={() => setNewOpen(true)}>
          <Icon name="plus" size={22} strokeWidth={2.6} />
          Novo projeto
        </button>
      </div>

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title="Novo projeto">
        <button className="mbig" onClick={fromGallery}>
          <span className="mbig-ico">
            <Icon name="image" size={24} />
          </span>
          <span>
            <b>Escolher da galeria</b>
            <small>Vídeos, fotos e músicas do celular</small>
          </span>
        </button>
        <p className="msec">Ou comece em branco</p>
        <div className="mformats">
          {FORMATS.map((f) => (
            <button key={f.aspect} className="mformat" onClick={() => empty(f.aspect)}>
              <span className="mformat-shape" style={{ aspectRatio: `${f.w} / ${f.h}` }} />
              <b>{f.label}</b>
              <small>{f.aspect}</small>
            </button>
          ))}
        </div>
      </Sheet>

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name} action={<span />}>
        <button className="mrow" onClick={() => rename(menu)}>
          <Icon name="text" size={20} /> Renomear
        </button>
        <button className="mrow" onClick={() => duplicate(menu)}>
          <Icon name="duplicate" size={20} /> Duplicar
        </button>
        <button className="mrow danger" onClick={() => remove(menu)}>
          <Icon name="trash" size={20} /> Excluir
        </button>
      </Sheet>
    </div>
  );
}

function ProjectCard({ p, onOpen, onMenu }) {
  const lp = useRef({ timer: 0, fired: false });
  const cancel = () => clearTimeout(lp.current.timer);
  return (
    <div
      className="mcard"
      role="button"
      tabIndex={0}
      onClick={() => {
        if (lp.current.fired) {
          lp.current.fired = false;
          return;
        }
        onOpen();
      }}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={() => {
        lp.current.fired = false;
        lp.current.timer = setTimeout(() => {
          lp.current.fired = true;
          haptic(14);
          onMenu();
        }, 520);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      <div className="mcard-thumb">
        {p.thumb ? <img src={p.thumb} alt="" draggable={false} /> : <Icon name="film" size={26} />}
        {p.duration > 0 && <span className="mcard-dur">{fmtDuration(p.duration)}</span>}
      </div>
      <div className="mcard-info">
        <div>
          <b>{p.name}</b>
          <small>{p.aspect}</small>
        </div>
        <button
          className="m-icon sm"
          aria-label="Mais opções"
          onClick={(e) => {
            e.stopPropagation();
            onMenu();
          }}
        >
          <span className="dots" />
        </button>
      </div>
    </div>
  );
}
