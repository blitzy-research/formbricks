module.exports = {
  extends: ["@formbricks/eslint-config/react.js"],
  ignorePatterns: ["**/*.stories.tsx", "**/*.stories.ts", "story-helpers.tsx", "**/*.test.ts"],
  overrides: [
    {
      // Colocated component specs (`*.test.tsx`, or any `.tsx` under `__tests__`) drive the
      // components with Testing Library. This package intentionally does not declare those
      // packages itself: they are declared once by `apps/web` and reach every workspace project
      // through pnpm's hoisted layout (`.npmrc` -> `node-linker=hoisted`, `shamefully-hoist`).
      // Reporting them as extraneous is therefore a false positive, so the dependency rule is
      // relaxed for test sources only — it stays fully enforced for every production source file
      // in this package, which is what stops a shipped component importing an undeclared package.
      files: ["**/*.test.tsx", "**/__tests__/**/*.tsx"],
      rules: {
        "import/no-extraneous-dependencies": "off",
      },
    },
  ],
};

