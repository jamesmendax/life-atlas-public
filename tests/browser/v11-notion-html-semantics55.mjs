import { browserScenario } from "./harness.mjs";

await browserScenario("v11-notion-html-semantics55", async ({ page, check, assert, saved }) => {
  const before = await saved();
  const result = await page.evaluate(async (original) => {
    const { planNotionImport, buildNotionImport } = await import("/src/import/notionImport.js");
    const { resolvePropertyValue, updateDatabaseItemValue } = await import("/src/domain/database.js");
    const { READ_ONLY_PROPERTY_TYPES } = await import("/src/domain/databaseProperties.js");
    const importTime = "2026-03-01T00:00:00.000Z";
    const editTime = "2026-03-02T10:11:12.000Z";
    const sourceTimes = ["2026-02-03T04:05:06.000Z", "2026-02-04T08:09:00+08:00"];
    const createdTime = "2026-01-01T02:03:04.000Z";
    const databaseId = "a".repeat(32);
    const rowIds = ["b", "c", "d"].map((character) => character.repeat(32));
    const titles = ["Alpha", "Beta", "Gamma"];
    const databasePath = `Synthetic semantics ${databaseId}.html`;
    const csvPath = `Synthetic semantics ${databaseId}.csv`;
    const recordPaths = titles.map((title, index) => `${title} ${rowIds[index]}.html`);
    const headers = ["Name", "Empty number", "Updated", "Created", "Choice", "Tags", "Stage", "Computed", "Icon result", "Code", "Mail"];
    const icons = ["font", "hashtag", "clock", "clock", "list", "arrow-circle-down", "arrow-circle-down", "hashtag", "formula", "hashtag", "description"];
    const rows = [
      ["Alpha", "", "2026/02/03 12:05", "2026/01/01 10:03", "Review, ready", "Design, research, Society", "Waiting, review", "HIDE", "7", "00123", "reader@example.invalid"],
      ["Beta", "", "2026/02/04 08:09", "2026/01/01 10:03", "Review, ready", "Research & review", "Complete", "HIDE", "7", "00456", "reader@example.invalid"],
      ["Gamma", "", "2026/02/05 09:10", "2026/01/01 10:03", "Done", "", "", "SHOW", "8", "00789", "reader@example.invalid"],
    ];
    const csvCell = (value) => /[,"\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
    const doc = (id, title, body, properties = "") => `<article class="page" id="${id}"><header><h1 class="page-title">${title}</h1>${properties}</header><div class="page-body">${body}</div></article>`;
    const propertyRow = (name, type, value) => `<tr class="property-row property-row-${type}"><th>${name}</th><td>${value}</td></tr>`;
    const selected = (name, color) => `<span class="selected-value select-value-color-${color}">${name}</span>`;
    const files = {
      [databasePath]: doc(databaseId, "Synthetic semantics", `<div class="collection-content-wrapper"><table class="collection-content"><thead><tr>${headers.map((name, index) => `<th><img class="icon" src="/icons/${icons[index]}_gray.svg">${name}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => `<tr id="${rowIds[index]}"><td><a href="${encodeURIComponent(recordPaths[index])}">${row[0]}</a></td>${row.slice(1).map((value) => `<td>${value}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`),
      [csvPath]: [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n"),
    };
    for (const [index, recordPath] of recordPaths.entries()) {
      const properties = [
        propertyRow("Updated", "last_edited_time", index < sourceTimes.length ? `<time datetime="${sourceTimes[index]}">${rows[index][2]}</time>` : rows[index][2]),
        propertyRow("Created", "created_time", `<time datetime="${createdTime}">${rows[index][3]}</time>`),
        propertyRow("Choice", "select", selected(rows[index][4], index < 2 ? "pink" : "green")),
        propertyRow("Tags", "multi_select", index === 0 ? `${selected("Design, research", "pink")}${selected("Society", "orange")}` : index === 1 ? selected("Research &amp; review", "brown") : ""),
        propertyRow("Stage", "status", index === 0 ? selected("Waiting, review", "yellow") : index === 1 ? selected("Complete", "green") : ""),
        propertyRow("Computed", "formula", rows[index][7]),
        propertyRow("Code", "rich_text", rows[index][9]),
        propertyRow("Mail", "email", rows[index][10]),
      ].join("");
      files[recordPath] = doc(rowIds[index], titles[index], `<p>Synthetic body ${titles[index]}</p>`, `<table class="properties">${properties}</table>`);
    }
    const plan = planNotionImport(new Map(Object.entries(files).map(([filePath, content]) => [filePath, new TextEncoder().encode(content)])));
    const originalSnapshot = JSON.stringify(original);
    const planSnapshot = JSON.stringify(plan);
    let sequence = 0;
    const imported = await buildNotionImport(original, plan, { now: importTime, idFactory: (kind) => `semantics55-${kind}-${++sequence}` });
    const source = imported.workspace.dataSources.find((entry) => !original.dataSources.some((previous) => previous.id === entry.id));
    const properties = Object.fromEntries(source.properties.map((property) => [property.name, property]));
    const items = imported.workspace.databaseItems.filter((item) => item.sourceId === source.id);
    const first = items[0];
    const firstSnapshot = JSON.stringify(first);
    const edited = updateDatabaseItemValue(first, properties["Empty number"].id, 42, editTime);
    const labels = (item, property) => {
      const value = item.values[property.id];
      const ids = Array.isArray(value) ? value : value ? [value] : [];
      return ids.map((id) => property.options.find((option) => option.id === id)?.name);
    };
    return {
      importTime, editTime, sourceTimes, createdTime, csvPath,
      counts: plan.counts, errors: plan.errors, unrecognized: plan.unrecognized,
      collection: plan.databases[0].collection,
      recordProperties: plan.databases[0].records.map((record) => record.page.recordProperties),
      source, properties, items, report: imported.report, workspace: imported.workspace,
      labels: items.map((item) => Object.fromEntries(["Choice", "Tags", "Stage"].map((name) => [name, labels(item, properties[name])]))),
      modified: items.map((item) => resolvePropertyValue(imported.workspace, source, item, properties.Updated)),
      created: items.map((item) => resolvePropertyValue(imported.workspace, source, item, properties.Created)),
      edited, editedModified: resolvePropertyValue(imported.workspace, source, edited, properties.Updated),
      computedAfterEdit: resolvePropertyValue(imported.workspace, source, edited, properties.Computed),
      originalUnchanged: JSON.stringify(original) === originalSnapshot,
      planUnchanged: JSON.stringify(plan) === planSnapshot,
      firstUnchanged: JSON.stringify(first) === firstSnapshot,
      originalReferencesPreserved: Object.entries(original).every(([key, entities]) => !Array.isArray(entities) || entities.every((entity, index) => imported.workspace[key][index] === entity)),
      modifiedReadOnly: READ_ONLY_PROPERTY_TYPES.includes(properties.Updated.type),
      computedReadOnly: READ_ONLY_PROPERTY_TYPES.includes(properties.Computed.type),
    };
  }, before);

  await check("Uses the collection number icon when every source cell is empty", async () => {
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.unrecognized, []);
    assert.deepEqual(result.counts, { pages: 0, databases: 1, records: 3, attachments: 0, attachmentBytes: 0 });
    assert.equal(result.collection.propertyIcons[1], "/icons/hashtag_gray.svg");
    assert.ok(result.recordProperties.every((properties) => !properties.some((property) => property.name === "Empty number")));
    assert.equal(result.properties["Empty number"].type, "number");
    assert.deepEqual(result.items.map((item) => item.values[result.properties["Empty number"].id]), [null, null, null]);
  });

  await check("Prefers explicit record types over header icons and CSV guesses", async () => {
    assert.deepEqual(result.source.properties.map((property) => [property.name, property.type]), [
      ["Name", "title"], ["Empty number", "number"], ["Updated", "modified_time"], ["Created", "created_time"],
      ["Choice", "select"], ["Tags", "multi_select"], ["Stage", "status"], ["Computed", "text"], ["Icon result", "text"], ["Code", "text"], ["Mail", "email"],
    ]);
    assert.deepEqual(result.items.map((item) => item.values[result.properties.Code.id]), ["00123", "00456", "00789"]);
    assert.equal(result.items[0].values[result.properties.Mail.id], "reader@example.invalid");
  });

  await check("Preserves source timestamps as native created and modified times", async () => {
    assert.deepEqual(result.modified.slice(0, 2), result.sourceTimes);
    assert.equal(result.modified[2], "2026-02-05T09:10");
    assert.deepEqual(result.created, Array(3).fill(result.createdTime));
    assert.equal(result.modifiedReadOnly, true);
    for (const [index, item] of result.items.entries()) {
      assert.equal(Object.hasOwn(item.values, result.properties.Updated.id), false);
      assert.equal(Object.hasOwn(item.values, result.properties.Created.id), false);
      const recordPage = result.workspace.pages.find((entry) => entry.id === item.pageId);
      assert.equal(recordPage.updatedAt, result.modified[index]);
      assert.equal(recordPage.createdAt, result.createdTime);
    }
  });

  await check("Later native record edits update the imported modified-time value", async () => {
    assert.equal(result.edited.id, result.items[0].id);
    assert.equal(result.edited.pageId, result.items[0].pageId);
    assert.equal(result.edited.values[result.properties["Empty number"].id], 42);
    assert.equal(result.editedModified, result.editTime);
    assert.equal(result.edited.createdAt, result.createdTime);
    assert.equal(result.firstUnchanged, true);
  });

  await check("Preserves select labels including commas and their source colors", async () => {
    assert.deepEqual(result.properties.Choice.options.map(({ name, color }) => ({ name, color })), [
      { name: "Review, ready", color: "pink" }, { name: "Done", color: "green" },
    ]);
    assert.deepEqual(result.labels.map((entry) => entry.Choice), [["Review, ready"], ["Review, ready"], ["Done"]]);
    assert.equal(new Set(result.properties.Choice.options.map((option) => option.id)).size, 2);
  });

  await check("Preserves separate multiselect labels and colors without splitting label commas", async () => {
    assert.deepEqual(result.properties.Tags.options.map(({ name, color }) => ({ name, color })), [
      { name: "Design, research", color: "pink" }, { name: "Society", color: "orange" }, { name: "Research & review", color: "brown" },
    ]);
    assert.deepEqual(result.labels.map((entry) => entry.Tags), [["Design, research", "Society"], ["Research & review"], []]);
    assert.equal(new Set(result.properties.Tags.options.map((option) => option.id)).size, 3);
  });

  await check("Preserves status type, option labels, colors and empty values", async () => {
    assert.equal(result.properties.Stage.type, "status");
    assert.deepEqual(result.properties.Stage.options.map(({ name, color }) => ({ name, color })), [
      { name: "Waiting, review", color: "yellow" }, { name: "Complete", color: "green" },
    ]);
    assert.deepEqual(result.labels.map((entry) => entry.Stage), [["Waiting, review"], ["Complete"], []]);
    assert.equal(result.items[2].values[result.properties.Stage.id], null);
  });

  await check("Keeps formula results as explicit text and reports missing expressions", async () => {
    assert.equal(result.computedReadOnly, false);
    assert.equal(Object.hasOwn(result.properties.Computed.config, "expression"), false);
    assert.equal(Object.hasOwn(result.properties["Icon result"].config, "expression"), false);
    assert.deepEqual(result.items.map((item) => item.values[result.properties.Computed.id]), ["HIDE", "HIDE", "SHOW"]);
    assert.deepEqual(result.items.map((item) => item.values[result.properties["Icon result"].id]), ["7", "7", "8"]);
    assert.equal(result.computedAfterEdit, "HIDE");
    const formulaWarnings = result.report.warnings.filter((warning) => warning.property);
    assert.equal(formulaWarnings.length, 2);
    assert.deepEqual(formulaWarnings.map((warning) => [warning.path, warning.property]), [[result.csvPath, "Computed"], [result.csvPath, "Icon result"]]);
    for (const warning of formulaWarnings) {
      assert.deepEqual(Object.keys(warning).sort(), ["path", "property", "reason"]);
      assert.match(warning.reason, /公式表达式.*未包含.*文本.*不会自动计算/);
    }
    const viewWarnings = result.report.warnings.filter((warning) => !warning.property);
    assert.equal(viewWarnings.length, 1);
    assert.equal(viewWarnings[0].kind, "view_configuration_missing");
    assert.equal(viewWarnings[0].viewId, result.workspace.databaseViews.at(-1).id);
    assert.equal(result.report.warnings.length, 3);
    assert.deepEqual(result.report.unrecognizedValues, []);
    assert.equal(Object.hasOwn(result.workspace, "warnings"), false);
  });

  await check("Leaves all original entities and the import plan unchanged", async () => {
    assert.equal(result.originalUnchanged, true);
    assert.equal(result.originalReferencesPreserved, true);
    assert.equal(result.planUnchanged, true);
    for (const [key, entities] of Object.entries(before)) {
      if (Array.isArray(entities)) assert.deepEqual(result.workspace[key].slice(0, entities.length), entities, key);
    }
    const recordPages = result.items.map((item) => result.workspace.pages.find((entry) => entry.id === item.pageId));
    assert.deepEqual(recordPages.map((entry) => entry.content[0].content[0].text), ["Synthetic body Alpha", "Synthetic body Beta", "Synthetic body Gamma"]);
    assert.equal(result.workspace.databaseViews.length, before.databaseViews.length + 1);
    assert.equal(result.workspace.databaseViews.at(-1).type, "table");
  });
});
