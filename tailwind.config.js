/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{tsx,ts,html}'],
  theme: {
    extend: {
      colors: {
        purple: {
          400: '#c084fc',
          500: '#a855f7',
          600: '#9b5cf6',
          700: '#7c3aed',
          800: '#6d28d9',
          900: '#4c1d95',
        }
      }
    }
  },
  plugins: []
};
