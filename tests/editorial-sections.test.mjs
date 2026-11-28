import test from "node:test";
import assert from "node:assert/strict";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";
import { normalizeEditorialSectionConfig, projectEditorialSection } from "../src/domain/editorialSections.js";

test("editorial projection applies canonical filter sort limit without copying items", () => {
  const workspace = coreParityWorkspace();
  const before = workspace.databaseItems.map((item) => item.id);
  const result = projectEditorialSection(workspace, {
    sourceId: "projects",
    layout: "cards-3",
    filter: { kind: "condition", propertyId: "status", operator: "equals", value: "doing" },
    sorts: [{ propertyId: "amount", direction: "desc" }],
    limit: 3,
    titlePropertyId: "title",
    excerptPropertyId: "notes",
  });
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].itemId, "alpha");
  assert.equal(result.cards[0].title, "Alpha 项目");
  assert.match(result.cards[0].excerpt, /alpha/);
  assert.deepEqual(workspace.databaseItems.map((item) => item.id), before);
});

test("editorial config parses serialized filter/sorts and clamps limit", () => {
  const config = normalizeEditorialSectionConfig({
    sourceId: "projects",
    filter: JSON.stringify({ propertyId: "status", operator: "equals", value: "doing" }),
    sorts: JSON.stringify([{ propertyId: "amount", direction: "desc" }]),
    limit: 99,
  });
  assert.equal(config.limit, 12);
  assert.equal(config.filter.propertyId, "status");
  assert.equal(config.sorts[0].propertyId, "amount");
});
