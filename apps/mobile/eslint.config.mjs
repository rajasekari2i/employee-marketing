// @ts-check
import { createBaseConfig } from '@field-sales/config/eslint-base.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', '.expo/**', 'android/**', 'ios/**'] },
  ...createBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    // React Native has no DOM/node globals of its own worth enumerating here;
    // `__DEV__` is the one RN-specific global every file can reference.
    extraGlobals: { __DEV__: 'readonly' },
  }),
  {
    // Expo/Metro/Babel/Tailwind's own config files (including app.config.ts
    // itself) are read directly by those tools' CLIs outside the app's own
    // module graph, so type-aware linting has no project to check them
    // against — the same class of issue, so handled uniformly here, rather
    // than giving app.config.ts its own separate, narrower rule override.
    files: ['*.config.{js,cjs,ts}', 'babel.config.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
