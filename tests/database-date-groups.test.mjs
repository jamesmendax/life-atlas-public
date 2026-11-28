import assert from "node:assert/strict";
import test from "node:test";
import { createDataSource, createDatabaseView, groupViewDateValue, groupViewItems, groupViewLabel, UNASSIGNED_GROUP_KEY } from "../src/domain/database.js";
import { mapNotionSourceViewConfiguration } from "../src/import/notionSourceViewConfig.js";

const source = createDataSource({ id: "ledger" });
const date = (id, start, settings = {}) => ({ id, sourceId: source.id, values: { date: start && { start, ...settings } } });
const records = [date("april-1", "2026-04-01"), date("march", "2026-03-20"), date("april-2", "2026-04-30", { end: "2026-05-04" }),
  date("previous-year", "2026-01-01T03:00:00Z", { timeZone: "America/New_York", includeTime: true }),
  date("blank", null), date("malformed", "2026-02-30")];
const workspace = { dataSources: [source], databaseItems: records };
const makeView = (type, grouping) => createDatabaseView({ type, sourceId: source.id, grouping: { primaryPropertyId: "date", ...grouping } });
const summarize = view => groupViewItems(workspace, view, records).map(({ key, items }) => [key, items.map(item => item.id)]);

test("civil-date month groups share keys and labels across normal database views", () => {
  const expected = [["2026-04", ["april-1", "april-2"]], ["2026-03", ["march"]], ["2025-12", ["previous-year"]],
    [UNASSIGNED_GROUP_KEY, ["blank", "malformed"]]];
  for (const type of ["table", "board", "list", "gallery"]) {
    const view = makeView(type);
    assert.deepEqual(summarize(view), expected);
    assert.equal(groupViewLabel(workspace, view, "2026-04"), "2026年4月");
    assert.equal(groupViewLabel(workspace, view, UNASSIGNED_GROUP_KEY), UNASSIGNED_GROUP_KEY);
  }
});

test("year grouping preserves saved visibility and calendar ordering on a new view instance", () => {
  const first = makeView("table", { dateInterval: "year", dateSort: "asc", hiddenGroupKeys: [UNASSIGNED_GROUP_KEY] });
  const view = createDatabaseView(JSON.parse(JSON.stringify(first)));
  assert.deepEqual(summarize(view), [["2025", ["previous-year"]], ["2026", ["april-1", "march", "april-2"]]]);
  assert.equal(groupViewLabel(workspace, view, "2026"), "2026年");
});

test("manual date group order pins only relevant buckets and honors hidden and empty settings", () => {
  const grouping = { dateSort: "asc", hiddenGroupKeys: ["2026-03"], order: ["2026-04", "2025-01", "2026-99", UNASSIGNED_GROUP_KEY] };
  const view = makeView("gallery", grouping);
  assert.deepEqual(summarize(view), [["2026-04", ["april-1", "april-2"]], ["2025-01", []],
    [UNASSIGNED_GROUP_KEY, ["blank", "malformed"]], ["2025-12", ["previous-year"]]]);
  const hiddenEmpty = makeView("gallery", { ...grouping, showEmpty: false });
  assert.deepEqual(summarize(hiddenEmpty), summarize(view).filter(([, ids]) => ids.length));
});

test("group-scoped creation uses an editable civil date or an empty value", () => {
  const month = makeView("board");
  const year = makeView("board", { dateInterval: "year" });
  assert.deepEqual(groupViewDateValue(month, "2026-04"), { start: "2026-04-01", end: null, includeTime: false, timeZone: null });
  assert.equal(groupViewDateValue(year, "2026").start, "2026-01-01");
  assert.equal(groupViewDateValue(month, UNASSIGNED_GROUP_KEY), null);
  assert.equal(groupViewDateValue(month, "2026-99"), null);
  assert.equal(groupViewDateValue(year, "2026-04"), null);
});

test("source view configurations preserve valid date grouping and reject malformed bucket keys", () => {
  const input = { type: "board", name: "月度汇总", groupBy: "日期", grouping: { primaryPropertyId: "日期", dateInterval: "month",
    dateSort: "desc", order: ["2026-06", "2026-05"], hiddenGroupKeys: ["2026-06", UNASSIGNED_GROUP_KEY], showEmpty: false } };
  const mapped = mapNotionSourceViewConfiguration(input, source);
  assert.equal(mapped.valid, true, mapped.reason);
  assert.deepEqual(mapped.view.grouping, { ...input.grouping, primaryPropertyId: "date" });
  const malformed = mapNotionSourceViewConfiguration({ ...input, grouping: { ...input.grouping, order: ["2026-13"] } }, source);
  assert.equal(malformed.valid, false);
  assert.match(malformed.reason, /group|分组/);
});
