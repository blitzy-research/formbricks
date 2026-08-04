import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Guards the build order that the survey packages' test suites depend on.
 *
 * Two workspace packages are consumed through their BUILT output rather than their source, because their
 * manifests point `types` and the `exports` map at `dist`:
 *
 *  - `@formbricks/survey-ui` is imported by the respondent runtime, and `packages/surveys` renders the real
 *    control - not a mock - in its production-alias regression suite.
 *  - `@formbricks/surveys/validation` is imported by this application's server-side validation wrapper, and
 *    `validation-integration.test.ts` deliberately calls the real evaluator through it.
 *
 * Neither `dist` directory is committed - both are git-ignored - and continuous integration runs `pnpm test`
 * immediately after `pnpm install`. Without an explicit task dependency the runner would therefore resolve a
 * stale build or fail to resolve the package at all, and which of those happened would depend on whatever a
 * developer's machine had built earlier. Turbo is what makes the ordering deterministic, and the declarations
 * below are the whole of that guarantee, so they are pinned here rather than left to be rediscovered by a
 * confusing module-resolution failure.
 *
 * This is a configuration assertion rather than a behavioural one, and it is deliberately narrow: it checks
 * that each dependency is declared, not how the rest of the task graph is shaped.
 */

interface TurboConfig {
  tasks: Record<string, { dependsOn?: string[] } | undefined>;
}

const turboConfigPath = path.resolve(__dirname, "../../../../turbo.json");
const turboConfig = JSON.parse(fs.readFileSync(turboConfigPath, "utf-8")) as TurboConfig;

const dependenciesOf = (task: string): string[] => turboConfig.tasks[task]?.dependsOn ?? [];

describe("turbo test task build order", () => {
  test.each([
    ["@formbricks/surveys#test", "@formbricks/survey-ui#build"],
    ["@formbricks/surveys#test:coverage", "@formbricks/survey-ui#build"],
    ["@formbricks/web#test", "@formbricks/surveys#build"],
    ["@formbricks/web#test:coverage", "@formbricks/surveys#build"],
  ])("%s must depend on %s", (task, dependency) => {
    expect(dependenciesOf(task)).toContain(dependency);
  });

  test("the web test task keeps the build dependencies it already had", () => {
    // Added to rather than replaced: dropping any of these breaks unrelated suites that resolve those packages
    // through their own built output.
    expect(dependenciesOf("@formbricks/web#test")).toEqual(
      expect.arrayContaining([
        "@formbricks/logger#build",
        "@formbricks/database#build",
        "@formbricks/storage#build",
        "@formbricks/cache#build",
      ])
    );
  });

  test("building the runtime package still builds the design-system package first", () => {
    // The transitive half of the guarantee: `@formbricks/web#test` depends on the runtime build, which is only
    // correct if that build itself waits for the component library it bundles.
    expect(dependenciesOf("@formbricks/surveys#build")).toContain("@formbricks/survey-ui#build");
  });
});
