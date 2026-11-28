import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { evaluateFormula, formulaDependencies, isFormulaError, parseFormula } from "../src/domain/formula/engine.js";
import { createDatabaseView, createProperty, groupViewItems, projectViewItems, resolvePropertyValue } from "../src/domain/database.js";
import { migratePhase2 } from "../src/persistence/migrations.js";
import { coreParityWorkspace } from "./fixtures/core-parity-workspace.mjs";

test("Phase 2 formula AST supports typed operators, functions and bounded safe evaluation", () => {
  const lookup = (id) => ({ amount: 12, name: "Alpha", date: { start:"2026-09-19", end:null, includeTime:false, timeZone:null } })[id];
  assert.equal(evaluateFormula("{{amount}} * 2 + 1", lookup), 25);
  assert.equal(evaluateFormula("{{amount}} >= 10 and not false", lookup), true);
  assert.equal(evaluateFormula('if({{amount}} > 10, concat(upper({{name}}), "-", string(length({{name}}))), "small")', lookup), "ALPHA-5");
  assert.equal(evaluateFormula('contains(lower({{name}}), "pha")', lookup), true);
  assert.deepEqual(evaluateFormula('dateAdd({{date}}, 2, "days")', lookup), { start:"2026-09-21", end:null, includeTime:false, timeZone:null });
  assert.deepEqual(evaluateFormula('dateSubtract({{date}}, 1, "days")', lookup), { start:"2026-09-18", end:null, includeTime:false, timeZone:null });
  assert.equal(evaluateFormula('dateBetween(dateAdd({{date}}, 7, "days"), {{date}}, "weeks")', lookup), 1);
  assert.equal(evaluateFormula('formatDate({{date}}, "DD/MM/YYYY")', lookup), "19/09/2026");
  assert.deepEqual(formulaDependencies('{{amount}} + length({{name}})'), ["amount", "name"]);
  assert.equal(parseFormula("true or false").kind, "BinaryExpression");
  assert.equal(isFormulaError(evaluateFormula("unknownFunction(1)", lookup)), true);
  assert.equal(isFormulaError(evaluateFormula("1 / 0", lookup)), true);
  assert.equal(isFormulaError(evaluateFormula("((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((1))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))", lookup)), true);
  const source = fs.readFileSync("src/domain/formula/engine.js", "utf8");
  assert.doesNotMatch(source, /\beval\s*\(|\bFunction\s*\(/);
});

test("Phase 2 formula properties can consume Relation/Rollup values and report cycles", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "projects");
  const item = workspace.databaseItems.find((entry) => entry.id === "alpha");
  source.properties.push(
    createProperty({ id:"richFormula", name:"公式验收", type:"formula", config:{ expression:'if({{rollup}} >= 4, concat(upper({{title}}), ":", string({{rollup}})), "low")' } }),
    createProperty({ id:"cycleA", name:"Cycle A", type:"formula", config:{ expression:"{{cycleB}} + 1" } }),
    createProperty({ id:"cycleB", name:"Cycle B", type:"formula", config:{ expression:"{{cycleA}} + 1" } }),
  );
  assert.equal(resolvePropertyValue(workspace, source, item, source.properties.find((entry)=>entry.id==="richFormula")), "ALPHA 项目:4.5");
  const cycle = resolvePropertyValue(workspace, source, item, source.properties.find((entry)=>entry.id==="cycleA"));
  assert.equal(cycle.error.code, "CYCLE");
});

