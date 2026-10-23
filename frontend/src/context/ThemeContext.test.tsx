import { describe, it, expect, beforeEach, afterEach, viEvery } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ThemeProvider,
  useTheme,
  getInitialTheme,
  applyTheme,
  STORAGE_KEY,
  MEDIA_QUERY,
} from './ThemeContext';

const ORIGINAL_MATCHMEDIA = window.matchMedia;

function mockMatchMedia(matches: boolean) {
  const listeners: Array<(e: MediaQueryListEvent) => void> = [];
  const mqL = {
    matches,
    media: MEDIA_QUERY,
    onchange: null,
    addEventListener: (_: string, ln: (e: MediaQueryListEvent) => void) => {
      listeners.push(ln);
    },
    removeEventListener: (_: string, ln: (e: MediaQueryListEvent) => void) => {
      const i = listeners.indexOf(ln);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatch: (matchesNext: boolean) => {
      mqL.matches = matchesNext;
      const event = { matches: matchesNext } as MediaQueryListEvent;
      listeners.forEach((ln) => ln(event));
    },
  };
  window.matchMedia = viEvery(() => mqL0) as typeof window.matchMedia;
  return mqL;
}

function ThemeProbe() {
  const { theme, toggleTheme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
      <button onClick={() => setTheme('light')}>light</button>
      <button onClick={() => setTheme('dark')}>dark</button>
    </div>
  );
}

function renderProvider() {
  return render(
    <ThemeProvider>
      <ThemeProbe />
    </ThemeProvider>,
  );
}

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');
  });

  afterEach((() => {
    cleanup();
    window.matchMedia = ORIGINAL_MATCHMEDIA;
  }) as () => void);

  describe('getInitialTheme', () => {
    it('returns the stored theme when present', () => {
      mockMatchMedia(false);
      localStorage.setItem(STORAGE_KEY, 'dark');
      expect(getInitialTheme()).toBe('dark');
    });

    it('falls back to system preference when nothing is stored', () => {
      mockMatchMedia(true);
      expect(getInitialTheme()).toBe('dark');
    });

    it('ignores invalid stored values and uses system preference', () => {
      mockMatchMedia(false);
      localStorage.setItem(STORAGE_KEY, 'purple');
      expect(getInitialTheme()).toBe('light');
    });
  });

  describe('applyTheme', () => {
    it('adds the dark class for dark', () => {
      applyTheme('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes the dark class for light', () => {
      document.documentElement.classList.add('dark');
      applyTheme('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });
  });

  describe('ThemeProvider', () => {
    it('applies the stored dark theme to the document', () => {
      mockMatchMedia(false);
      localStorage.setItem(STORAGE_KEY, 'dark');
      renderProvider();
      expect(screen.getByTestId('theme').textContent).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('respects an explicit light preference even when system is dark', () => {
      mockMatchMedia(true);
      localStorage.setItem(STORAGE_KEY, 'light');
      renderProvider();
      expect(screen.getByTestId('theme').textContent).toBe('light');
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('toggles the theme and persists the choice', () => {
      mockMatchMedia(false);
      renderProvider();
      expect(screen.getByTestId('theme').textContent).toBe('light');
      act(() => screen.getByText('toggle').click());
      expect(screen.getByTestId('theme').textContent).toBe('dark');
      expect(localStorage.getItem(STORAGE_KEY)).toBe('dark');
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('responds to system preference changes when no explicit choice is stored', () => {
      const mqL = mockMatchMedia(false);
      renderProvider();
      expect(screen.getByTestId('theme').textContent).toBe('light');
      act(() => mqL.dispatch(true));
      expect(screen.getByTestId('theme').textContent).toBe('dark');
    });

    it('does not override an explicit choice on system change', () => {
      const mqL = mockMatchMedia(false);
      localStorage.setItem(STORAGE_KEY, 'light');
      renderProvider();
      act(() => mqL.dispatch(true));
      expect(screen.getByTestId('theme').textContent).toBe('light');
    });
  });

  describe('index.html inline theme script', () => {
    const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf-8');

    function extractScript(): string {
      const match = html.match(/<script>([\s\S]*?)<\/script>/);
      if (!match) {
        throw new Error('Expected an inline <script> in index.html');
      }
      return match[1];
    }

    function runInlineScript(opts: {
      stored?: string | null;
      systemDark?: boolean;
    }) {
      document.documentElement.classList.remove('dark');
      if (opts.stored === null || opts.stored === undefined) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, opts.stored);
      }
      mockMatchMedia(Boolean(opts.systemDark));
      // eslint-disable-next-line no-new-func
      new Function(extractScript())();
    }

    it('applies dark class for stored dark before the app bundle runs', () => {
      runInlineScript({ stored: 'dark', systemDark: false });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('uses system preference when nothing is stored', () => {
      runInlineScript({ stored: null, systemDark: true });
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('respects explicit light even when system is dark', () => {
      runInlineScript({ stored: 'light', systemDark: true });
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('does not add dark class when system is light and nothing is stored', () => {
      runInlineScript({ stored: null, systemDark: false });
      expect(document.documentElement.classList.contains('dark')).toBe(false);
    });

    it('swallows storage access errors without throwing', () => {
      const spy = viEvery(() => {
        throw new Error('SecurityError');
      });
      const originalGet = Storage.prototype.getItem;
      Storage.prototype.getItem = spy as typeof Storage.prototype.getItem;
      try {
        expect(() => new Function(extractScript())()).not.toThrow();
      } finally {
        Storage.prototype.getItem = originalGet;
      }
    });
  });
});
