import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";

const baseline = JSON.parse(readFileSync(new URL("../.qa/LOCAL-NOTION-001/v9-formal-database-ui01/evidence/native208-formal30-v14-real-wiki-resume.json", import.meta.url), "utf8")).workspace;
const databasePages = baseline.pages.filter((page) => page.pageType === "database");

function inspect(workspace) {
  const before = structuredClone(workspace);
  const result = checkWorkspaceIntegrity(workspace);
  assert.deepEqual(workspace, before, "Integrity checks must not change the full real Wiki");
  return result;
}

function errors(result) {
  return result.problems.filter((problem) => problem.severity === "error");
}

test("native208 keeps all 84 pages and six canonical database declarations valid", () => {
  assert.deepEqual([baseline.pages.length, baseline.databaseItems.length, baseline.dataSources.length, baseline.databaseViews.length, baseline.attachments.length, baseline.pageVersions.length], [84, 58, 11, 31, 20, 118]);
  assert.deepEqual(databasePages.map((page) => page.title), ["随笔", "此刻", "项目", "书架", "文章", "札记"]);
  for (const page of databasePages) {
    assert.equal(baseline.dataSources.find((source) => source.id === page.databaseSourceId)?.ownerPageId, page.id);
    assert.equal(baseline.databaseViews.find((view) => view.id === page.databaseViewId)?.sourceId, page.databaseSourceId);
  }
  const result = inspect(baseline);
  assert.equal(result.ok, true);
  assert.deepEqual(errors(result), []);
});

test("each real database page reports its declared missing source without a cascading view mismatch", () => {
  for (const original of databasePages) {
    const workspace = structuredClone(baseline);
    workspace.pages.find((page) => page.id === original.id).databaseSourceId = "source-missing-integrity140";
    const result = inspect(workspace);
    assert.equal(result.ok, false, original.title);
    assert.deepEqual(errors(result), [{ severity: "error", code: "PAGE_DATABASE_SOURCE_MISSING", collection: "pages", id: original.id, detail: "Missing database source: source-missing-integrity140" }], original.title);
  }
});

test("each real database page reports its declared missing view instead of accepting a fallback", () => {
  for (const original of databasePages) {
    const workspace = structuredClone(baseline);
    workspace.pages.find((page) => page.id === original.id).databaseViewId = "view-missing-integrity140";
    const result = inspect(workspace);
    assert.equal(result.ok, false, original.title);
    assert.deepEqual(errors(result), [{ severity: "error", code: "PAGE_DATABASE_VIEW_MISSING", collection: "pages", id: original.id, detail: "Missing database view: view-missing-integrity140" }], original.title);
  }
});

test("each real database page reports an existing view belonging to another source", () => {
  for (const original of databasePages) {
    const workspace = structuredClone(baseline);
    const otherView = workspace.databaseViews.find((view) => view.sourceId !== original.databaseSourceId);
    workspace.pages.find((page) => page.id === original.id).databaseViewId = otherView.id;
    const result = inspect(workspace);
    assert.equal(result.ok, false, original.title);
    assert.deepEqual(errors(result), [{ severity: "error", code: "PAGE_DATABASE_VIEW_SOURCE_MISMATCH", collection: "pages", id: original.id, detail: `Database view ${otherView.id} belongs to source ${otherView.sourceId}, expected: ${original.databaseSourceId}` }], original.title);
  }
});

test("legacy database pages may omit, null or empty their view declaration", () => {
  for (const original of databasePages) {
    for (const empty of [undefined, null, ""]) {
      const workspace = structuredClone(baseline);
      const page = workspace.pages.find((page) => page.id === original.id);
      if (empty === undefined) delete page.databaseViewId;
      else page.databaseViewId = empty;
      assert.ok(workspace.databaseViews.some((view) => view.sourceId === page.databaseSourceId), "The existing source-view fallback remains available");
      const result = inspect(workspace);
      assert.equal(result.ok, true, original.title);
      assert.deepEqual(errors(result), [], original.title);
    }
  }
});

test("database declarations do not make previously optional source fields mandatory", () => {
  for (const original of databasePages) {
    const workspace = structuredClone(baseline);
    delete workspace.pages.find((page) => page.id === original.id).databaseSourceId;
    const result = inspect(workspace);
    assert.equal(result.ok, true, original.title);
    assert.deepEqual(errors(result), [], original.title);
  }
});

test("the 58 real record pages keep source membership without needing a database page view", () => {
  const recordPages = baseline.databaseItems.map((item) => baseline.pages.find((page) => page.id === item.pageId));
  assert.equal(recordPages.length, 58);
  for (const page of recordPages) {
    assert.ok(page.databaseSourceId);
    assert.notEqual(page.pageType, "database");
    assert.ok(!page.databaseViewId);
  }
  const result = inspect(baseline);
  assert.equal(result.ok, true);
  assert.deepEqual(errors(result), []);
});

test("two dangling declarations report both missing references without a source mismatch", () => {
  const workspace = structuredClone(baseline);
  const page = workspace.pages.find((page) => page.id === databasePages[0].id);
  page.databaseSourceId = "source-missing-integrity140";
  page.databaseViewId = "view-missing-integrity140";
  const result = inspect(workspace);
  assert.equal(result.ok, false);
  assert.deepEqual(errors(result), [
    { severity: "error", code: "PAGE_DATABASE_SOURCE_MISSING", collection: "pages", id: page.id, detail: "Missing database source: source-missing-integrity140" },
    { severity: "error", code: "PAGE_DATABASE_VIEW_MISSING", collection: "pages", id: page.id, detail: "Missing database view: view-missing-integrity140" },
  ]);
});
