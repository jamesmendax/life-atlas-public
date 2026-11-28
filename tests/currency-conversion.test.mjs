import assert from "node:assert/strict";
import test from "node:test";
import { createDataSource, projectViewItems, resolvePropertyValue } from "../src/domain/database.js";
import { formatPropertyValue, READ_ONLY_PROPERTY_TYPES } from "../src/domain/databaseProperties.js";
import { computeColumnStat } from "../src/domain/databaseStats.js";
import { chartProjection, formFields } from "../src/domain/viewProjections.js";
import { currencyConfigIssue } from "../src/domain/currencyConversion.js";
import { duplicatePageIndependently } from "../src/domain/pageBundle.js";
import { CURRENT_SCHEMA_VERSION } from "../src/persistence/migrations.js";

const quoteConfig = {
  baseCurrency: "USD", amountPropertyId: "amount", currencyPropertyId: "currency",
  ratePropertyId: "rate", rateDatePropertyId: "date",
};

// Fictional Finance OS acceptance values, including the edited EUR contribution.
// Quotes are synthetic amounts of USD per unit of the source currency.
function finance() {
  const source = createDataSource({ id: "transactions", ownerPageId: "ledger", properties: [
    { id: "amount", name: "金额", type: "number" },
    { id: "currency", name: "原币", type: "select", options: [
      { id: "jpy", name: "JPY" }, { id: "eur", name: "EUR" }, { id: "usd", name: "USD" },
    ] },
    { id: "date", name: "交易日期", type: "date" }, { id: "rate", type: "number" },
    { id: "converted", name: "折算金额", type: "converted_amount", config: quoteConfig },
    { id: "manual", type: "formula", config: { expression: 'round(prop("金额") * 0.002364865, 2)' } },
  ] });
  const items = [
    { id: "finance-trip-fx", values: { title: "日元样本 · 需要汇率规范化", amount: 14800, currency: "jpy", rate: 0.006, date: { start: "2026-11-15" } } },
    { id: "finance-top-up-1", values: { title: "Emergency fund top-up", amount: 800, currency: "eur", rate: 1.10, date: { start: "2026-07-15T13:00", includeTime: true, timeZone: "America/Los_Angeles" } } },
    { id: "base", values: { title: "本位币", amount: -12.50, currency: "usd" } },
  ].map(item => ({ ...item, sourceId: source.id, pageId: item.id + "-page" }));
  const budget = createDataSource({ id: "trips", properties: [
    { id: "entries", type: "relation", config: { targetSourceId: source.id } },
    { id: "spent", type: "rollup", config: { relationPropertyId: "entries", targetPropertyId: "converted", aggregation: "sum" } },
  ] });
  const trip = { id: "finance-trip-japan", sourceId: budget.id, values: { entries: items.map(item => item.id) } };
  const pages = [{ id: "ledger", pageType: "database", databaseSourceId: source.id, content: [] },
    ...items.map(item => ({ id: item.pageId, content: [], title: item.values.title }))];
  const workspace = { schemaVersion: CURRENT_SCHEMA_VERSION, pages, dataSources: [source, budget], databaseItems: [...items, trip] };
  const field = id => source.properties.find(property => property.id === id);
  const sorted = direction => projectViewItems(workspace, { sourceId: source.id, type: "table", sorts: [{ propertyId: "converted", direction }] }).map(item => item.id);
  const rollup = budget.properties.find(property => property.id === "spent");
  const chart = (extra = {}) => chartProjection(workspace, source, items, { kind: "column", xPropertyId: "currency", valuePropertyId: "converted", aggregation: "sum", ...extra });
  return { workspace, source, items, budget, trip, rollup, field, sorted, chart };
}

test("fictional quoted transactions sort, sum, chart and roll up in their configured base currency", () => {
  const { workspace, source, items, budget, trip, field, sorted, rollup, chart } = finance();
  const before = structuredClone(items);
  assert.equal(currencyConfigIssue(source, quoteConfig), null);
  const amounts = items.map(item => resolvePropertyValue(workspace, source, item, field("converted")));
  assert.deepEqual(amounts, [88.8, 880, -12.5]);
  assert.deepEqual(amounts.map(value => formatPropertyValue(workspace, field("converted"), value)), ["USD 88.80", "USD 880.00", "-USD 12.50"]);
  assert.deepEqual(sorted("desc"), ["finance-top-up-1", "finance-trip-fx", "base"]);
  assert.deepEqual(computeColumnStat(workspace, source, items, field("converted"), "sum"), { value: 956.3, text: "USD 956.30" });
  const total = resolvePropertyValue(workspace, budget, trip, rollup);
  assert.equal(total, 956.3);
  assert.equal(formatPropertyValue(workspace, rollup, total), "USD 956.30");
  assert.equal(chart().total, 956.3);
  assert.deepEqual(chart().points.map(point => point.value), amounts);
  assert.equal(chart().valueLabel, "折算金额 (USD)");
  assert.equal(resolvePropertyValue(workspace, source, items[0], field("manual")), 35);
  assert.deepEqual(items, before);
  assert.ok(READ_ONLY_PROPERTY_TYPES.includes("converted_amount"));
  assert.ok(formFields(source, {}).every(field => field.property.type !== "converted_amount"));
});

