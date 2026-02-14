/** @type {import('tailwindcss').Config} */
export default {
  content: ['./client/src/**/*.{js,ts,jsx,tsx}', './client/index.html'],
  theme: {
    extend: {
      colors: {
        brand: { 50: '#f0f7ff', 100: '#e0effe', 200: '#bae0fd', 300: '#7cc8fc', 400: '#36adf8', 500: '#0c93e9', 600: '#0074c7', 700: '#005da1', 800: '#044f85', 900: '#0a426e' },
        risk: { low: '#22c55e', moderate: '#eab308', high: '#f97316', critical: '#ef4444' },
      },
    },
  },
  plugins: [],
};
