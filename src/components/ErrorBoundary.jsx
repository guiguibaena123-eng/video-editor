import { Component } from 'react';
import { useStore } from '../store';
import { saveToLibrary } from '../library';
import { Icon } from '../icons';

// Se um painel falhar ao desenhar, só ele mostra o aviso; o resto do editor segue funcionando e
// o projeto é salvo na biblioteca. "resetKeys" mudando (ex.: outra seleção) tenta desenhar de novo.
// Sem "panel", é a rede de segurança da janela inteira.
export default class ErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', this.props.panel || 'app', error, info?.componentStack);
    // Guarda o trabalho antes de qualquer outra coisa.
    saveToLibrary({ thumb: false }).catch(() => {});
  }

  componentDidUpdate(prev) {
    if (!this.state.error) return;
    const a = prev.resetKeys || [];
    const b = this.props.resetKeys || [];
    if (a.length !== b.length || a.some((v, i) => v !== b[i])) this.setState({ error: null });
  }

  retry = () => this.setState({ error: null });

  home = () => {
    this.setState({ error: null });
    useStore.setState({ view: 'home' });
  };

  copy = () => {
    const e = this.state.error;
    navigator.clipboard?.writeText(`${e?.message}\n${e?.stack || ''}`).then(
      () => useStore.getState().notify('Detalhes copiados.'),
      () => {},
    );
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { panel } = this.props;
    if (panel) {
      return (
        <div className="boundary boundary-panel" role="alert">
          <Icon name="warning" size={22} />
          <strong>{panel} não pôde ser mostrado</strong>
          <span className="muted small-text">Seu projeto está salvo. O resto do editor continua funcionando.</span>
          <div className="boundary-actions">
            <button className="secondary" onClick={this.retry}>Tentar de novo</button>
            <button className="ghost" onClick={this.copy}>Copiar detalhes</button>
          </div>
        </div>
      );
    }
    return (
      <div className="boundary boundary-app" role="alert">
        <div className="boundary-card">
          <Icon name="warning" size={28} />
          <h2>Algo deu errado</h2>
          <p className="muted">O editor encontrou um erro inesperado. Seu projeto foi salvo automaticamente na biblioteca.</p>
          <div className="boundary-actions">
            <button className="primary" onClick={this.retry}>Tentar de novo</button>
            <button className="secondary" onClick={this.home}>Ir para os projetos</button>
            <button className="ghost" onClick={() => window.location.reload()}>Reiniciar o editor</button>
          </div>
          <button className="link-btn" onClick={this.copy}>Copiar detalhes do erro</button>
        </div>
      </div>
    );
  }
}