test("unknown currencies, invalid rates and invalid quote dates withhold reports and sort after valid amounts", () => {
  const { workspace, source, items, budget, trip, field, sorted, chart, rollup } = finance();
  const original = { ...items[0].values };
  for (const bad of [{ currency: "" }, { currency: "deleted-option-id" }, { rate: null }, { rate: -1 }, { rate: 0 }, { rate: Infinity },
    { rate: true }, { date: null }, { date: { start: "2025-02-29" } }, { date: "2026-11-15T25:01" }]) {
    items[0].values = { ...original, ...bad };
    const result = resolvePropertyValue(workspace, source, items[0], field("converted"));
    assert.equal(result.error.code, "FX");
    assert.ok(formatPropertyValue(workspace, field("converted"), result).includes(result.error.message));
    assert.equal(computeColumnStat(workspace, source, items, field("converted"), "average").value, null);
    assert.equal(resolvePropertyValue(workspace, budget, trip, rollup).error.code, "FX");
    assert.match(chart().currencyIssue, /1 条记录/);
    assert.equal(chart().total, null);
    assert.deepEqual(chart().points, []);
    assert.equal(chart({ aggregation: "count" }).total, 3);
    assert.equal(sorted("desc").at(-1), items[0].id);
    assert.equal(sorted("asc").at(-1), items[0].id);
  }
});

test("bound raw amounts refuse mixed units while single-currency and unbound legacy totals retain nominal amounts", () => {
  const { workspace, source, items, budget, trip, field, chart, rollup } = finance();
  assert.match(computeColumnStat(workspace, source, items, field("amount"), "sum").text, /多种货币/);
  assert.match(chart({ valuePropertyId: "amount" }).currencyIssue, /多种货币/);
  rollup.config.targetPropertyId = "amount";
  assert.match(resolvePropertyValue(workspace, budget, trip, rollup).error.message, /多种货币/);
  trip.values.entries = [items[0].id];
  assert.equal(resolvePropertyValue(workspace, budget, trip, rollup), 14800);
  source.properties = source.properties.filter(property => property.type !== "converted_amount");
  assert.equal(computeColumnStat(workspace, source, items, field("amount"), "sum").value, 15587.5);
});

test("text currency codes and base minor units are supported and independent copies keep source-local configuration", () => {
  const { workspace, source, items, field } = finance();
  const converted = field("converted");
  field("currency").type = "text";
  items[1].values.currency = " eUr ";
  converted.config.baseCurrency = "JPY";
  assert.equal(resolvePropertyValue(workspace, source, items[0], converted), 14800);
  items[1].values.rate = 1.101;
  assert.equal(resolvePropertyValue(workspace, source, items[1], converted), 881);
  const copy = duplicatePageIndependently(workspace, "ledger", { id: "copy" });
  const copiedSource = copy.workspace.dataSources.find(entry => entry.id === copy.page.databaseSourceId);
  const copiedProperty = copiedSource.properties.find(property => property.type === "converted_amount");
  const copiedItems = copy.workspace.databaseItems.filter(item => item.sourceId === copiedSource.id);
  const copiedEuro = copiedItems.find(item => item.values.title === "Emergency fund top-up");
  assert.notEqual(copiedEuro.id, items[1].id);
  assert.deepEqual(copiedProperty.config, converted.config);
  assert.equal(resolvePropertyValue(copy.workspace, copiedSource, copiedEuro, copiedProperty), 881);
  copiedEuro.values.rate = 2;
  assert.equal(resolvePropertyValue(workspace, source, items[1], converted), 881);
  assert.equal(currencyConfigIssue(source, { ...quoteConfig, ratePropertyId: "amount" }), "手工汇率和原币金额需要不同的数字属性");
  assert.match(currencyConfigIssue(source, { ...quoteConfig, baseCurrency: "QQQ" }), /本位币代码/);
});

test("decimal quote multiplication rounds half a minor unit symmetrically for expenses and refunds", () => {
  const { workspace, source, items, field } = finance();
  const row = items[0];
  row.values.rate = 50.5;
  for (const sign of [1, -1]) {
    row.values.amount = sign * 0.29;
    assert.equal(resolvePropertyValue(workspace, source, row, field("converted")), sign * 14.65);
  }
  row.values.amount = Number.MAX_VALUE;
  assert.equal(resolvePropertyValue(workspace, source, row, field("converted")).error.code, "FX");
});
