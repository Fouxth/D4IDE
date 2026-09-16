/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        d4: {
          bg: '#0B0D11',
          panel: '#12151B',
          surface: '#181C24',
          subtle: '#212632',
          border: '#282F3E',
          'border-subtle': '#1F2430',
          text: '#F1F5F9',
          muted: '#94A3B8',
          dimmed: '#64748B',
          accent: '#14B8A6',
          'accent-hover': '#0D9488',
          'accent-subtle': 'rgba(20, 184, 166, 0.15)',
          success: '#10B981',
          warning: '#F59E0B',
          error: '#EF4444',
          info: '#3B82F6',
        }
      },
      fontFamily: {
        sans: [
          'Inter',
          'Noto Sans Thai',
          'Leelawadee UI',
          'Segoe UI',
          'system-ui',
          'sans-serif'
        ],
        mono: [
          'JetBrains Mono',
          'Fira Code',
          'Cascadia Code',
          'Consolas',
          'monospace'
        ]
      },
      borderRadius: {
        'sm': '6px',
        'md': '10px',
        'lg': '14px',
      }
    },
  },
  plugins: [],
};
