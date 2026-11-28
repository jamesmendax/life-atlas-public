import { browserScenario } from "./harness.mjs";
import JSZip from "jszip";

await browserScenario("v14-import-occurrence129", async ({ page, check, assert, saved, persisted }) => {
  const before = await saved();
  const makeFiles = (offset, label) => {
    const id = (value) => (value + offset).toString(16).padStart(32, "0");
    const rootId = id(1), sourceId = id(2), otherSourceId = id(3), recordIds = [id(4), id(5), id(6)];
    const sourcePath = `${label} collection ${sourceId}.html`, otherPath = `${label} duplicate ${otherSourceId}.html`;
    const recordPaths = recordIds.map((recordId, index) => `${label} record ${index} ${recordId}.html`);
    const doc = (notionId, title, body) => `<article class="page" id="${notionId}"><header><h1 class="page-title">${title}</h1></header><div class="page-body">${body}</div></article>`;
    const collection = (occurrence, rows, headers = ["Name", "Note"]) => `<div class="collection-content" id="${occurrence}"><h4 class="collection-title">Shared inventory</h4><table class="collection-content"><thead><tr>${headers.map((name) => `<th>${name}</th>`).join("")}</tr></thead><tbody>${rows.map((index) => `<tr id="${recordIds[index]}">${headers.map((name) => name === "Name" ? `<td><a href="${encodeURIComponent(recordPaths[index])}">${label} ${index}</a></td>` : `<td>${name} ${index}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    const rootPath = `${label} root ${rootId}.html`;
    const wrapperPath = `${label} linked ${id(7)}.html`;
    const files = {
      [rootPath]: doc(rootId, `${label} root`, `<p>Unrelated editable text</p>${collection(id(8), [0])}${collection(id(9), [1], ["Name", "Details", "Note"])}${collection(id(10), [0, 1, 2])}`),
      [wrapperPath]: doc(id(7), `${label} linked`, collection(sourceId, [])),
      [sourcePath]: doc(sourceId, "Shared inventory", collection(sourceId, [0, 1], ["Name", "Note", "Details"])),
      [sourcePath.replace(/\.html$/, ".csv")]: `Name,Note,Details\n${label} 0,Note 0,Details 0\n${label} 1,Note 1,Details 1\n`,
      [otherPath]: doc(otherSourceId, "Shared inventory", collection(otherSourceId, [2])),
      [otherPath.replace(/\.html$/, ".csv")]: `Name,Note\n${label} 2,Value 2\n`,
    };
    for (const [index, recordPath] of recordPaths.entries()) files[recordPath] = doc(recordIds[index], `${label} ${index}`, `<p>${label} body ${index}</p>`);
    return { files, label, rootPath, wrapperPath, sourcePath, otherPath };
  };
  const fixtures = [makeFiles(0, "Cedar"), makeFiles(100, "Orchid")];
  const results = await page.evaluate(async ({ original, fixtures }) => {
    const { planNotionImport, buildNotionImport } = await import("/src/import/notionImport.js");
    const outputs = [];
    let workspace = original;
    for (const fixture of fixtures) {
      const plan = planNotionImport(new Map(Object.entries(fixture.files).map(([path, text]) => [path, new TextEncoder().encode(text)])));
      const previous = JSON.stringify(workspace), planned = JSON.stringify(plan);
      let serial = 0;
      const result = await buildNotionImport(workspace, plan, { now: "2026-11-14T00:00:00.000Z", idFactory: (kind) => `${fixture.label}-${kind}-${++serial}` });
      outputs.push({ ...result, inputUnchanged: previous === JSON.stringify(workspace), planUnchanged: planned === JSON.stringify(plan), errors: plan.errors });
      workspace = result.workspace;
    }
    return outputs;
  }, { original: before, fixtures });
  const inspect = (result, label) => {
    const pages = result.workspace.pages.filter((entry) => entry.folderId === result.rootFolderId);
    const root = pages.find((entry) => entry.title === `${label} root`);
    const wrapper = pages.find((entry) => entry.title === `${label} linked`);
    const owner = pages.find((entry) => entry.pageType === "database" && result.workspace.databaseItems.filter((item) => item.sourceId === entry.databaseSourceId).length === 2);
    const linked = root.content.filter((entry) => entry.type === "databaseView");
    return { pages, root, wrapper, owner, linked };
  };
  await check("Fresh imports keep shared records but give separate collection occurrences independent view identities", async () => {
    for (const [index, result] of results.entries()) {
      assert.deepEqual(result.errors, []);
      assert.equal(result.inputUnchanged, true);
      assert.equal(result.planUnchanged, true);
      const { owner, linked, wrapper } = inspect(result, fixtures[index].label);
      assert.equal(linked.length, 2, "Mixed-source collection must remain a visible table instead of choosing the largest partial match");
      assert.deepEqual(linked.map((entry) => entry.props.sourceId), [owner.databaseSourceId, owner.databaseSourceId]);
      const linkedIds = [...linked, ...wrapper.content.filter((entry) => entry.type === "databaseView")].map((entry) => entry.props.viewId);
      assert.equal(linkedIds.length, 3);
      assert.equal(new Set([owner.databaseViewId, ...linkedIds]).size, 4, "Opening or editing one linked occurrence must not alias the canonical/default or another occurrence's view");
      for (const viewId of linkedIds) {
        const view = result.workspace.databaseViews.find((entry) => entry.id === viewId);
        assert.equal(view.sourceId, owner.databaseSourceId);
        assert.equal(view.linked, true);
      }
      assert.ok(owner.content.some((entry) => entry.type === "databaseView" && entry.props.viewId === owner.databaseViewId));
      assert.equal(result.workspace.databaseItems.filter((entry) => entry.sourceId === owner.databaseSourceId).length, 2);
      const source = result.workspace.dataSources.find((entry) => entry.id === owner.databaseSourceId);
      const visibleNames = linked.map((block) => result.workspace.databaseViews.find((entry) => entry.id === block.props.viewId).visiblePropertyIds?.map((id) => source.properties.find((property) => property.id === id)?.name));
      assert.deepEqual(visibleNames, [["Name", "Note"], ["Name", "Details", "Note"]], "Each imported fallback retains its own exported column subset and order");
    }
  });
  await check("Missing export view configuration is explicit and ambiguous collections preserve their exported content", async () => {
    for (const [index, result] of results.entries()) {
      const fixture = fixtures[index];
      const { root, linked } = inspect(result, fixture.label);
      const unknownViews = result.report.warnings.filter((entry) => entry.kind === "view_configuration_missing");
      assert.ok(unknownViews.some((entry) => entry.path === fixture.rootPath && entry.viewId === linked[0].props.viewId));
      assert.ok(unknownViews.some((entry) => entry.path === fixture.wrapperPath));
      assert.ok(result.report.warnings.some((entry) => entry.kind === "collection_source_unresolved" && entry.path === fixture.rootPath));
      const fallback = root.content.find((entry) => entry.type === "table");
      assert.ok(fallback && JSON.stringify(fallback).includes(`${fixture.label} 2`));
      assert.ok(root.content.some((entry) => entry.type === "paragraph" && JSON.stringify(entry.content).includes("Unrelated editable text")));
      for (const view of result.workspace.databaseViews.filter((entry) => linked.some((block) => block.props.viewId === entry.id))) {
        assert.equal(view.type, "table", "Fallback is labeled as unknown source configuration, never claimed source table fidelity");
        assert.equal(view.filter, null, "Observed export rows cannot be used to guess original filter predicates");
      }
    }
  });
  await check("A second unrelated import preserves every entity from the first import", async () => {
    for (const key of ["folders", "pages", "dataSources", "databaseViews", "databaseItems", "relations", "attachments"]) {
      assert.deepEqual(results[1].workspace[key].slice(0, results[0].workspace[key].length), results[0].workspace[key]);
    }
    const { owner, linked } = inspect(results[0], fixtures[0].label);
    const firstId = linked[0].props.viewId, otherId = linked[1].props.viewId;
    const changed = results[0].workspace.databaseViews.map((view) => view.id === firstId ? { ...view, type: "gallery", name: "Independent gallery", filter: { propertyId: "synthetic-property", operator: "is_empty" } } : view);
    assert.deepEqual(changed.find((entry) => entry.id === owner.databaseViewId), results[0].workspace.databaseViews.find((entry) => entry.id === owner.databaseViewId));
    assert.deepEqual(changed.find((entry) => entry.id === otherId), results[0].workspace.databaseViews.find((entry) => entry.id === otherId));
  });
  await check("The real ZIP import dialog commits independent references and retains them on reload", async () => {
    const zip = new JSZip();
    for (const [name, content] of Object.entries(fixtures[0].files)) zip.file(name, content);
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    await sidebar.locator(".workspace-switcher").click();
    await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name: "generic-occurrences129.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
    await dialog.getByRole("button", { name: "导入", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: "已导入" }).waitFor();
    await dialog.locator("summary").filter({ hasText: "需要检查" }).click();
    assert.match(await dialog.innerText(), /视图|布局/);
    const committed = await persisted((workspace) => workspace.folders.length === before.folders.length + 1);
    const folder = committed.folders.find((entry) => !before.folders.some((previous) => previous.id === entry.id));
    const { linked, owner, wrapper } = inspect({ workspace: committed, rootFolderId: folder.id }, "Cedar");
    assert.equal(new Set([owner.databaseViewId, ...linked.map((block) => block.props.viewId), wrapper.content.find((block) => block.type === "databaseView").props.viewId]).size, 4);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await sidebar.waitFor();
    const reopened = await saved();
    for (const key of ["pages", "dataSources", "databaseViews", "databaseItems", "relations", "attachments"]) assert.deepEqual(reopened[key], committed[key]);
  });
});
