import { browserScenario } from "./harness.mjs";

await browserScenario("v11-notion-html-import49", async ({ page, check, assert }) => {
  const outsideRequests = [];
  page.on("request", (request) => {
    if (/^https?:\/\//i.test(request.url()) && !/^http:\/\/127\.0\.0\.1:5178\//.test(request.url())) outsideRequests.push(request.url());
  });
  const result = await page.evaluate(async () => {
    const { parseNotionHtmlPage, notionHtmlToBlocks } = await import("/src/import/notionHtml.js");
    const html = `<!doctype html><html><head><style>@import url('https://outside.invalid/never.css');</style></head><body>
      <article class="page" id="11111111-1111-1111-1111-111111111111" data-notion-page-icon="/icons/activity_lightgray.svg">
        <header><img class="page-cover-image" src="assets/cover.jpg" style="object-position:center 37%"><h1 class="page-title">Test Wiki</h1>
          <table class="properties"><tr class="property-row property-row-checkbox"><th>Done</th><td><input type="checkbox" checked></td></tr></table></header>
        <div class="page-body"><h1>Heading</h1><div class="column-list" data-notion-column-list>
          <div class="column" data-notion-column-ratio="0.56"><p><strong>Bold</strong> <mark data-notion-highlight="gray">Muted</mark> <a href="Child%2022222222222222222222222222222222.html">Child</a> <a href="https://example.invalid"><em>outside</em></a></p><blockquote>Quote</blockquote><ul><li>One<ul><li>Nested</li></ul></li></ul></div>
          <div class="column" data-notion-column-ratio="0.44"><figure class="image" data-notion-image="https://outside.invalid/original.jpg"><img src="assets/photo.jpg"><figcaption>Caption</figcaption></figure><img src="https://outside.invalid/not-local.jpg"></div>
        </div><details open><summary>Toggle</summary><div class="indented"><p>Inside</p></div></details>
        <figure class="link-to-page"><a href="Child%2022222222222222222222222222222222.html" data-notion-page-id="22222222-2222-2222-2222-222222222222">Child</a></figure>
        <div class="collection-content" id="33333333-3333-3333-3333-333333333333"><h4 class="collection-title">Collection</h4><table class="collection-content"><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody><tr id="44444444-4444-4444-4444-444444444444"><td><a href="Child%2022222222222222222222222222222222.html">Child</a></td><td>Value</td></tr><tr id="55555555-5555-5555-5555-555555555555"><td><a href="Untitled-1.html">Untitled</a></td><td>A</td></tr><tr id="66666666-6666-6666-6666-666666666666"><td><a href="Untitled-2.html">Untitled</a></td><td>B</td></tr></tbody></table></div>
        <div class="collection-content-wrapper"><table class="collection-content"><thead><tr><th>Title</th><th>Status</th></tr></thead><tbody><tr id="77777777-7777-7777-7777-777777777777"><td><a href="row.html" data-notion-page-id="88888888-8888-8888-8888-888888888888">Row</a></td><td>Ready</td></tr></tbody></table></div>
        <section><p>Unknown wrapper content</p></section><script>window.__notionExecuted = true</script></div></article></body></html>`;
    const descriptor = parseNotionHtmlPage("Wiki 11111111111111111111111111111111.html", new TextEncoder().encode(html));
    const metadata = [];
    let id = 0;
    const options = {
      idFactory: () => `test-${++id}`,
      resolvePage: (href) => href.startsWith("Child%20") ? "local-child" : null,
      resolveAsset: (href) => href === "assets/photo.jpg" ? { url: `life-asset://${"a".repeat(64)}` } : { url: href },
      resolveCollection: (entry) => { metadata.push(entry); return { type: "databaseView", props: { sourceId: "local-source", viewId: "local-view" } }; },
    };
    const blocks = notionHtmlToBlocks(descriptor, options);
    const fallback = notionHtmlToBlocks(descriptor, { ...options, resolveCollection: () => null });
    return { descriptor, blocks, metadata, fallback, executed: Boolean(window.__notionExecuted) };
  });
  await check("Extracts page appearance, links, assets and record properties", async () => {
    const d = result.descriptor;
    assert.equal(d.title, "Test Wiki");
    assert.equal(d.notionId, "1".repeat(32));
    assert.deepEqual(d.appearance, { coverHref: "assets/cover.jpg", coverPosition: 37, icon: "icon:activity" });
    assert.ok(d.assetHrefs.includes("assets/photo.jpg") && d.assetHrefs.includes("assets/cover.jpg"));
    assert.ok(d.childPagePaths.includes("Child%2022222222222222222222222222222222.html"));
    assert.deepEqual(d.ownedPageHrefs, d.childPagePaths);
    assert.equal(d.collections[0].rows[2].notionId, "6".repeat(32));
    assert.equal(d.collections.length, 2);
    assert.deepEqual(d.collections[1], { id: null, title: "Test Wiki", rowIds: ["8".repeat(32)], rows: [{ notionId: "8".repeat(32), title: "Row", href: "row.html" }], propertyNames: ["Title", "Status"] });
    assert.deepEqual(d.recordProperties[0], { name: "Done", type: "checkbox", value: true, hrefs: [] });
  });
  await check("Builds editable text, nested layout, links and local image", async () => {
    const columns = result.blocks.find((entry) => entry.type === "columnList");
    assert.equal(columns.props.columns, 2);
    assert.deepEqual(columns.children.map((column) => column.props.width), [56, 44]);
    const first = columns.children[0].children;
    const inline = first.find((entry) => entry.type === "paragraph").content;
    assert.ok(inline.some((entry) => entry.text === "Bold" && entry.styles.bold));
    assert.ok(inline.some((entry) => entry.text === "Muted" && entry.styles.textColor === "gray"));
    assert.ok(inline.some((entry) => entry.type === "pageMention" && entry.props.pageId === "local-child"));
    assert.ok(inline.some((entry) => entry.type === "link" && entry.content[0].styles.italic));
    assert.ok(first.some((entry) => entry.type === "quote"));
    assert.equal(first.find((entry) => entry.type === "bulletListItem").children[0].type, "bulletListItem");
    const second = columns.children[1].children;
    assert.equal(second[0].type, "image");
    assert.equal(second[0].props.caption, "Caption");
    assert.match(second[0].props.url, /^life-asset:\/\//);
    assert.equal(second[1].type, "paragraph");
    assert.ok(result.blocks.some((entry) => entry.type === "toggleListItem" && entry.children[0].type === "paragraph"));
    assert.ok(result.blocks.some((entry) => entry.type === "pageLink" && entry.props.pageId === "local-child"));
  });
  await check("Resolves a collection or preserves its visible table", async () => {
    assert.deepEqual(result.metadata[0], { id: "3".repeat(32), title: "Collection", rowIds: ["4".repeat(32), "5".repeat(32), "6".repeat(32)], rows: [{ notionId: "4".repeat(32), title: "Child", href: "Child%2022222222222222222222222222222222.html" }, { notionId: "5".repeat(32), title: "Untitled", href: "Untitled-1.html" }, { notionId: "6".repeat(32), title: "Untitled", href: "Untitled-2.html" }], propertyNames: ["Name", "Note"] });
    assert.equal(result.metadata.length, 2);
    assert.deepEqual(result.metadata[1], result.descriptor.collections[1]);
    assert.equal(result.blocks.filter((entry) => entry.type === "databaseView" && entry.props.sourceId === "local-source" && entry.props.viewId === "local-view").length, 2);
    const table = result.fallback.find((entry) => entry.type === "table");
    assert.equal(table.content.rows[1].cells[1][0].text, "Value");
    assert.equal(result.fallback.filter((entry) => entry.type === "table").length, 2);
    assert.ok(result.blocks.some((entry) => entry.content?.some?.((item) => item.text === "Unknown wrapper content")));
  });
  await check("Keeps source inert and remote images out of native image blocks", async () => {
    assert.equal(result.executed, false);
    const serialized = JSON.stringify(result.blocks);
    assert.ok(!serialized.includes("https://outside.invalid/not-local.jpg"));
    assert.deepEqual(outsideRequests, []);
  });
});
