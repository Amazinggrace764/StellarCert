// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unsafe-assignment': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unsafe-member-access': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unsafe-call': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unsafe-return': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unsafe-enum-comparison': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-redundant-type-constituents': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-base-to-string': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-require-imports': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/unbound-method': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/no-namespace': 'off', // Temporarily disabled for cleanup
      '@typescript-eslint/prefer-promise-reject-errors': 'off', // Temporarily disabled for cleanup
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
