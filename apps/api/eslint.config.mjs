// @ts-check
/**
 * Configuracion plana de ESLint 9 para la API.
 *
 * Existia `eslint ^9.18.0` en las dependencias y el script `lint`, pero NINGUN
 * archivo de configuracion: ESLint 9 exige el formato plano y, sin el, el script
 * no corre. No es que pasara el lint — no se ejecutaba nunca.
 */
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: { process: 'readonly', console: 'readonly', Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly' },
    },
    rules: {
      // Nest usa decoradores y clases vacias como DTO: no son un defecto.
      '@typescript-eslint/no-extraneous-class': 'off',
      // Los `any` heredados se marcan, pero no frenan el lint mientras se saldan.
      // Lo que se descarta a proposito se nombra con guion bajo: '_n', '_l'.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    files: ['**/*.spec.ts'],
    languageOptions: {
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', jest: 'readonly' },
    },
  },
);
