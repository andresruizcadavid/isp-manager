/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    screens: {
      xs:   '375px',
      sm:   '640px',
      md:   '768px',
      lg:   '1024px',
      xl:   '1280px',
      '2xl':'1536px'
    },
    extend: {
      colors: {
        brand: {
          900: '#1a2f7a',   // hover sidebar / pressed
          800: '#1e3a8a',   // sidebar bg / primary button bg
          700: '#2040a0',   // sidebar item hover bg
          600: '#2C4EC7',   // brand primary — login bg / active nav
          500: '#3b63d4',   // button hover
          400: '#6b8fe8',   // light blue accents
          200: '#a8c0f4',   // sub-nav inactive on dark
          100: '#dde8ff',   // subtle backgrounds / muted text on dark
          50:  '#f0f4ff',   // almost-white blue tint
        },
        text: {
          primary:   '#0f172a',   // on light bg
          secondary: '#475569',   // on light bg
          muted:     '#94a3b8',   // on light bg only
          inverse:   '#ffffff',   // on dark/brand bg
          'inverse-muted': '#bfcfee', // on brand-800/900
        },
        surface: {
          page:    '#f8fafc',
          card:    '#ffffff',
          sidebar: '#1e3a8a',
        }
      }
    }
  },
  plugins: []
}
