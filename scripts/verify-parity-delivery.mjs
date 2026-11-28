import { spawn } from "node:child_process";
import {
  createHash,
} from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

const root = process.cwd();
const qaDir = path.join(root, ".qa");
mkdirSync(qaDir, { recursive: true });

const run = (args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) =>
      code === 0
        ? resolve()
        : reject(
            new Error(
              `${args.join(" ")} failed: exit=${code}, signal=${signal || "none"}`,
            ),
          ),
    );
  });

const sha256 = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");

const rel = (file) => path.relative(root, file).replaceAll("\\", "/");

const requiredVisuals = [
  ".qa/phase1-editor-mixed-tabs.png",
  ".qa/phase1-database-dashboard.png",
  ".qa/phase2-work-surfaces-calendar.png",
  ".qa/phase2-work-surfaces-timeline.png",
  ".qa/phase2-work-surfaces-gallery.png",
  ".qa/phase3-workspace-workspace.png",
];

const report = {
  kind: "life-atlas-core-parity-delivery",
  startedAt: new Date().toISOString(),
  passed: false,
};

try {
  const unitTests = readdirSync(path.join(root, "tests"))
    .filter((file) => file.endsWith(".test.mjs"))
    .map((file) => `tests/${file}`);

  await run(["--test", "--test-reporter=spec", ...unitTests]);
  await run(["tests/core-parity-browser.mjs"]);

  // Equivalent to npm run build, but kept inside this verifier so the exact
  // delivery check remains one deterministic command.
  await run(["node_modules/vite/bin/vite.js", "build"]);
  await run(["scripts/prepare-sites-build.mjs"]);

  const browserReport = JSON.parse(
    readFileSync(path.join(qaDir, "core-parity-browser.json"), "utf8"),
  );
  if (!browserReport.passed || browserReport.totalChecks < 35) {
    throw new Error("Core parity browser report is incomplete");
  }

  const requiredArtifacts = [
    "dist/client/index.html",
    "dist/server/index.js",
    "dist/.openai/hosting.json",
    "src/editor/LifeAtlasSideMenuController.jsx",
    "tests/core-parity-phase1.test.mjs",
    "tests/core-parity-phase2.test.mjs",
    "tests/core-parity-phase3.test.mjs",
    "tests/core-parity-browser.mjs",
    "scripts/verify-parity-delivery.mjs",
    ...requiredVisuals,
  ];

  for (const relative of requiredArtifacts) {
    const absolute = path.join(root, relative);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(`Missing delivery artifact: ${relative}`);
    }
  }

  const checksums = Object.fromEntries(
    requiredArtifacts.map((relative) => [
      relative,
      sha256(path.join(root, relative)),
    ]),
  );

  const manifest = {
    kind: "life-atlas-core-parity-manifest",
    generatedAt: new Date().toISOString(),
    browserScenarios: browserReport.results,
    browserChecks: browserReport.totalChecks,
    checksums,
    phase4Implemented: false,
  };
  writeFileSync(
    path.join(qaDir, "core-parity-delivery-manifest.json"),
    JSON.stringify(manifest, null, 2),
  );

  const acceptance = `# Life Atlas Core-Parity Implementation & Acceptance Report

Generated: ${manifest.generatedAt}

## Scope

Implemented and verified the handoff's Phase 1, Phase 2 and Phase 3 only. Phase 4 remains planning-only: no IndexedDB workspace migration, realtime collaboration/Yjs/WebSocket, cloud asset backend, permissions backend or multi-device sync was added.

## Key delivered behavior

- Phase 1: native nested Tabs, canonical synced content, atomic Page/User/Date mentions, expanded typed database properties, normalized dates, Chart/Form/Dashboard/Map views, deterministic migration and linked-source semantics.
- Phase 2: real Calendar/Timeline work surfaces, accessible Board movement, configurable Gallery, nested typed filters, stable multi-sort/grouping and a bounded typed Formula AST engine without eval/Function.
- Phase 3: reusable page/database templates with fresh IDs, local page/block discussions with anchor lifecycle, first-class attachment metadata/provider boundary, expanded entity search, full workspace JSON roundtrip and stable v9 migration.
- P0 Columns integration: the native BlockNote per-block + / six-dot Side Menu now remains bound to the active Life Atlas custom-column block while a real pointer crosses the narrow column gap/resizer. The fix uses BlockNote's public SideMenuExtension freeze/unfreeze lifecycle and does not patch node_modules, impersonate XL column DOM, or add a full-height pointer overlay.

## Acceptance evidence

- Unit/regression suite: all ${unitTests.length} test modules passed in this verifier.
- Browser suite: ${browserReport.results.length} scenarios / ${browserReport.totalChecks} checks passed with zero captured browser/console/HTTP errors.
- Native Side Menu regression specifically uses a stepped Playwright mouse path to [data-test="dragHandleAdd"] and [data-test="dragHandle"], verifies the active block ID remains stable, activates the native +, confirms insertion in the second column, and confirms the column resizer remains hit-testable.
- Sites-compatible production output exists at dist/client/index.html, dist/server/index.js and dist/.openai/hosting.json.

## Visual evidence

${requiredVisuals.map((file) => `- ${file}`).join("\n")}

A final fresh visual/a11y review is recorded separately at .qa/core-parity-final.png.

## Permitted limitations / non-goals

- Phase 4 is intentionally not implemented.
- Attachments remain local metadata/provider locators; binary payloads are not embedded in workspace localStorage JSON.
- The project keeps its existing project-owned multi-column model instead of adopting GPL/commercial BlockNote XL multi-column.
- Large split chunks from optional PDF/export dependencies may remain in the production bundle; they are lazy build artifacts and do not affect acceptance behavior.

## Artifact integrity

See .qa/core-parity-delivery-manifest.json for SHA-256 checksums of delivery-critical sources, tests, build outputs and visual evidence.
`;
  writeFileSync(path.join(root, "CORE_PARITY_ACCEPTANCE.md"), acceptance);

  report.passed = true;
  report.unitModules = unitTests.length;
  report.browserChecks = browserReport.totalChecks;
  report.manifest = ".qa/core-parity-delivery-manifest.json";
  report.acceptanceReport = "CORE_PARITY_ACCEPTANCE.md";
  console.log(
    `DELIVERY VERIFIED: ${unitTests.length} unit modules, ${browserReport.totalChecks} browser checks, Sites build and checksummed acceptance artifacts passed.`,
  );
} catch (error) {
  report.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  report.completedAt = new Date().toISOString();
  writeFileSync(
    path.join(qaDir, "core-parity-delivery.json"),
    JSON.stringify(report, null, 2),
  );
}
