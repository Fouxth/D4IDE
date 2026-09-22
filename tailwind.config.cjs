/**
 * D4IDE design tokens (spec §58-§59).
 *
 * Colours are driven by CSS variables declared in `src/renderer/index.css`, so a
 * future light theme is one variable block away. The palette is deliberately
 * near-black rather than blue-black: background is true black, panels are
 * charcoal, borders are barely visible, and teal is the single accent.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        d4: {
          bg: 'rgb(var(--d4-bg) / <alpha-value>)',
          panel: 'rgb(var(--d4-panel) / <alpha-value>)',
          surface: 'rgb(var(--d4-surface) / <alpha-value>)',
          subtle: 'rgb(var(--d4-subtle) / <alpha-value>)',
          border: 'rgb(var(--d4-border) / <alpha-value>)',
          'border-subtle': 'rgb(var(--d4-border-subtle) / <alpha-value>)',
          text: 'rgb(var(--d4-text) / <alpha-value>)',
          muted: 'rgb(var(--d4-muted) / <alpha-value>)',
          dimmed: 'rgb(var(--d4-dimmed) / <alpha-value>)',
          accent: 'rgb(var(--d4-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--d4-accent-hover) / <alpha-value>)',
          'accent-subtle': 'rgb(var(--d4-accent) / 0.15)',
          bubble: 'rgb(var(--d4-bubble) / <alpha-value>)',
          'bubble-text': 'rgb(var(--d4-bubble-text) / <alpha-value>)',
          success: 'rgb(var(--d4-success) / <alpha-value>)',
          warning: 'rgb(var(--d4-warning) / <alpha-value>)',
          error: 'rgb(var(--d4-error) / <alpha-value>)',
          info: 'rgb(var(--d4-info) / <alpha-value>)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'Noto Sans Thai', 'Leelawadee UI', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'monospace']
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px'
      },
      keyframes: {
        'd4-fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'd4-pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' }
        }
      },
      animation: {
        'd4-fade-up': 'd4-fade-up 160ms ease-out',
        'd4-pulse-soft': 'd4-pulse-soft 1.4s ease-in-out infinite'
      }
    }
  },
  plugins: []
};
