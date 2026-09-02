import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTs from 'eslint-config-next/typescript'
import globals from 'globals'

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // .cjs/.mjs 基础设施脚本（worker / 测试 / 冒烟）：CommonJS，跑在 Node 环境
  {
    files: ['**/*.cjs', '**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      // .cjs/.mjs 是 CommonJS 基础设施脚本，require 是标准写法
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  globalIgnores([
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
    '.cache/**',
    'fixtures/**',
  ]),
])

export default eslintConfig
