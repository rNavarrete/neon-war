import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules',
      'node_modules/**',
      'check-logs/**',
      'test-results/**',
      'playwright-report/**',
      '.claude/skills/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    rules: {
      // CLAUDE.md: never put user data into HTML; build nodes and use textContent.
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Use textContent or DOM nodes instead.' },
        { property: 'outerHTML', message: 'Use textContent or DOM nodes instead.' },
        { property: 'insertAdjacentHTML', message: 'Use textContent or DOM nodes instead.' },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,mjs}', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.vitest } },
  },
);
