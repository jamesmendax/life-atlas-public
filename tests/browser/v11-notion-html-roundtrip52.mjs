import { browserScenario } from "./harness.mjs";
import JSZip from "jszip";
import { PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";

await browserScenario("v11-notion-html-roundtrip52", async ({ page, check, assert, saved, persisted }) => {
  const outside = [];
  page.on("request", (request) => {
    if (/^https?:\/\//i.test(request.url()) && !/^http:\/\/127\.0\.0\.1:5178\//.test(request.url())) outside.push(request.url());
  });
  const before = await saved();
  const result = await page.evaluate(async (original) => {
    const { planNotionImport, buildNotionImport } = await import("/src/import/notionImport.js");
    const rootId = "1".repeat(32), dbId = "2".repeat(32), firstId = "3".repeat(32), secondId = "4".repeat(32), otherId = "5".repeat(32);
    const root = `Root ${rootId}.html`, database = `Tasks ${dbId}.html`, first = `Untitled ${firstId}.html`, second = `Untitled ${secondId}.html`, other = `Other ${otherId}.html`;
    const doc = (id, title, body, header = "") => `<article class="page" id="${id}"><header>${header}<h1 class="page-title">${title}</h1></header><div class="page-body">${body}</div></article>`;
    const link = (file) => encodeURIComponent(file);
    const entries = new Map(Object.entries({
      [root]: doc(rootId, "Root", `<figure class="link-to-page"><a href="${link(database)}">Tasks</a></figure><p><a href="${link(other)}">Navigation only</a></p><div class="column-list"><div class="column" data-notion-column-ratio="0.6"><p>Editable</p><figure class="image"><img src="photo.png"><figcaption>Photo caption</figcaption></figure></div><div class="column" data-notion-column-ratio="0.4"><p>Right</p><figure class="image"><img src="https://outside.invalid/missing.png"><figcaption>Missing caption</figcaption></figure></div></div>`, `<img class="page-cover-image" src="photo.png" style="object-position:center 37%">`),
      [database]: doc(dbId, "Tasks", `<div class="collection-content-wrapper"><table class="collection-content"><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody><tr id="${firstId}"><td><a href="${link(first)}">Untitled</a></td><td>One</td></tr><tr id="${secondId}"><td><a href="${link(second)}">Untitled</a></td><td>Two</td></tr></tbody></table></div>`),
      [`Tasks ${dbId}.csv`]: "Name,Note\nUntitled,One\nUntitled,Two\n",
      [first]: doc(firstId, "Untitled", `<p>First record <a href="${link(second)}" data-notion-page-id="${secondId}">Second</a></p>`),
      [second]: doc(secondId, "Untitled", "<p>Second record</p>"),
      [other]: doc(otherId, "Other", "<p>Other body</p>"),
      "photo.png": "synthetic image bytes",
    }).map(([path, text]) => [path, new TextEncoder().encode(text)]));
    const plan = planNotionImport(entries);
    let sequence = 0;
    const imported = await buildNotionImport(original, plan, { now: "2026-01-02T00:00:00Z", idFactory: (kind) => `html52-${kind}-${++sequence}`, uploadAttachment: async () => ({ url: `life-asset://${"a".repeat(64)}` }) });
    return { files: Object.fromEntries([...entries].map(([name, bytes]) => [name, new TextDecoder().decode(bytes)])), counts: plan.counts, errors: plan.errors, issues: plan.unrecognized, report: imported.report, workspace: imported.workspace, rootFolderId: imported.rootFolderId };
  }, before);
  await check("Maps companion and duplicate record identities to one database", async () => {
    assert.deepEqual(result.errors, []);
    assert.equal(result.counts.pages, 2);
    assert.equal(result.counts.databases, 1);
    assert.equal(result.counts.records, 2);
    assert.equal(result.counts.attachments, 1);
    const own = result.workspace.pages.filter((entry) => entry.folderId === result.rootFolderId);
    assert.equal(own.length, 5);
    const root = own.find((entry) => entry.title === "Root");
    const db = own.find((entry) => entry.pageType === "database");
    const records = own.filter((entry) => entry.title === "Untitled");
    assert.equal(db.parentPageId, root.id);
    assert.equal(own.find((entry) => entry.title === "Other").parentPageId, null);
    assert.equal(records.length, 2);
    const first = records.find((entry) => JSON.stringify(entry.content).includes("First record"));
    const second = records.find((entry) => JSON.stringify(entry.content).includes("Second record"));
    assert.ok(first && second && first.id !== second.id);
    assert.ok(JSON.stringify(first.content).includes(second.id));
    assert.ok(db.content.some((entry) => entry.type === "databaseView" && entry.props.sourceId === db.databaseSourceId && entry.props.viewId === db.databaseViewId));
  });
  await check("Keeps editable columns, local image and cover, and reports remote media", async () => {
    const root = result.workspace.pages.find((entry) => entry.folderId === result.rootFolderId && entry.title === "Root");
    const columns = root.content.find((entry) => entry.type === "columnList");
    assert.deepEqual(columns.children.map((entry) => entry.props.width), [60, 40]);
    assert.ok(JSON.stringify(columns).includes("Photo caption"));
    assert.ok(JSON.stringify(columns).includes("Missing caption"));
    assert.ok(!JSON.stringify(columns).includes("https://outside.invalid/missing.png"));
    assert.deepEqual(root.cover, { kind: "upload", value: `life-asset://${"a".repeat(64)}`, position: 37 });
    assert.ok(result.report.skipped.some((entry) => entry.reason.includes("图片未能本地化")));
    assert.deepEqual(outside, []);
  });
  await check("Preserves preexisting domains and survives local reload", async () => {
    for (const key of ["folders", "pages", "dataSources", "databaseViews", "databaseItems", "relations", "attachments"]) {
      assert.deepEqual(result.workspace[key].slice(0, before[key].length), before[key]);
    }
    const zip = new JSZip();
    for (const [name, content] of Object.entries(result.files)) zip.file(name, name === "photo.png" ? Buffer.from(PNG_1X1_BASE64, "base64") : content);
    const sidebar = page.getByRole("complementary", { name: "主导航" });
    await sidebar.locator(".workspace-switcher").click();
    await page.getByRole("menu", { name: "工作区菜单", exact: true }).getByRole("menuitem", { name: "从 Notion 导入…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "从 Notion 导入", exact: true });
    await dialog.getByLabel("选择 Notion 导出文件", { exact: true }).setInputFiles({ name: "structured-html52.zip", mimeType: "application/zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) });
    await dialog.getByRole("button", { name: "导入", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: "已导入" }).waitFor();
    const committed = await persisted((value) => value.folders.some((entry) => !before.folders.some((old) => old.id === entry.id)));
    const ownFolder = committed.folders.find((entry) => !before.folders.some((old) => old.id === entry.id));
    assert.ok(ownFolder);
    const committedRoot = committed.pages.find((entry) => entry.folderId === ownFolder.id && entry.title === "Root");
    assert.equal(committedRoot.cover?.kind, "upload");
    assert.equal(committedRoot.cover?.position, 37);
    assert.match(committedRoot.cover?.value || "", /^blob:/);
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await sidebar.waitFor();
    const reloaded = await saved();
    const importedPages = reloaded.pages.filter((entry) => entry.folderId === ownFolder.id);
    assert.equal(importedPages.length, 5);
    assert.ok(importedPages.some((entry) => JSON.stringify(entry.content).includes("First record")));
    assert.ok(importedPages.some((entry) => entry.pageType === "database" && entry.content.some((block) => block.type === "databaseView")));
    assert.deepEqual(importedPages.find((entry) => entry.id === committedRoot.id).cover, committedRoot.cover);
  });
});