test("Phase 2 filter AST, stable three-level sort and structured grouping are pure projections", () => {
  const workspace = coreParityWorkspace();
  const source = workspace.dataSources.find((entry) => entry.id === "projects");
  const originalItems = workspace.databaseItems;
  const view = createDatabaseView({
    sourceId:"projects",
    type:"table",
    filter:{
      kind:"group", op:"and", children:[
        { kind:"condition", propertyId:"amount", operator:"greater_than_or_equal", value:-20 },
        { kind:"group", op:"or", children:[
          { kind:"condition", propertyId:"status", operator:"equals", value:"doing" },
          { kind:"condition", propertyId:"title", operator:"starts_with", value:"Beta" },
        ]},
      ],
    },
    sorts:[
      { propertyId:"amount", direction:"desc" },
      { propertyId:"status", direction:"asc" },
      { propertyId:"title", direction:"asc" },
    ],
  });
  assert.deepEqual(projectViewItems(workspace, view).map((entry)=>entry.id), ["alpha","beta"]);
  assert.equal(workspace.databaseItems, originalItems);
  assert.equal(workspace.databaseItems.length, 4);

  const grouped = createDatabaseView({
    sourceId:"projects",
    type:"board",
    grouping:{ primaryPropertyId:"status", secondaryPropertyId:"people", hiddenGroupKeys:["done"], order:["doing","todo","done"], showEmpty:true },
  });
  const groups = groupViewItems(workspace, grouped);
  assert.deepEqual(groups.map((group)=>group.key), ["doing","todo"]);
  assert.ok(groups[0].secondaryGroups.some((group)=>group.key==="person-a"));
  assert.equal(workspace.databaseItems.length, 4);
});

test("Phase 2 migration is deterministic, idempotent and does not duplicate items", () => {
  const before = coreParityWorkspace();
  before.schemaVersion = 7;
  // The current factory sets the new gallery default explicitly. This v7
  // fixture must keep the old, implicit preview choice to test its migration.
  delete before.databaseViews.find((view) => view.id === "view-gallery").config.gallery.preview.kind;
  before.databaseViews[0] = {
    ...before.databaseViews[0],
    filter:{ and:[{ propertyId:"amount", operator:"greater_than", value:0 }, { propertyId:"title", operator:"contains", value:"项目" }] },
    groupBy:"status",
  };
  const migrated = migratePhase2(before);
  const again = migratePhase2(migrated);
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(again, migrated);
  assert.equal(migrated.databaseItems.length, before.databaseItems.length);
  assert.equal(migrated.dataSources.length, before.dataSources.length);
  assert.equal(migrated.databaseViews[0].filter.kind, "group");
  assert.equal(migrated.databaseViews[0].grouping.primaryPropertyId, "status");
  assert.equal(migrated.databaseViews.find((entry)=>entry.id==="view-calendar").config.calendar.mode, "month");
  assert.equal(migrated.databaseViews.find((entry)=>entry.id==="view-timeline").config.timeline.scale, "week");
  assert.equal(migrated.databaseViews.find((entry)=>entry.id==="view-gallery").config.gallery.preview.kind, "page-cover");
});

test("Phase 2 linked views retain independent query/work-surface config over one source", () => {
  const workspace = migratePhase2(coreParityWorkspace());
  const primary = workspace.databaseViews.find((entry)=>entry.id==="view-table");
  const linked = createDatabaseView({
    sourceId:primary.sourceId,
    type:"calendar",
    linked:true,
    filter:{ kind:"condition", propertyId:"status", operator:"equals", value:"doing" },
    sorts:[{propertyId:"amount",direction:"desc"},{propertyId:"date",direction:"asc"},{propertyId:"title",direction:"asc"}],
    grouping:{ primaryPropertyId:"status", secondaryPropertyId:null, hiddenGroupKeys:[], order:["doing","todo"], showEmpty:false },
    config:{ calendar:{ datePropertyId:"date", mode:"week", showWeekends:true, startOfWeek:1 } },
  });
  assert.equal(linked.sourceId, primary.sourceId);
  assert.equal(linked.linked, true);
  assert.notDeepEqual(linked.filter, primary.filter);
  assert.equal(linked.sorts.length, 3);
  assert.equal(linked.config.calendar.mode, "week");
  assert.equal(workspace.databaseItems.filter((item)=>item.sourceId==="projects").length, 3);
});
