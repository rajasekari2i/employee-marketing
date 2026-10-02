// @ts-check
import { createBaseConfig } from '@field-sales/config/eslint-base.mjs';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**'] },
  ...createBaseConfig({ tsconfigRootDir: import.meta.dirname }),
  {
    // tsup.config.ts is a build tool's own config file, not part of the
    // package's published source (tsconfig.json's `include` is just "src"),
    // so type-aware rules have no project to check it against.
    files: ['*.config.ts'],
    ...tseslint.configs.disableTypeChecked,
  },
);
