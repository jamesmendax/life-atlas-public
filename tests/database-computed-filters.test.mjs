import assert from "node:assert/strict";
import test from "node:test";
import { executeWorkspaceTool } from "../src/assistant/workspaceTools.js";
import { createProperty, projectViewItems } from "../src/domain/database.js";
import { dashboardProjection } from "../src/domain/dashboard.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

function projectIds(workspace, propertyId, operator, value, valueType) {
  const view = { sourceId:"projects", filter:{ propertyId, operator, value, valueType } };
  return projectViewItems(workspace, view).map(item => item.id);
}

test("computed number filters distinguish blank, error, text, and real zero results", () => {
  const workspace = coreParityWorkspace();
  const { properties } = workspace.dataSources[0];
  properties.find(property => property.id === "formula").config.expression =
    'if({{title}} == "Alpha 项目", empty, if({{title}} == "Beta 项目", 1 / 0, if({{title}} == "文本", "0", {{amount}})))';
  const zero = workspace.databaseItems.find(item => item.id === "gamma");
  zero.values.amount = 0;
  workspace.databaseItems.push(
    { ...zero, id:"positive", pageId:"positive-page", values:{ title:"正数", amount:78 } },
    { ...zero, id:"string", pageId:"string-page", values:{ title:"文本" } },
  );

  assert.deepEqual(projectIds(workspace, "formula", "greater_than", 75), ["positive"]);
  assert.deepEqual(projectIds(workspace, "formula", "greater_than_or_equal", 78), ["positive"]);
  assert.deepEqual(projectIds(workspace, "formula", "less_than", 78), ["gamma"]);
  assert.deepEqual(projectIds(workspace, "formula", "less_than_or_equal", "0"), ["gamma"]);
  assert.deepEqual(projectIds(workspace, "formula", "equals", 0), ["gamma"]);
  assert.deepEqual(projectIds(workspace, "formula", "not_equals", 0), ["positive"]);
  assert.deepEqual(projectIds(workspace, "formula", "equals", "0"), ["string"]);
  assert.deepEqual(projectIds(workspace, "formula", "contains", "0"), ["gamma", "string"]);
  assert.deepEqual(projectIds(workspace, "formula", "not_contains", "0"), ["alpha", "positive"]);
  assert.deepEqual(projectIds(workspace, "formula", "is_empty"), ["alpha"]);
  for (const blank of [null, "", " ", Infinity]) {
    assert.deepEqual(projectIds(workspace, "formula", "greater_than_or_equal", blank), []);
  }
  assert.deepEqual(projectIds(workspace, "formula", "not_equals", "", "number"), []);
});

test("numeric rollup and ordinary number filters compare valid results and recalculate after a related edit", () => {
  const workspace = coreParityWorkspace();
  const [alpha, beta, gamma, partner] = workspace.databaseItems;
  alpha.values.relation = [];
  alpha.values.amount = null;
  beta.values.amount = 0;
  gamma.values.relation = ["zero-partner"];
  workspace.databaseItems.push({ ...partner, id:"zero-partner", values:{ title:"零", rating:0 } });
  partner.values.rating = 70;

  assert.deepEqual(projectIds(workspace, "amount", "less_than_or_equal", 0), ["beta", "gamma"]);
  assert.deepEqual(projectIds(workspace, "rollup", "less_than_or_equal", 0), ["gamma"]);
  assert.deepEqual(projectIds(workspace, "rollup", "not_equals", 0), ["beta"]);
  assert.deepEqual(projectIds(workspace, "rollup", "greater_than", 75), []);
  partner.values.rating = 78;
  assert.deepEqual(projectIds(JSON.parse(JSON.stringify(workspace)), "rollup", "greater_than", 75), ["beta"]);
});

