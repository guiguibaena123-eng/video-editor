import { useStore } from '../store';
import { Icon } from '../icons';

export default function Toast() {
  const toast = useStore((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" key={toast.id}>
      {toast.kind === 'error' && <Icon name="warning" size={16} />}
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            useStore.setState({ toast: null });
            toast.action.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="icon-btn" onClick={() => useStore.setState({ toast: null })} aria-label="Fechar">
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}
