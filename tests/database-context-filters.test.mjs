import assert from "node:assert/strict";
import test from "node:test";
import { projectViewItems } from "../src/domain/database.js";
import { filterUsesRelativeDate, relationFilterDefaults } from "../src/domain/databaseFilters.js";

const condition = (propertyId, operator, value) => ({ kind: "condition", propertyId, operator, value });
const group = (op, ...children) => ({ kind: "group", op, children });
const projects = { id: "projects", properties: [] };
const tasks = {
  id: "tasks",
  properties: [
    { id: "title", type: "title" },
    { id: "due", type: "date" },
    { id: "project", type: "relation", config: { targetSourceId: "projects", relationLimit: 1 } },
    { id: "related", type: "relation", config: { targetSourceId: "projects" } },
  ],
};
const workspace = {
  dataSources: [projects, tasks],
  pages: [{ id: "page-archived", trashedAt: "2026-01-01T00:00:00Z" }],
  databaseItems: [
    { id: "alpha", sourceId: "projects" },
    { id: "beta", sourceId: "projects" },
    { id: "archived", sourceId: "projects", pageId: "page-archived" },
    ...Object.entries({
      previous: "2026-01-29",
      today: "2026-01-30",
      tomorrow: "2026-01-31",
      overlap: { start: "2026-01-29", end: "2026-01-30" },
      last: "2026-02-05",
      outside: "2026-02-06",
      missing: null,
      invalid: "invalid",
    }).map(([id, due]) => ({ id, sourceId: "tasks", values: { title: id, due } })),
  ],
};

test("relative date filters respect the local date, range overlap, midnight and year/month transitions", () => {
  const today = new Date(2026, 0, 30, 23, 59);
  const tomorrow = new Date(2026, 0, 31, 0, 0);
  const dateFilter = period => condition("due", "relative_date", period);
  const ids = (filter, now = today) => projectViewItems(workspace, { sourceId: tasks.id, filter }, { now }).map(item => item.id);

  assert.deepEqual(ids(dateFilter("today")), ["today", "overlap"]);
  assert.deepEqual(ids(dateFilter("today"), tomorrow), ["tomorrow"]);
  assert.deepEqual(ids(dateFilter("tomorrow")), ["tomorrow"]);
  assert.deepEqual(ids(dateFilter("next_7_days")), ["today", "tomorrow", "overlap", "last"]);
  assert.deepEqual(ids(dateFilter("this_month")), ["previous", "today", "tomorrow", "overlap"]);
  assert.deepEqual(ids(dateFilter("invalid")), []);
  assert.deepEqual(ids(dateFilter("today"), new Date(2025, 11, 31)), []);
  const compound = { or: [dateFilter("tomorrow"), group("and", dateFilter("next_7_days"), condition("title", "equals", "last"))] };
  assert.equal(filterUsesRelativeDate(compound), true);
  assert.deepEqual(ids(compound), ["tomorrow", "last"]);
  assert.deepEqual(ids(condition("due", "equals", "2026-01-30")), ["today"]);
});

test("relation defaults include only target-source records implied by all matching branches", () => {
  const alpha = condition("project", "equals", "alpha");
  const beta = condition("project", "equals", "beta");
  const unrelated = condition("title", "contains", "same");
  const defaults = filter => relationFilterDefaults(workspace, tasks, filter);
  assert.deepEqual(defaults(alpha), { project: ["alpha"] });
  assert.deepEqual(defaults(group("and", unrelated, group("or", alpha, group("and", alpha, unrelated)))), { project: ["alpha"] });
  assert.deepEqual(defaults({ and: [alpha, { or: [beta, unrelated] }] }), { project: ["alpha"] });
  assert.deepEqual(defaults(group("or", alpha, beta)), {});
  assert.deepEqual(defaults(group("and", alpha, beta)), {});
  assert.deepEqual(defaults(group("or", alpha, unrelated)), {});
  assert.deepEqual(defaults(group("and", condition("related", "equals", "alpha"), condition("related", "equals", "beta"))), { related: ["alpha", "beta"] });
  assert.deepEqual(defaults(condition("project", "equals", "today")), {});
  assert.deepEqual(defaults(condition("project", "equals", "archived")), {});
  assert.deepEqual(defaults(condition("project", "contains", "alpha")), {});
  assert.deepEqual(defaults(condition("project", "not_equals", "alpha")), {});
});

test("computed filters match real Boolean list members rather than list truthiness", () => {
  const formula = { id: "checks", type: "formula", config: { expression: 'if({{title}} == "mixed", [false, true], if({{title}} == "false-only", [false], if({{title}} == "invalid", 1 / 0, [])))' } };
  const source = { ...tasks, properties: [...tasks.properties, formula] };
  const context = {
    dataSources: [source],
    databaseItems: ["mixed", "false-only", "invalid", "empty"].map(id => ({ id, sourceId: source.id, values: { title: id } })),
  };
  const ids = operator => projectViewItems(context, { sourceId: source.id, filter: condition(formula.id, operator) }).map(item => item.id);
  assert.deepEqual(ids("any_checked"), ["mixed"]);
  assert.deepEqual(ids("any_unchecked"), ["mixed", "false-only"]);
  assert.deepEqual(ids("checked"), []);
  assert.deepEqual(ids("unchecked"), []);
  assert.deepEqual(ids("is_not_empty"), ["mixed", "false-only"]);
  assert.deepEqual(ids("is_empty"), ["empty"]);
});

test("relative windows use computed dates in nested filters across a month boundary", () => {
  const formula = { id: "scheduled", type: "formula", config: { expression: 'parseDate({{title}})' } };
  const source = { ...tasks, properties: [...tasks.properties, formula] };
  const values = {
    tooEarly: "2026-01-24", firstPast: "2026-01-25", yesterday: "2026-01-30",
    today: "2026-01-31", inMonth: "2026-02-27", monthEnd: "2026-02-28", invalid: "not a date",
  };
  const context = {
    dataSources: [source],
    databaseItems: Object.entries(values).map(([id, title]) => ({ id, sourceId: source.id, values: { title } })),
  };
  const now = new Date(2026, 0, 31, 14);
  const within = period => condition(formula.id, "relative_date", period);
  const ids = filter => projectViewItems(context, { sourceId: source.id, filter }, { now }).map(item => item.id);
  assert.deepEqual(ids(within("past_7_days")), ["firstPast", "yesterday", "today"]);
  assert.deepEqual(ids(group("or", within("yesterday"), within("next_month"))), ["yesterday", "today", "inMonth"]);
  assert.deepEqual(ids(condition("title", "relative_date", "today")), []);
});
