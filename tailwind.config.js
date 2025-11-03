/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        primary: '#0f1724',
        accent: '#06b6d4',
        accent2: '#7c3aed'
      }
    }
  },
  plugins: [],
}