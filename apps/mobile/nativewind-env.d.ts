/// <reference types="nativewind/types" />

// Allows `import './global.css'` (a side-effect import Metro/NativeWind
// handles at build time) to type-check under TypeScript's strict/isolatedModules
// settings, which otherwise reject an import with no type declarations.
declare module '*.css';
