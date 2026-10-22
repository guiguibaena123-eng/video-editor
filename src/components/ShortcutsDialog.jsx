import { Icon } from '../icons';

const GROUPS = [
  ['Reprodução', [['Espaço', 'Reproduzir / pausar'], ['← / →', 'Voltar / avançar 1 quadro'], ['Shift + ← / →', 'Voltar / avançar 1 segundo'], ['Home / End', 'Início / fim'], ['F11', 'Player em tela cheia (Esc sai)']]],
  ['Edição', [['S ou Ctrl + B', 'Dividir no cursor'], ['Delete', 'Excluir seleção'], ['Ctrl + D', 'Duplicar'], ['C', 'Recortar o clipe selecionado'], ['T', 'Adicionar texto no cursor'], ['R', 'Gravar narração'], ['F', 'Congelar quadro na barra branca'], ['K', 'Adicionar keyframe no clipe selecionado'], ['Ctrl + C / V', 'Copiar / colar no cursor'], ['Ctrl + A', 'Selecionar tudo'], ['Ctrl + Z', 'Desfazer'], ['Ctrl + Y', 'Refazer'], ['Shift + clique', 'Adicionar à seleção']]],
  ['Linha do tempo', [['+ / -', 'Mais / menos zoom'], ['Roda do mouse', 'Zoom (no ponto do mouse)'], ['Shift + roda', 'Rolar para os lados'], ['Alt + roda', 'Rolar as trilhas'], ['Arrastar a barra branca', 'Escolher o ponto (rola sozinha nas bordas)'], ['Esc', 'Limpar seleção']]],
  ['Projeto', [['Ctrl + N', 'Novo projeto'], ['Ctrl + O', 'Abrir arquivo .vedit'], ['Ctrl + S', 'Salvar agora (ele também salva sozinho)'], ['Ctrl + Shift + S', 'Salvar uma cópia'], ['Ctrl + I', 'Importar mídia'], ['Ctrl + E', 'Exportar'], ['?', 'Abrir esta janela']]],
];

const COLUMNS = [['Reprodução', 'Linha do tempo', 'Projeto'], ['Edição']];

export default function ShortcutsDialog({ onClose }) {
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal shortcuts" role="dialog" aria-label="Atalhos de teclado">
        <div className="modal-head">
          <h2>Atalhos de teclado</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
        <div className="shortcut-grid">
          {COLUMNS.map((titles, i) => (
            <div key={i}>
              {GROUPS.filter(([title]) => titles.includes(title)).map(([title, items]) => (
                <section key={title}>
                  <h3>{title}</h3>
                  {items.map(([keys, label]) => (
                    <div className="shortcut" key={keys}>
                      <span>{label}</span>
                      <kbd>{keys}</kbd>
                    </div>
                  ))}
                </section>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
