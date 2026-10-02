/// <reference types="nativewind/types" />

// Allows `import './global.css'` (a side-effect import Metro/NativeWind
// handles at build time) to type-check under TypeScript's strict/isolatedModules
// settings, which otherwise reject an import with no type declarations.
declare module '*.css';

// Allows `require('../../assets/logo.png')` (components/AppLogo.tsx, User
// Story 2) to type-check — Metro's static asset pipeline resolves a `.png`
// require to a numeric/`ImageSourcePropType` module id at build time, which
// has no type declaration of its own unless one is declared here (the
// now-deprecated `@types/react-native` used to ship this ambient
// declaration; this app has no dependency on that package).
declare module '*.png' {
  import type { ImageSourcePropType } from 'react-native';
  const value: ImageSourcePropType;
  export default value;
}
