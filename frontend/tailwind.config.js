/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background) / <alpha-value>)',
        foreground: 'hsl(var(--foreground) / <alpha-value>)',
        card: {
          DEFAULT: 'hsl(var(--card) / <alpha-value>)',
          foreground: 'hsl(var(--card-foreground) / <alpha-value>)',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover) / <alpha-value>)',
          foreground: 'hsl(var(--popover-foreground) / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary) / <alpha-value>)',
          foreground: 'hsl(var(--primary-foreground) / <alpha-value>)',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary) / <alpha-value>)',
          foreground: 'hsl(var(--secondary-foreground) / <alpha-value>)',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted) / <alpha-value>)',
          foreground: 'hsl(var(--muted-foreground) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent) / <alpha-value>)',
          foreground: 'hsl(var(--accent-foreground) / <alpha-value>)',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive) / <alpha-value>)',
          foreground: 'hsl(var(--destructive-foreground) / <alpha-value>)',
        },
        border: 'hsl(var(--border) / <alpha-value>)',
        input: 'hsl(var(--input) / <alpha-value>)',
        ring: 'hsl(var(--ring) / <alpha-value>)',
        // Custom design tokens
        surface: {
          primary: 'hsl(var(--surface-primary, 0 0% 4%) / <alpha-value>)',
          secondary: 'hsl(var(--surface-secondary, 0 0% 10%) / <alpha-value>)',
          tertiary: 'hsl(var(--surface-tertiary, 0 0% 15%) / <alpha-value>)',
          inverse: 'hsl(var(--surface-inverse, 0 0% 100%) / <alpha-value>)',
        },
        fg: {
          primary: 'hsl(var(--fg-primary, 0 0% 100%) / <alpha-value>)',
          secondary: 'hsl(var(--fg-secondary, 240 4% 66%) / <alpha-value>)',
          muted: 'hsl(var(--fg-muted, 240 4% 47%) / <alpha-value>)',
          inverse: 'hsl(var(--fg-inverse, 0 0% 4%) / <alpha-value>)',
        },
        success: 'hsl(var(--success, 142 71% 45%) / <alpha-value>)',
        warning: 'hsl(var(--warning, 38 92% 50%) / <alpha-value>)',
        error: 'hsl(var(--error, 0 84% 60%) / <alpha-value>)',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'monospace'],
      },
    },
  },
  plugins: [require('tailwindcss-animate'), require('tailwind-scrollbar')],
}
