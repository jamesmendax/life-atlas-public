import { browserScenario } from "./harness.mjs";
import JSZip from "jszip";
import { mkdirSync, writeFileSync } from "node:fs";
import { PNG_1X1_BASE64 } from "../fixtures/full-workspace.mjs";

const run = process.env.V14_DESCRIPTION130_RUN || "local01";
const evidence = `.qa/LOCAL-NOTION-001/v14-linked-view129/description130/${run}`;
mkdirSync(evidence, { recursive: true });

export async function runDescription130Checks({ page, check, assert }) {
  const outside = [];
  page.on("request", (request) => {
    if (/^https?:\/\//i.test(request.url()) && !request.url().startsWith("http://127.0.0.1:5178/")) outside.push(request.url());
  });
  const direct = await page.evaluate(async () => {
    const { parseNotionHtmlPage: parse, notionHtmlToBlocks: convert } = await import("/src/import/notionHtml.js");
    const body = '<p>First body</p><details><summary>Nested</summary><p>Inside body</p></details><p>Last body</p>';
    const rich = 'Start &amp; <strong>bold <em>both</em></strong><u>under</u><s>strike</s><code>code</code><span class="highlight-yellow_background"><span class="highlight-teal">colour</span></span><br><a href="https://example.invalid/read"><em>external</em></a><a href="mailto:reader@example.invalid">mail</a><a href="Target.html"><strong>Read target</strong></a><a href="Target.html">Target</a><a href="assets/map.png"><em>Map file</em></a><a href="assets/list.pdf">List file</a><img src="assets/map.png" alt="Description map"><a href="missing.html">missing</a><a href="javascript:description130">unsafe</a><script>window.__description130Executed = true</script>';
    const doc = (description, content = body) => `<article class="page" id="11111111111111111111111111111111"><header><h1 class="page-title">Independent page</h1>${description === null ? "" : `<p class="page-description">${description}</p>`}</header><div class="page-body">${content}</div></article>`;
    const options = () => {
      let sequence = 0;
      return { idFactory: () => `direct130-${++sequence}`, resolvePage: (href) => href === "Target.html" ? "target130" : null,
        resolvePageTitle: () => "Target", resolveAsset: (href) => href === "assets/map.png" ? { url: `life-asset://${"a".repeat(64)}`, kind: "image" } : href === "assets/list.pdf" ? { url: `life-asset://${"b".repeat(64)}`, kind: "file" } : null };
    };
    const descriptor = parse("Independent page.html", new TextEncoder().encode(doc(rich)));
    const snapshot = JSON.stringify(descriptor);
    const blocks = convert(descriptor, options());
    const baseline = convert({ ...descriptor, description: "" }, options());
    const empty = [null, "", " \n &nbsp; <em> </em><br>", '<script>window.__description130Executed = true</script><img src="https://example.invalid/ignored.png">'].map((description) => convert(parse("Independent page.html", doc(description)), options()));
    const duplicates = [
      '<p>Same description</p>' + body,
      body + '<p><strong>Same</strong> description</p>',
      '<div class="column-list"><div class="column"><p>Same description</p></div><div class="column"><p>Other</p></div></div>' + body,
    ].map((content) => {
      const value = parse("Independent page.html", doc("Same description", content));
      return { with: convert(value, options()), without: convert({ ...value, description: "" }, options()) };
    });
    const linkedDuplicate = parse("Independent page.html", doc("Read target and Target", '<p><a href="Target.html">Read target</a> and <a href="Target.html">Target</a></p>' + body));
    const imageDuplicate = parse("Independent page.html", doc('Same description<img src="assets/map.png">', '<p>Same description</p><img src="assets/map.png">' + body));
    const invisible = parse("Independent page.html", doc("", ""));
    return { descriptor, blocks, baseline, empty, duplicates,
      linkedDuplicate: { with: convert(linkedDuplicate, options()), without: convert({ ...linkedDuplicate, description: "" }, options()) },
      imageDuplicate: { with: convert(imageDuplicate, options()), without: convert({ ...imageDuplicate, description: "" }, options()) },
      unchanged: snapshot === JSON.stringify(descriptor), repeated: convert(descriptor, options()),
      invisible: convert(invisible, options()), executed: Boolean(window.__description130Executed) };
  });
  writeFileSync(`${evidence}/dom.json`, JSON.stringify(direct, null, 2));
  await check("Header-only links and assets are inventoried through real DOM parsing", async () => {
    assert.ok(direct.descriptor.description.includes("<strong>bold <em>both</em></strong>"));
    assert.deepEqual(direct.descriptor.assetHrefs, ["assets/map.png", "assets/list.pdf"]);
    assert.ok(direct.descriptor.links.some((entry) => entry.href === "Target.html" && entry.text === "Read target"));
    assert.deepEqual(direct.descriptor.ownedPageHrefs, []);
    assert.deepEqual(direct.descriptor.childPagePaths, []);
    assert.deepEqual(direct.descriptor.collections, []);
  });
  await check("Description rich text, page links, file links and local image survive conversion", async () => {
    const content = direct.blocks[0].content;
    const text = (label) => content.find((item) => item.text === label);
    assert.deepEqual(text("Start & ").styles, {});
    assert.deepEqual(text("bold ").styles, { bold: true });
    assert.deepEqual(text("both").styles, { bold: true, italic: true });
    assert.deepEqual(text("under").styles, { underline: true });
    assert.deepEqual(text("strike").styles, { strike: true });
    assert.deepEqual(text("code").styles, { code: true });
    assert.deepEqual(text("colour").styles, { backgroundColor: "yellow", textColor: "green" });
    assert.ok(text("\n"));
    assert.deepEqual(content.find((item) => item.href === "https://example.invalid/read").content[0].styles, { italic: true });
    assert.ok(content.some((item) => item.href === "mailto:reader@example.invalid"));
    assert.deepEqual(content.find((item) => item.href === "lifeatlas://page/target130").content[0].styles, { bold: true });
    assert.ok(content.some((item) => item.type === "pageMention" && item.props.pageId === "target130"));
    assert.deepEqual(content.find((item) => item.href === `life-asset://${"a".repeat(64)}`).content[0].styles, { italic: true });
    assert.ok(content.some((item) => item.href === `life-asset://${"b".repeat(64)}`));
    assert.equal(direct.blocks[1].type, "image");
    assert.equal(direct.blocks[1].props.url, `life-asset://${"a".repeat(64)}`);
    assert.equal(direct.blocks[1].props.name, "Description map");
    assert.deepEqual(direct.blocks.slice(2), direct.baseline, "body blocks keep their IDs, content and order");
    assert.deepEqual(direct.repeated, direct.blocks);
    assert.equal(direct.unchanged, true);
    assert.equal(direct.executed, false);
    assert.ok(!JSON.stringify(direct.blocks).includes("javascript:"));
  });
  await check("Empty descriptions stay empty and explicit repeated source content is retained", async () => {
    for (const blocks of direct.empty) assert.deepEqual(blocks, direct.baseline);
    for (const pair of [...direct.duplicates, direct.linkedDuplicate]) {
      assert.equal(pair.with[0].type, "paragraph");
      assert.deepEqual(pair.with.slice(1), pair.without, "Header and body are separate source positions even when their text matches");
    }
    assert.equal(direct.imageDuplicate.with[0].type, "paragraph");
    assert.equal(direct.imageDuplicate.with[1].type, "image");
    assert.deepEqual(direct.imageDuplicate.with.slice(2), direct.imageDuplicate.without);
    assert.equal(direct.imageDuplicate.with.filter((block) => block.type === "image").length, 2);
    assert.deepEqual(direct.invisible, []);
  });

  for (const [suffix, label] of [["A", "Bird observations"], ["B", "Workshop inventory"]]) {
    await check(`Fresh ZIP ${suffix} preserves description-only references through plan and build`, async () => {
      const id = (digit) => digit.repeat(32);
      const root = `Overview ${id("1")}.html`, target = `Target ${id("2")}.html`, database = `Items ${id("3")}`;
      const doc = (pageId, title, description, body) => `<article class="page" id="${pageId}"><header><h1 class="page-title">${title}</h1>${description === null ? "" : `<p class="page-description">${description}</p>`}</header><div class="page-body">${body}</div></article>`;
      const collection = `<div class="collection-content" id="${id("3")}"><h4 class="collection-title">Items</h4><table class="collection-content"><thead><tr><th>Name</th><th>Note</th></tr></thead><tbody><tr><td>Entry ${suffix}</td><td>${label}</td></tr></tbody></table></div>`;
      const zip = new JSZip();
      zip.file(root, doc(id("1"), `Overview ${suffix}`, `<strong>${label}</strong> <a href="${encodeURIComponent(target)}">Target ${suffix}</a> <a href="assets/list.pdf">Checklist ${suffix}</a><img src="assets/map.png" alt="Map ${suffix}">`, `<p>Before ${suffix}</p>${collection}<p>After ${suffix}</p>`));
      zip.file(target, doc(id("2"), `Target ${suffix}`, null, `<p>Unrelated ${suffix}</p>`));
      zip.file(`${database}.csv`, `Name,Note\nEntry ${suffix},${label}\n`);
      zip.file("assets/list.pdf", `synthetic attachment ${suffix}`);
      zip.file("assets/map.png", Buffer.from(PNG_1X1_BASE64, "base64"));
      const bytes = await zip.generateAsync({ type: "nodebuffer" });
      writeFileSync(`${evidence}/fresh-${suffix}.zip`, bytes);
      const result = await page.evaluate(async ({ bytes, suffix }) => {
        const { readNotionExport, planNotionImport, buildNotionImport } = await import("/src/import/notionImport.js");
        const read = await readNotionExport(Uint8Array.from(bytes));
        const plan = planNotionImport(read.entries);
        const original = { folders: [{ id: "existing-folder", name: "Existing", parentId: null }], pages: [{ id: "existing-page", title: "Existing", content: [] }], dataSources: [], databaseViews: [], databaseItems: [], relations: [], attachments: [], sentinel: "unchanged" };
        const snapshot = JSON.stringify(original);
        let sequence = 0;
        const uploads = [];
        const built = await buildNotionImport(original, plan, { now: "2026-01-02T00:00:00Z", folderName: `Fresh ${suffix}`,
          idFactory: (kind) => `fresh130${suffix}-${kind}-${++sequence}`,
          uploadAttachment: async (name, data, mime) => { uploads.push({ name, size: data.length, mime }); return { url: `life-asset://${(name === "map.png" ? "a" : "b").repeat(64)}` }; } });
        return { readProblems: read.problems, counts: plan.counts, errors: plan.errors, unrecognized: plan.unrecognized,
          descriptors: plan.pages, built, uploads, unchanged: snapshot === JSON.stringify(original), original };
      }, { bytes: [...bytes], suffix });
      writeFileSync(`${evidence}/fresh-${suffix}.json`, JSON.stringify(result, null, 2));
      assert.deepEqual(result.readProblems, []);
      assert.deepEqual(result.errors, []);
      assert.deepEqual(result.unrecognized, []);
      assert.equal(result.counts.pages, 2);
      assert.equal(result.counts.databases, 1);
      assert.equal(result.counts.records, 1);
      assert.equal(result.counts.attachments, 2);
      assert.equal(result.built.report.attachments, 2);
      const own = result.built.workspace.pages.filter((entry) => entry.folderId === result.built.rootFolderId);
      const overview = own.find((entry) => entry.title === `Overview ${suffix}`);
      const targetPage = own.find((entry) => entry.title === `Target ${suffix}`);
      const source = result.built.workspace.dataSources[0];
      assert.equal(overview.parentPageId, null);
      assert.equal(targetPage.parentPageId, null, "description links do not establish ownership");
      assert.equal(overview.pageType || "page", "page");
      assert.deepEqual(overview.content.map((block) => block.type), ["paragraph", "image", "paragraph", "databaseView", "paragraph"]);
      assert.equal(overview.content[0].content[0].text, label);
      assert.equal(overview.content[0].content[0].styles.bold, true);
      assert.ok(overview.content[0].content.some((item) => item.type === "pageMention" && item.props.pageId === targetPage.id));
      assert.ok(overview.content[0].content.some((item) => item.href === `life-asset://${"b".repeat(64)}`));
      assert.equal(overview.content[1].props.url, `life-asset://${"a".repeat(64)}`);
      assert.equal(overview.content[2].content[0].text, `Before ${suffix}`);
      assert.equal(overview.content[3].props.sourceId, source.id);
      assert.ok(result.built.workspace.databaseViews.some((view) => view.id === overview.content[3].props.viewId && view.sourceId === source.id));
      assert.equal(overview.content[4].content[0].text, `After ${suffix}`);
      for (const key of ["folders", "pages", "dataSources", "databaseViews", "databaseItems", "relations", "attachments"]) assert.deepEqual(result.built.workspace[key].slice(0, result.original[key].length), result.original[key]);
      assert.equal(result.unchanged, true);
      assert.equal(result.built.workspace.sentinel, "unchanged");
    });
  }
  await check("Detached description parsing sends no external requests", async () => assert.deepEqual(outside, []));
}

await browserScenario(`LOCAL-NOTION-001/v14-linked-view129/description130/${run}`, runDescription130Checks);