test("mapped dashboard computed filters retain numeric and legacy text equality semantics", () => {
  const workspace = coreParityWorkspace();
  const [primary, partners] = workspace.dataSources;
  const dashboard = workspace.databaseViews.find(view => view.type === "dashboard");
  const property = createProperty({ id:"formula-partner", name:"计算评分", type:"formula", config:{ expression:'if({{rating}} > 0, {{rating}}, "")' } });
  partners.properties.push(property);
  const partner = workspace.databaseItems.find(item => item.sourceId === partners.id);
  workspace.databaseItems.push({ ...partner, id:"blank-result", values:{ rating:0 } });
  const ids = (value, valueType) => dashboardProjection({
    workspace, primary, dashboard, widget:{ type:"list", sourceId:partners.id },
    globalFilters:[{ propertyId:"formula", operator:"equals", value, valueType, mappings:{ [partners.id]:property.id } }],
  }).items.map(item => item.id);

  assert.deepEqual(ids(4.5), [partner.id]);
  assert.deepEqual(ids("", "number"), []);
  assert.deepEqual(ids(""), ["blank-result"]);
});

test("assistant computed numeric comparison persists a numeric threshold", () => {
  const workspace = coreParityWorkspace();
  const args = { page_id:"database-page", source_id:"projects", view_id:"view-table", filter_property_id:"formula", filter_operator:"greater_than" };
  const updated = executeWorkspaceTool("update_database_view", { ...args, filter_value:"175.5" }, { workspace });
  assert.equal(updated.result.ok, true);
  const view = updated.workspace.databaseViews.find(candidate => candidate.id === args.view_id);
  assert.deepEqual(view.filter, { propertyId:"formula", operator:"greater_than", value:175.5 });
  assert.deepEqual(projectViewItems(updated.workspace, view).map(item => item.id), ["alpha"]);
  const invalid = executeWorkspaceTool("update_database_view", { ...args, filter_value:" " }, { workspace });
  assert.equal(invalid.result.ok, false);
});

test("computed text tests apply to one list element and never match an empty or scalar value", () => {
  const workspace = coreParityWorkspace();
  const field = workspace.dataSources[0].properties.find(property => property.id === "formula");
  field.config.expression = 'if({{title}} == "Alpha 项目", ["Complete", "To Be Read"], if({{title}} == "Beta 项目", ["Complete", 0], "Complete"))';
  assert.deepEqual(projectIds(workspace, "formula", "any_text_equals", "Complete"), ["alpha", "beta"]);
  assert.deepEqual(projectIds(workspace, "formula", "any_text_not_equals", "Complete"), ["alpha"]);
  assert.deepEqual(projectIds(workspace, "formula", "any_text_contains", "COMP"), ["alpha", "beta"]);
  assert.deepEqual(projectIds(workspace, "formula", "any_text_not_contains", "COMP"), ["alpha"]);
  assert.deepEqual(projectIds(workspace, "formula", "every_text_contains", "e"), ["alpha"]);
  assert.deepEqual(projectIds(workspace, "formula", "none_text_equals", "To Be Read"), ["beta"]);
  field.config.expression = '[]';
  assert.deepEqual(projectIds(workspace, "formula", "any_text_not_equals", "Complete"), []);
});

