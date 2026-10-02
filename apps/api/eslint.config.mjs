// @ts-check
import { createBaseConfig } from '@field-sales/config/eslint-base.mjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...createBaseConfig({
    tsconfigRootDir: import.meta.dirname,
    extraGlobals: globals.jest,
  }),
  {
    languageOptions: {
      sourceType: 'commonjs',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
