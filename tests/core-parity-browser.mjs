import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const navigationReportPath = (suffix = "") => process.env.V10_VIEW_CREATE_RUN
  ? `.qa/LOCAL-NOTION-001/v10-view-create15/legacy-${process.env.V10_VIEW_CREATE_RUN}-navigation${suffix}.json`
  : `.qa/LOCAL-NOTION-001/v7-database-view-navigation-${process.env.V7_DB_NAV_RUN || "red01"}${suffix}.json`;

const scenarios = [
  "v14-notion-view-file162",
  "v14-notion-view-file-lifecycle163",
  "v14-known-view-import156",
  "v14-history-restore158",
  "v14-wiki-occurrence157",
  "v14-import-warning151",
  "v14-wiki-projections149",
  "v14-real-wiki-wrapper148",
  "v14-wiki-complex-import143",
  "v14-linked-page-rename142",
  "v14-real-wiki-selection141",
  "v14-real-wiki-history139",
  "v14-real-wiki-view-context136",
  "phase1-database",
  "phase1-editor",
  "phase1-migration",
  "phase2-work-surfaces",
  "phase2-query-formula",
  "phase3-workspace",
  "wp01-integrity",
  "wp20-mobai",
  "wp02-backup",
  "wp02-backup-performance",
  "wp09-roadmap",
  "wp10-templates",
  "wp12-navigation",
  "wp13-inbox",
  "wp14-editor",
  "wp15-database",
  "wp15-views",
  "wp16-history",
  "wp17-settings",
  "wp18-import-export",
  "wp20-refinements",
  "columns-transform",
  "notion-golden-page",
  "notion-replica-editorial",
  "notion-replica-presentation",
  "notion-replica-structure",
  "editor-interactions-v4",
  "editor-structural-v4",
  "editor-selection-safety-v4",
  "editor-long-document-v4",
  "editor-trusted-composition-v4",
  "callout-v7",
  "block-menu-v7",
  "database-view-navigation-v7",
  "database-context-create-v9",
  "database-record-keyboard-v9",
  "database-insertion-history-v10",
  "database-table-title-v10",
  "database-untitled-values-v10",
  "database-record-focus-v10",
  "database-property-config-v10",
  "database-property-default-create-v10",
  "database-status-live-v10",
  "database-text-header-config-v10",
  "database-nested-create-v10",
  "database-click-selection-v10",
  "database-initial-selection-v10",
  "database-calendar-reading-v10",
  "database-record-reading-v10",
  "database-default-create-v10",
  "database-view-default-create-v10",
  "database-view-create-layout-v10",
  "database-gallery-reading-v10",
  "v10-gallery-properties17",
  "v10-view-overflow18",
  "v10-record-fullpage19",
  "v10-gallery-settings20",
  "v10-gallery-keyboard20",
  "v10-gallery-firstblock21",
  "v10-record-default-icon23",
  "v10-image-copy24",
  "page-default-create-v10",
  "v10-list-reading28",
  "v10-table-header-name34",
  "v10-formula-empty-number35",
  "v10-table-number39",
  "v10-table-property-name41",
  "v11-notion-html-import49",
  "v11-notion-html-roundtrip52",
  "v11-fullwidth54",
  "v11-notion-html-semantics55",
  "v12-column-delete64",
  "v12-editor-menu-focus67",
  "v12-notion-block-fidelity68",
  "v13-formula-select77",
  "v13-heading-link87",
  "v13-nested-sidebar91",
  "v13-callout-visual88",
  "v13-unexpected-underline110",
  "v13-link-decoration114",
  "v13-formula-conversion116",
  "v13-wrapper-selection125",
  "v14-import-occurrence129",
  "v14-description130",
  "v14-notion-config-fidelity165",
  "v14-board-card-icon168",
  "v14-gallery-config-import170",
  "v14-layout-and-sidepeek166",
  "v14-w2-w4-real-import",
  "page-cover-board-actions",
  "compact-synced-source",
  "database-chart-readability",
  "column-page-links-140",
  "wrapped-table-window",
  "formula-result-display-153",
  "action-buttons-150",
  "task-recurrence-150",
];
const only = (process.env.PARITY_ONLY || "").split(",").map((name) => name.trim()).filter(Boolean);
const unknownScenarios = only.filter((name) => !scenarios.includes(name));
if (unknownScenarios.length) throw new Error(`Unknown PARITY_ONLY scenario: ${unknownScenarios.join(", ")}`);
const selectedScenarios = only.length ? scenarios.filter((name) => only.includes(name)) : scenarios;
const base = process.env.PARITY_BASE_URL || "http://127.0.0.1:5178";
const baseUrl = new URL(base);
assert.equal(baseUrl.hostname, "127.0.0.1", "Browser tests must use the isolated loopback origin");
assert.equal(baseUrl.port, "5178", "Browser tests must never access user profile ports");
const report = {
  kind: "life-atlas-core-parity-browser",
  startedAt: new Date().toISOString(),
  base,
  scenarios: selectedScenarios,
  passed: false,
};
let server;

