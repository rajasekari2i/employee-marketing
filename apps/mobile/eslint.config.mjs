// @ts-check
import { createBaseConfig } from '@field-sales/config/eslint-base.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'android/**', 'ios/**'] },
  ...createBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    // React Native has no DOM/node globals of its own worth enumerating here;
    // `__DEV__` is the one RN-specific global every file can reference.
    extraGlobals: { __DEV__: 'readonly' },
  }),
  {
    // Metro/Babel/Tailwind's own config files are read directly by those
    // tools' CLIs outside the app's own module graph, so type-aware linting
    // has no project to check them against.
    files: ['*.config.{js,cjs,ts}', 'babel.config.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    // `postinstall` helper scripts (plain Node CommonJS, run by pnpm outside
    // Metro's bundling entirely) — same reasoning as the config-file override
    // above: not part of `tsconfig.json`'s `include`, so type-aware linting
    // has no project to check them against (found running `pnpm --filter
    // mobile lint` for User Story 2's verification — pre-existing gap from
    // whichever work unit added `scripts/fix-babel-runtime-symlink.js`, not
    // something this story's own files touch).
    files: ['scripts/**/*.js'],
    ...tseslint.configs.disableTypeChecked,
    rules: {
      ...tseslint.configs.disableTypeChecked.rules,
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
