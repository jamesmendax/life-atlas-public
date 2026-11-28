import assert from "node:assert/strict";
import test from "node:test";
import { createPageBundle, importPageBundle } from "../src/domain/pageBundle.js";
import { checkWorkspaceIntegrity } from "../src/domain/integrity.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const title = { id: "title", type: "title", name: "Name" };
const page = (id, folderId = "folder") => ({ id, folderId, title: id, content: [] });
const item = (id, sourceId, values = {}) => ({ id, sourceId, pageId: id + "-page", values: { title: id, ...values } });

function sourceWorkspace({ values = ["left"], defaults } = {}) {
  const records = [
    item("record", "records", { link: values }),
    item("left", "targets", { reverse: ["record"] }),
    item("right", "targets"),
    item("foreign", "different"),
  ];
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    folders: [{ id: "folder", parentId: null }],
    pages: [page("owner"), ...records.map(row => page(row.pageId))],
    dataSources: [
      { id: "records", ownerPageId: "owner", properties: [title, { id: "link", name: "指定账户", type: "relation", config: { targetSourceId: "targets", relationLimit: 1 } }] },
      { id: "targets", properties: [title, { id: "reverse", type: "relation", config: { targetSourceId: "records" } }] },
      { id: "different", properties: [title] },
    ],
    databaseItems: records,
    relations: [
      { id: "relation", sourceId: "records", propertyId: "link", targetSourceId: "targets", reciprocalPropertyId: "reverse" },
      { id: "reverse", sourceId: "targets", propertyId: "reverse", targetSourceId: "records", reciprocalPropertyId: "link" },
    ],
    databaseTemplates: defaults ? [{ id: "template", name: "模板", sourceId: "records", defaultValues: { link: defaults }, pageContent: [] }] : [],
  };
}

const deserialize = workspace => JSON.parse(JSON.stringify(createPageBundle(workspace.pages[0], workspace)));

test("page JSON import rejects new multiple or foreign relation targets and leaves the destination intact", () => {
  const destination = { folders: [{ id: "folder" }], pages: [page("destination")] };
  const frozen = structuredClone(destination);
  for (const [values, pattern, code] of [
    [["left", "right"], /最多可关联 1 条/, "RELATION_VALUE_LIMIT"],
    [["foreign"], /不属于目标数据库/, "RELATION_VALUE_WRONG_SOURCE"],
    [["missing"], /不存在/, "RELATION_VALUE_MISSING"],
    [[5], /无效/, "RELATION_VALUE_INVALID"],
  ]) {
    const source = sourceWorkspace({ values });
    assert.throws(() => importPageBundle(destination, deserialize(source), "destination"), pattern);
    assert.deepEqual(destination, frozen);
    assert.ok(checkWorkspaceIntegrity(source).problems.some(problem => problem.code === code));
  }
});

test("record templates are checked and a valid imported graph remaps both directions", () => {
  const destination = { folders: [{ id: "folder" }], pages: [page("destination")] };
  assert.throws(() => importPageBundle(destination, deserialize(sourceWorkspace({ defaults: ["foreign"] })), "destination"), /不属于目标数据库/);
  const { workspace } = importPageBundle(destination, deserialize(sourceWorkspace({ defaults: ["left"] })), "destination");
  const find = title => workspace.databaseItems.find(row => row.values.title === title);
  assert.deepEqual(find("record").values.link, [find("left").id]);
  assert.deepEqual(find("left").values.reverse, [find("record").id]);
  assert.deepEqual(workspace.databaseTemplates[0].defaultValues.link, [find("left").id]);
  assert.equal(checkWorkspaceIntegrity(workspace).ok, true);
});

test("a dangling incoming relation cannot bind to an existing destination row by ID", () => {
  const destination = sourceWorkspace();
  const frozen = structuredClone(destination);
  const source = sourceWorkspace();
  const bundle = deserialize(source);
  bundle.related.databaseItems = bundle.related.databaseItems.filter(row => row.id !== "left");
  assert.throws(() => importPageBundle(destination, bundle, "owner"), /不存在/);
  assert.deepEqual(destination, frozen);
});
