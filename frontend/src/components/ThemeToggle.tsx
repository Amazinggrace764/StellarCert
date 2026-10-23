import { Moon, Sun } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export default function ThemeToggle(): JSX.Element {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      onClick={toggleTheme}
      className={`
        inline-flex items-center justify-center p-2 rounded-lg
        transition-all duration-250 ease-in-out
        hover:bg-gray-100 dark:hover:bg-slate-800
        text-gray-700 dark:text-slate-300
        border border-gray-200 dark:border-slate-700
        hover:border-gray-300 dark:hover:border-slate-600
        focus:outline-none focus:ring-2 focus:ring-primary/50
      `}
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      title={`Current theme: ${theme}`}
    >
      {theme === 'dark' ? (
        <Sun className="h-5 w-5 transition-transform duration-250" />
      ) : (
        <Moon className="h-5 w-5 transition-transform duration-250" />
      )}
    </button>
  );
}