test("fixed computed-date predicates honor the requested day and the view clock", () => {
  const workspace = coreParityWorkspace();
  const [source, partners] = workspace.dataSources;
  source.properties.find(entry => entry.id === "formula").config.expression =
    'if({{title}} == "Alpha 项目", today(), if({{title}} == "Beta 项目", today().dateAdd(1, "day"), empty()))';
  partners.properties.push(createProperty({ id:"scheduled", type:"date", name:"Partner date" }));
  source.properties.push(createProperty({ id:"firstDate", type:"rollup", name:"First date",
    config:{ relationPropertyId:"relation", targetPropertyId:"scheduled", aggregation:"earliest_date" } }));
  const firstLink = workspace.databaseItems.find(entry => entry.sourceId === partners.id);
  firstLink.values.scheduled = { start:"2026-11-26T16:00", includeTime:true, timeZone:"UTC+8" };
  const [alpha, beta, gamma] = workspace.databaseItems;
  alpha.values.relation = [firstLink.id];
  beta.values.relation = ["following-partner"];
  gamma.values.relation = [];
  workspace.databaseItems.push({
    ...firstLink, id:"following-partner", pageId:"following-partner-page",
    values:{ scheduled:{ start:"2026-11-27", includeTime:false } },
  });

  const now = new Date(2026, 10, 26, 12);
  const ids = (propertyId, operator, value, valueType = "date") => projectViewItems(workspace,
    { sourceId:source.id, filter:{ propertyId, operator, value, valueType } }, { now }).map(item => item.id);
  for (const property of ["formula", "firstDate"]) {
    assert.deepEqual(ids(property, "equals", "2026-11-26"), ["alpha"]);
    assert.deepEqual(ids(property, "after", "2026-11-26"), ["beta"]);
    assert.deepEqual(ids(property, "not_equals", "2026-11-26"), ["beta"]);
    assert.deepEqual(ids(property, "relative_date", "today", undefined), ["alpha"]);
  }
  assert.deepEqual(ids("firstDate", "equals", "2026-11-26T08:00:00Z"), ["alpha"]);
});

test("list rollup view filters match displayed choices through nested relations", () => {
  const workspace = coreParityWorkspace();
  const [source, partners] = workspace.dataSources;
  partners.properties.push(createProperty({ id:"industry", type:"multi_select", name:"Industry",
    options:[{ id:"tag-01", name:"Finance" }, { id:"tag-02", name:"Legal" }] }));
  source.properties.push(createProperty({ id:"industries", type:"rollup", name:"Industries",
    config:{ relationPropertyId:"relation", targetPropertyId:"industry", aggregation:"show" } }));
  const firstLink = workspace.databaseItems.find(entry => entry.sourceId === partners.id);
  firstLink.values.industry = ["tag-01", "tag-02"];
  const [alpha, beta, gamma] = workspace.databaseItems;
  alpha.values.relation = [firstLink.id];
  beta.values.relation = ["finance-partner"];
  gamma.values.relation = [];
  workspace.databaseItems.push({
    ...firstLink, id:"finance-partner", pageId:"finance-partner-page", values:{ industry:["tag-01"] },
  });
  assert.deepEqual(projectIds(workspace, "industries", "any_text_equals", "Finance"), ["alpha", "beta"]);
  assert.deepEqual(projectIds(workspace, "industries", "any_text_equals", "tag-01"), []);
  assert.deepEqual(projectIds(workspace, "industries", "every_text_equals", "Finance"), ["beta", "gamma"]);
  assert.deepEqual(projectIds(workspace, "industries", "none_text_equals", "Legal"), ["beta", "gamma"]);
});

test("multi-select and people filter selections compare their stored IDs", () => {
  const workspace = coreParityWorkspace();
  const fields = workspace.dataSources[0].properties;
  fields.push(
    createProperty({ id:"filter-labels", name:"标签筛选", type:"multi_select", options:[{ id:"opt-live", name:"Weekly sync" }] }),
    createProperty({ id:"attendees", name:"成员", type:"people" }),
  );
  const [alpha, beta] = workspace.databaseItems;
  alpha.values["filter-labels"] = ["opt-live"];
  alpha.values.attendees = ["person-live"];
  beta.values["filter-labels"] = ["previous-opt"];
  for (const [property, value] of [["filter-labels", "opt-live"], ["attendees", "person-live"]]) {
    assert.deepEqual(projectIds(workspace, property, "contains", value), ["alpha"]);
    assert.deepEqual(projectIds(workspace, property, "does_not_contain", value), ["beta", "gamma"]);
  }
  assert.deepEqual(projectIds(workspace, "filter-labels", "contains", "previous-opt"), []);
});