const run = (args, env = process.env) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: "inherit", env });
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

const available = async () => {
  try {
    return (
      await fetch(base, {
        signal: AbortSignal.timeout(1200),
      })
    ).ok;
  } catch {
    return false;
  }
};

mkdirSync(".qa", { recursive: true });

try {
  if (!(await available())) {
    const url = new URL(base);
    assert.equal(
      url.hostname,
      "127.0.0.1",
      "Auto-start is restricted to an explicit loopback server",
    );
    server = spawn(
      process.execPath,
      [
        "node_modules/vite/bin/vite.js",
        "--host",
        "127.0.0.1",
        "--port",
        url.port || "5178",
        "--strictPort",
      ],
      { stdio: "inherit" },
    );
    let ready = false;
    for (
      let attempt = 0;
      attempt < 30 && server.exitCode === null;
      attempt += 1
    ) {
      if (await available()) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    assert.equal(ready, true, "Owned browser test server did not become ready");
  }

  const results = [];
  for (const scenario of selectedScenarios) {
    const scenarioFile = `tests/browser/${scenario}.mjs`;
    assert.ok(existsSync(scenarioFile), `Missing browser scenario: ${scenarioFile}`);
    if (scenario === "v14-notion-view-file162") process.env.WIKI_VIEW_FILE162_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-notion-config-fidelity165") process.env.WIKI_CONFIG_FIDELITY165_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-board-card-icon168") process.env.BOARD_ICON168_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-gallery-config-import170") process.env.WIKI_GALLERY_IMPORT170_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-w2-w4-real-import") process.env.W2_W4_IMPORT166_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-notion-view-file-lifecycle163") process.env.WIKI_VIEW_FILE_LIFECYCLE163_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-known-view-import156") process.env.WIKI_KNOWN_IMPORT156_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-history-restore158") process.env.WIKI_HISTORY158_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-wiki-occurrence157") process.env.WIKI_OCCURRENCE157_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-linked-page-rename142") process.env.WIKI_RENAME142_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-real-wiki-wrapper148") process.env.V14_WRAPPER148_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-wiki-projections149") process.env.WIKI_PROJECTIONS149_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-import-warning151") process.env.V14_IMPORT_WARNING151_RUN ||= `core-${Date.now()}`;
    if (scenario === "v14-wiki-complex-import143") process.env.WIKI_IMPORT143_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-gallery-firstblock21") process.env.V10_FIRSTBLOCK21_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-record-default-icon23") process.env.V10_RECORD_ICON23_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-image-copy24") process.env.V10_IMAGE_COPY24_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-list-reading28") process.env.V10_LIST_READING_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-table-header-name34") process.env.HEADER34_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-formula-empty-number35") process.env.V10_EMPTY_NUMBER35_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-table-number39") process.env.V10_NUMBER39_RUN ||= `core-${Date.now()}`;
    if (scenario === "v10-table-property-name41") process.env.HEADER41_RUN ||= `core-${Date.now()}`;
    await run([scenarioFile], {
      ...process.env,
      PARITY_BASE_URL: base,
    });
    const livePropertyReport = scenario === "database-view-create-layout-v10"
      ? `.qa/LOCAL-NOTION-001/v10-view-create15/layout-${process.env.V10_VIEW_CREATE_RUN || "prepared01"}.json`
      : scenario === "database-initial-selection-v10"
      ? `.qa/LOCAL-NOTION-001/v10-nested-database13/initial-selection/${process.env.V10_INITIAL_SELECTION_RUN}/report.json`
      : scenario === "database-property-config-v10" && process.env.V10_PROPERTY_FOCUS_ONLY
      ? `.qa/LOCAL-NOTION-001/v10-property-config/${process.env.V10_PROPERTY_RUN || "local"}-back.json`
      : scenario === "database-click-selection-v10"
      ? `.qa/LOCAL-NOTION-001/v10-nested-database13/selection/${process.env.V10_SELECTION_RUN}/report.json`
      : scenario === "database-nested-create-v10"
      ? `.qa/LOCAL-NOTION-001/v10-nested-database13/identity/${process.env.V10_NESTED_IDENTITY_RUN || "local"}-inline-peek.json`
      : scenario === "database-status-live-v10"
      ? `.qa/LOCAL-NOTION-001/v10-status-option-default-create/status-ui/${process.env.V10_STATUS_RUN || "local"}-inline.json`
      : scenario === "database-text-header-config-v10"
        ? `.qa/LOCAL-NOTION-001/v10-status-option-default-create/text-header/${process.env.V10_TEXT_HEADER_RUN || "local"}.json`
        : null;
    let compoundUiResult = null;
    if (scenario === "v14-board-card-icon168") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/board-icon168/${process.env.BOARD_ICON168_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-w2-w4-real-import") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/w2-w4-import166/${process.env.W2_W4_IMPORT166_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-layout-and-sidepeek166") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/layout166/${process.env.LAYOUT166_RUN || "manual"}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-gallery-config-import170") {
      const part = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/gallery-config-fidelity/170/${process.env.WIKI_GALLERY_IMPORT170_RUN}/browser-report.json`, "utf8"));
      compoundUiResult = { ...part, checks: part.flows.flatMap((flow) => flow.checks), errors: part.flows.flatMap((flow) => flow.errors) };
    } else if (scenario === "v14-notion-config-fidelity165") {
      const part = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/fidelity165/${process.env.WIKI_CONFIG_FIDELITY165_RUN}/browser-report.json`, "utf8"));
      compoundUiResult = { ...part, checks: part.modes.flatMap((mode) => mode.checks), errors: part.modes.flatMap((mode) => mode.errors) };
    } else if (scenario === "v14-notion-view-file162") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/import162/${process.env.WIKI_VIEW_FILE162_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-notion-view-file-lifecycle163") {
      const part = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/import163/${process.env.WIKI_VIEW_FILE_LIFECYCLE163_RUN}/browser-report.json`, "utf8"));
      compoundUiResult = { ...part, checks: part.flows.flatMap((flow) => flow.checks), errors: part.flows.flatMap((flow) => flow.errors) };
    } else if (scenario === "v14-known-view-import156") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/import156/${process.env.WIKI_KNOWN_IMPORT156_RUN}/browser156.json`, "utf8"));
    } else if (scenario === "v14-history-restore158") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/history158/${process.env.WIKI_HISTORY158_RUN}/browser158.json`, "utf8"));
    } else if (scenario === "v14-wiki-occurrence157") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/occurrence157/${process.env.WIKI_OCCURRENCE157_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-import-warning151") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/warning151/${process.env.V14_IMPORT_WARNING151_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-wiki-projections149") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/projection149/${process.env.WIKI_PROJECTIONS149_RUN}/browser149.json`, "utf8"));
    } else if (scenario === "v14-real-wiki-wrapper148") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/wrapper148/${process.env.V14_WRAPPER148_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-wiki-complex-import143") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/import143/${process.env.WIKI_IMPORT143_RUN}/browser143.json`, "utf8"));
    } else if (scenario === "v14-linked-page-rename142") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-wiki-real133/rename142/${process.env.WIKI_RENAME142_RUN}/browser-report.json`, "utf8"));
    } else if (scenario === "v14-description130") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v14-linked-view129/description130/${process.env.V14_DESCRIPTION130_RUN || "local01"}.json`, "utf8"));
    } else if (scenario === "v13-formula-conversion116") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v13-wiki-formula116/browser116/${process.env.V13_FORMULA_CONVERSION116_RUN || "local01"}/report.json`, "utf8"));
    } else if (scenario === "v10-table-number39") {
      const reports = ["", "-locked", "-locked-host", "-filtered", "-switch"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-table-number39/${process.env.V10_NUMBER39_RUN}${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-table-property-name41") {
      const reports = ["", "-locked"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-table-property-name41/${process.env.HEADER41_RUN}${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-table-header-name34") {
      const reports = ["", "-duplicate", "-historical", "-locked"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-table-header-name34/${process.env.HEADER34_RUN}${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-formula-empty-number35") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-formula-empty-number35/${process.env.V10_EMPTY_NUMBER35_RUN}.json`, "utf8"));
    } else if (scenario === "v10-list-reading28") {
      const reports = ["alignment", "reading", "symptom", "default", "properties", "footer", "locked", "itemlocked", "inline", "full"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-list-reading28/${process.env.V10_LIST_READING_RUN}/${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-record-default-icon23" || scenario === "v10-image-copy24") {
      const icon = scenario === "v10-record-default-icon23";
      const directory = icon ? "v10-record-default-icon23" : "v10-image-copy24";
      const label = icon ? process.env.V10_RECORD_ICON23_RUN : process.env.V10_IMAGE_COPY24_RUN;
      const reports = (icon ? ["default", "duplicate", "template"] : ["editable", "locked"]).map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/${directory}/${label}-${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-gallery-firstblock21") {
      const reports = ["text", "later-image", "compat"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-gallery-firstblock21/${process.env.V10_FIRSTBLOCK21_RUN}-${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-gallery-keyboard20") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-gallery-keyboard20/${process.env.V10_GALLERY_KEYBOARD_RUN || "manual"}/${process.env.V10_GALLERY_KEYBOARD_PART || "all"}.json`, "utf8"));
    } else if (scenario === "v10-gallery-settings20") {
      compoundUiResult = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-gallery-settings20/${process.env.V10_GALLERY20_RUN || "red01"}/controls.json`, "utf8"));
    } else if (scenario === "database-gallery-reading-v10") {
      const reports = ["covers", "properties", "content", "create", "locked"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-gallery16/gallery-${process.env.V10_GALLERY_RUN || "prepared01"}-${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-gallery-properties17") {
      const reports = ["common", "legacy", "global", "locked"].map((suffix) => JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-gallery-properties17/${process.env.V10_GALLERY_PROPERTIES_RUN || "prepared01"}/${suffix}.json`, "utf8")));
      for (const part of reports) assert.equal(part.sourceFingerprint, reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { passed: reports.every((part) => part.passed), checks: reports.flatMap((part) => part.checks), errors: reports.flatMap((part) => part.errors), sourceFingerprint: reports[0].sourceFingerprint };
    } else if (scenario === "v10-view-overflow18") {
      const report = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-view-overflow18/${process.env.V10_VIEW_OVERFLOW_RUN || "prepared01"}.json`, "utf8"));
      compoundUiResult = { ...report, checks: report.scenarios.flatMap((part) => part.checks), errors: report.scenarios.flatMap((part) => part.errors) };
    } else if (scenario === "v10-record-fullpage19") {
      const report = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-record-fullpage19/${process.env.V10_RECORD_FULLPAGE19_RUN || "prepared"}/aggregate.json`, "utf8"));
      for (const part of report.reports) assert.equal(part.sourceFingerprint, report.reports[0].sourceFingerprint, `${scenario} source must match across cases`);
      compoundUiResult = { ...report, checks: report.reports.flatMap((part) => part.checks), errors: report.reports.flatMap((part) => part.errors), sourceFingerprint: report.reports[0].sourceFingerprint };
    }
    let result = compoundUiResult || JSON.parse(
      readFileSync(livePropertyReport || (scenario === "callout-v7" && process.env.V7_CALLOUT_AGGREGATE_PATH ? process.env.V7_CALLOUT_AGGREGATE_PATH : scenario === "block-menu-v7" && process.env.V7_BLOCK_MENU_AGGREGATE_PATH ? process.env.V7_BLOCK_MENU_AGGREGATE_PATH : scenario === "database-view-navigation-v7" ? navigationReportPath() : scenario === "database-record-focus-v10" ? `.qa/LOCAL-NOTION-001/v10-record-focus/${process.env.V10_FOCUS_RUN || "local"}.json` : scenario === "database-property-config-v10" ? `.qa/LOCAL-NOTION-001/v10-property-config/${process.env.V10_PROPERTY_RUN || "local"}.json` : scenario === "page-default-create-v10" ? ".qa/LOCAL-NOTION-001/v10-page-default-create/page-default-create.json" : `.qa/${scenario}.json`), "utf8"),
    );
    if (livePropertyReport && !["database-click-selection-v10", "database-initial-selection-v10", "database-property-config-v10", "database-view-create-layout-v10"].includes(scenario)) {
      for (const suffix of scenario === "database-nested-create-v10" ? ["layout-full", "linked-full", "ordinarycalendar-full"] : scenario === "database-status-live-v10" ? ["name", "create", "keyboard", "locked"] : ["locked"]) {
        const extraPath = scenario === "database-nested-create-v10"
          ? `.qa/LOCAL-NOTION-001/v10-nested-database13/identity/${process.env.V10_NESTED_IDENTITY_RUN || "local"}-${suffix}.json`
          : scenario === "database-status-live-v10"
          ? `.qa/LOCAL-NOTION-001/v10-status-option-default-create/status-ui/${process.env.V10_STATUS_RUN || "local"}-${suffix}.json`
          : `.qa/LOCAL-NOTION-001/v10-status-option-default-create/text-header/${process.env.V10_TEXT_HEADER_RUN || "local"}-${suffix}.json`;
        const extra = JSON.parse(readFileSync(extraPath, "utf8"));
        assert.equal(extra.passed, true, `${scenario} ${suffix} case must pass`);
        assert.ok(Array.isArray(extra.checks) && extra.checks.length > 0 && extra.checks.every((check) => check.passed), `${scenario} ${suffix} case must contain only passing checks`);
        assert.deepEqual(extra.errors, [], `${scenario} ${suffix} case must have zero browser/console/HTTP errors`);
        result = { ...result, passed: result.passed && extra.passed, checks: [...result.checks, ...extra.checks], errors: [...result.errors, ...extra.errors] };
      }
    }
    if (scenario === "database-view-create-layout-v10") {
      for (const suffix of ["dismiss", "locked", "inline", "linked"]) {
        const extra = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-view-create15/layout-${process.env.V10_VIEW_CREATE_RUN || "prepared01"}-${suffix}.json`, "utf8"));
        assert.equal(extra.passed, true, `${scenario} ${suffix} case must pass`);
        assert.ok(Array.isArray(extra.checks) && extra.checks.length > 0 && extra.checks.every((check) => check.passed), `${scenario} ${suffix} case must contain only passing checks`);
        assert.deepEqual(extra.errors, [], `${scenario} ${suffix} case must have zero browser/console/HTTP errors`);
        assert.equal(extra.sourceFingerprint, result.sourceFingerprint, `${scenario} ${suffix} source must match`);
        result = { ...result, passed: result.passed && extra.passed, checks: [...result.checks, ...extra.checks], errors: [...result.errors, ...extra.errors] };
      }
    }
    if (scenario === "database-view-navigation-v7") {
      assert.equal(result.passed, true, `${scenario} main case must pass`);
      assert.ok(Array.isArray(result.checks) && result.checks.length > 0 && result.checks.every((check) => check.passed), `${scenario} main case must contain only passing checks`);
      assert.deepEqual(result.errors, [], `${scenario} main case must have zero browser/console/HTTP errors`);
      const locked = JSON.parse(readFileSync(navigationReportPath("-locked"), "utf8"));
      assert.equal(locked.passed, true, `${scenario} locked case must pass`);
      assert.ok(Array.isArray(locked.checks) && locked.checks.length > 0 && locked.checks.every((check) => check.passed), `${scenario} locked case must contain only passing checks`);
      assert.deepEqual(locked.errors, [], `${scenario} locked case must have zero browser/console/HTTP errors`);
      const freshInline = JSON.parse(readFileSync(navigationReportPath("-fresh-inline"), "utf8"));
      assert.equal(freshInline.passed, true, `${scenario} fresh inline case must pass`);
      assert.ok(Array.isArray(freshInline.checks) && freshInline.checks.length > 0 && freshInline.checks.every((check) => check.passed), `${scenario} fresh inline case must contain only passing checks`);
      assert.deepEqual(freshInline.errors, [], `${scenario} fresh inline case must have zero browser/console/HTTP errors`);
      result = { ...result, passed: result.passed && locked.passed && freshInline.passed, checks: [...result.checks, ...locked.checks, ...freshInline.checks], errors: [...result.errors, ...locked.errors, ...freshInline.errors] };
    }
    if (scenario === "database-table-title-v10") {
      for (const suffix of ["empty", "virtual", "locked-host"]) {
        const extra = JSON.parse(readFileSync(`.qa/database-table-title-v10-${suffix}.json`, "utf8"));
        assert.equal(extra.passed, true, `${scenario} ${suffix} case must pass`);
        assert.ok(Array.isArray(extra.checks) && extra.checks.length > 0 && extra.checks.every((check) => check.passed), `${scenario} ${suffix} case must contain only passing checks`);
        assert.deepEqual(extra.errors, [], `${scenario} ${suffix} case must have zero browser/console/HTTP errors`);
        result = { ...result, passed: result.passed && extra.passed, checks: [...result.checks, ...extra.checks], errors: [...result.errors, ...extra.errors] };
      }
    }
    if (scenario === "database-property-config-v10") {
      const suffix = process.env.V10_PROPERTY_FOCUS_ONLY ? "delete" : "locked";
      const locked = JSON.parse(readFileSync(`.qa/LOCAL-NOTION-001/v10-property-config/${process.env.V10_PROPERTY_RUN || "local"}-${suffix}.json`, "utf8"));
      assert.equal(locked.passed, true, `${scenario} locked case must pass`);
      assert.ok(Array.isArray(locked.checks) && locked.checks.length > 0 && locked.checks.every((check) => check.passed), `${scenario} locked case must contain only passing checks`);
      assert.deepEqual(locked.errors, [], `${scenario} locked case must have zero browser/console/HTTP errors`);
      result = { ...result, passed: result.passed && locked.passed, checks: [...result.checks, ...locked.checks], errors: [...result.errors, ...locked.errors] };
    }
    if (scenario === "database-untitled-values-v10") {
      const peek = JSON.parse(readFileSync(".qa/database-untitled-values-v10-peek.json", "utf8"));
      assert.equal(peek.passed, true, `${scenario} Peek case must pass`);
      assert.ok(Array.isArray(peek.checks) && peek.checks.length > 0 && peek.checks.every((check) => check.passed), `${scenario} Peek case must contain only passing checks`);
      assert.deepEqual(peek.errors, [], `${scenario} Peek case must have zero browser/console/HTTP errors`);
      result = { ...result, passed: result.passed && peek.passed, checks: [...result.checks, ...peek.checks], errors: [...result.errors, ...peek.errors] };
    }
    if (scenario === "database-view-default-create-v10") {
      for (const suffix of ["cancel", "locked"]) {
        const extra = JSON.parse(readFileSync(`.qa/database-view-default-create-v10-${suffix}.json`, "utf8"));
        assert.equal(extra.passed, true, `${scenario} ${suffix} case must pass`);
        assert.ok(Array.isArray(extra.checks) && extra.checks.length > 0 && extra.checks.every((check) => check.passed), `${scenario} ${suffix} case must contain only passing checks`);
        assert.deepEqual(extra.errors, [], `${scenario} ${suffix} case must have zero browser/console/HTTP errors`);
        result = { ...result, passed: result.passed && extra.passed, checks: [...result.checks, ...extra.checks], errors: [...result.errors, ...extra.errors] };
      }
    }
    if (scenario === "database-property-default-create-v10") {
      for (const suffix of ["clear", "status", "locked"]) {
        const extra = JSON.parse(readFileSync(`.qa/database-property-default-create-v10-${suffix}.json`, "utf8"));
        assert.equal(extra.passed, true, `${scenario} ${suffix} case must pass`);
        assert.ok(Array.isArray(extra.checks) && extra.checks.length > 0 && extra.checks.every((check) => check.passed), `${scenario} ${suffix} case must contain only passing checks`);
        assert.deepEqual(extra.errors, [], `${scenario} ${suffix} case must have zero browser/console/HTTP errors`);
        result = { ...result, passed: result.passed && extra.passed, checks: [...result.checks, ...extra.checks], errors: [...result.errors, ...extra.errors] };
      }
    }
    if (scenario === "page-default-create-v10") {
      const noFolder = JSON.parse(readFileSync(".qa/LOCAL-NOTION-001/v10-page-default-create/page-default-no-folder.json", "utf8"));
      assert.equal(noFolder.passed, true, `${scenario} no-folder case must pass`);
      assert.ok(Array.isArray(noFolder.checks) && noFolder.checks.length > 0 && noFolder.checks.every((check) => check.passed), `${scenario} no-folder case must contain only passing checks`);
      assert.deepEqual(noFolder.errors, [], `${scenario} no-folder case must have zero browser/console/HTTP errors`);
      result = { ...result, passed: result.passed && noFolder.passed, checks: [...result.checks, ...noFolder.checks], errors: [...result.errors, ...noFolder.errors] };
    }
    assert.equal(result.passed, true, `${scenario} must pass`);
    assert.ok(
      Array.isArray(result.checks) &&
        result.checks.length > 0 &&
        result.checks.every((check) => check.passed),
      `${scenario} must contain only passing checks`,
    );
    assert.deepEqual(
      result.errors,
      [],
      `${scenario} must have zero browser/console/HTTP errors`,
    );
    results.push({
      scenario,
      checks: result.checks.length,
      errors: result.errors.length,
      storageKey: result.storageKey || null,
      sourceFingerprint: result.sourceFingerprint || null,
    });
  }

  report.results = results;
  report.totalChecks = results.reduce((sum, entry) => sum + entry.checks, 0);
  report.passed = true;
  console.log(
    `CORE PARITY BROWSER: ${selectedScenarios.length} scenarios / ${report.totalChecks} checks passed with zero captured errors.`,
  );
} catch (error) {
  report.failure = error.stack;
  console.error(error.stack);
  process.exitCode = 1;
} finally {
  // Only stop a Vite child that this verifier created itself.
  server?.kill();
  report.completedAt = new Date().toISOString();
  writeFileSync(
    process.env.PARITY_SUMMARY_PATH || ".qa/core-parity-browser.json",
    JSON.stringify(report, null, 2),
  );
}
