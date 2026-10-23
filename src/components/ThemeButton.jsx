import { Icon } from '../icons';
import { useTheme, toggleTheme } from '../theme';

// Alterna entre tema escuro e claro.
export default function ThemeButton() {
  const theme = useTheme();
  const next = theme === 'dark' ? 'claro' : 'escuro';
  return (
    <button className="theme-btn" onClick={toggleTheme} title={`Tema ${next} (Ctrl+Shift+L)`} aria-label={`Mudar para o tema ${next}`}>
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={18} />
    </button>
  );
}
