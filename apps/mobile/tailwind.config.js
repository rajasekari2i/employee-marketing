const sharedPreset = require('@field-sales/config/tailwind-preset');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // nativewind/preset must be included for NativeWind's Metro/Babel pipeline
  // to recognise this as a NativeWind-enabled Tailwind config; the shared
  // field-sales preset layers the brand theme on top of it.
  presets: [require('nativewind/preset'), sharedPreset],
  content: ['./App.tsx', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
