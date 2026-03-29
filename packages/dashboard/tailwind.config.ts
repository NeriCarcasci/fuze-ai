import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'bg-primary': '#0a0a0f',
        'bg-surface': '#12121f',
        'bg-elevated': '#1a1a2e',
        'bg-border': '#222240',
        'accent-primary': '#ff5544',
        'accent-orange': '#ff6b35',
        'text-primary': '#ffffff',
        'text-secondary': '#8888aa',
        'text-muted': '#555570',
        'color-success': '#27ae60',
        'color-warning': '#f39c12',
        'color-error': '#e74c3c',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
        body: ['Inter', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config
