import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// 仓库唯一一份 ESLint 配置（决策 004 第 1 条：不让每个包各写一份，否则迟早漂移）。
//
// 要点：
// - 扁平配置（ESLint 9）。从任意包目录跑 `eslint .` 都会向上找到这一份，
//   files/ignores 按运行时的 cwd 解析，所以类似 **/*.{ts,tsx} 的 glob 就能覆盖该包自己的 src。
// - 不用 typescript-eslint 的类型感知规则（要解析 tsconfig 的 paths / project references，
//   在 7 个 tsconfig 的 monorepo 里代价高、容易误报）；代码已有 tsc strict + noUnusedLocals 兜底。
// - 目标定位是抓住真正的缺陷，不是统一代码风格。
//   所以只保留能抓到 bug 的规则，去掉纯风格项（array-type / consistent-type-imports /
//   prefer-const）—— 那些在 7 个包里会 churn 上百行，但不增加安全性。
export default tseslint.config(
  js.configs.recommended,
  { ignores: ['**/dist/**', '**/node_modules/**', '**/*.cjs', '**/coverage/**', '**/prisma/migrations/**'] },

  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommended, ...tseslint.configs.stylistic],
    rules: {
      // 只保留不需要类型信息的规则（no-floating-promises / await-thenable 等都需要
      // parserOptions.project，在 7 个 tsconfig 的 monorepo 里解析代价高、容易误报）：
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // 我们显式 any 表示这是刻意的占位，不该标红：
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
);
