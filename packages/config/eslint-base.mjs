// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Shared ESLint flat-config base for every app/package in the field-sales
 * monorepo. Each consumer's own `eslint.config.mjs` calls this with its
 * `tsconfigRootDir` (for type-aware linting) and any extra globals its
 * runtime needs (e.g. browser/react-native globals for apps/mobile), then
 * spreads the result and layers project-specific rule overrides after it.
 */
export function createBaseConfig({ tsconfigRootDir, extraGlobals = {} } = {}) {
  return tseslint.config(
    { ignores: ['eslint.config.mjs', 'dist/**', 'build/**', '.expo/**'] },
    eslint.configs.recommended,
    ...tseslint.configs.recommendedTypeChecked,
    eslintPluginPrettierRecommended,
    {
      languageOptions: {
        globals: { ...globals.node, ...extraGlobals },
        parserOptions: tsconfigRootDir
          ? { projectService: true, tsconfigRootDir }
          : undefined,
      },
    },
  );
}
