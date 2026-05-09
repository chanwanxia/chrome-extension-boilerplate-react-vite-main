import { fixupConfigRules } from '@eslint/compat';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import { flatConfigs as importXFlatConfig } from 'eslint-plugin-import-x';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactPlugin from 'eslint-plugin-react';
import globals from 'globals';
const { browser, es2020, node } = globals;

export default [
  js.configs.recommended,
  jsxA11y.flatConfigs.recommended,
  importXFlatConfig.recommended,
  ...fixupConfigRules(new FlatCompat().extends('plugin:react-hooks/recommended')),
  {
    ignores: [
      '**/build/**',
      '**/dist/**',
      '**/node_modules/**',
      'chrome-extension/manifest.js',
      'tests/e2e/**',
      'pages/popup/src/bilibili/**',
      'packages/hmr/lib/injections/**',
    ],
  },
  {
    files: ['**/*.{js,jsx,cjs,mjs}'],
    ...reactPlugin.configs.flat.recommended,
    ...reactPlugin.configs.flat['jsx-runtime'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
      globals: {
        ...browser,
        ...es2020,
        ...node,
        chrome: 'readonly',
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/jsx-uses-vars': 'error',
      'prefer-const': 'error',
      'no-var': 'off',
      'no-restricted-imports': [
        'error',
        {
          name: 'type-fest',
          message: 'Please import from `@extension/shared` instead of `type-fest`.',
        },
      ],
      'arrow-body-style': ['error', 'as-needed'],
      'import-x/newline-after-import': 'off',
      'import-x/order': 'off',
      'import-x/export': 'off',
      'import-x/no-unresolved': 'off',
      'import-x/no-named-as-default': 'error',
      'import-x/no-named-as-default-member': 'error',
      'import-x/no-deprecated': 'error',
      'import-x/no-duplicates': ['error', { considerQueryString: true, 'prefer-inline': false }],
      'import-x/exports-last': 'off',
      'import-x/first': 'error',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  {
    files: ['**/packages/shared/**/*.{js,jsx,cjs,mjs}'],
    rules: {
      'no-restricted-imports': 'off',
    },
  },
];
