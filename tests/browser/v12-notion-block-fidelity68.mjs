import { browserScenario } from "./harness.mjs";
import { coreParityWorkspace } from "../fixtures/core-parity-workspace.mjs";

// Reduced from source-html48: root 38b95adb/c8224fc2/ccd759a0,
// writing template 0e4b75bb, and backstage guide 88ac9eb5.
// All source HTML is data parsed by the importer, never mounted as HTML.
const source = `
<aside class="block-color-gray_background callout" data-notion-callout="" data-notion-callout-background="gray_background"><div style="width:100%"><p><strong>写长文</strong>　<a href="articles.html">进入文章库 →</a></p><p>技术长文、完整观点与深度复盘。</p><p><mark class="highlight-gray" data-notion-highlight="gray">草稿 → 发布</mark></p></div></aside>
<aside class="block-color-brown_background callout" data-notion-callout="" data-notion-callout-background="brown_background"><div style="width:100%"><p><strong>需要批量整理或调整结构时</strong>　<a href="maintenance.html">打开后台维护 →</a></p><p>这里才放数据库结构和批量视图；它不是日常使用路径。</p></div></aside>
<aside class="block-color-gray_background callout" data-notion-callout="" data-notion-callout-icon="✍️" data-notion-callout-background="gray_background"><div style="font-size:1.5em"><span class="icon" data-emoji="✍️"></span></div><div style="width:100%"><p>用于正式文章、长文、项目复盘或旅行/生活文章。复制这页内容到新文章后再开始写。</p></div></aside>
<aside class="block-color-teal_background callout" data-notion-callout="" data-notion-callout-icon="🌿" data-notion-callout-background="teal_background"><div style="font-size:1.5em"><span class="icon" data-emoji="🌿"></span></div><div style="width:100%"><p><strong>写作放进数据库，成熟度交给状态，最好的内容才放到首页。</strong></p></div></aside>
<p><mark class="highlight-teal" data-notion-highlight="teal">札记 · 5 分钟</mark></p>
<p><mark class="highlight-blue" data-notion-highlight="blue">长文 · 31 分钟</mark></p>
<p><mark class="highlight-brown" data-notion-highlight="brown">随笔 · 7 分钟</mark></p>
<p><mark class="highlight-teal_background">teal background control</mark></p>
<p><strong><mark data-notion-highlight="teal"><a href="essays.html"><em>浏览全部随笔 →</em></a></mark></strong> <a href="essays.html" data-notion-page-id="0695baf6-bb76-4e86-8f67-70dc46db6636">随笔</a> <a href="unknown-title.html">未知目标标题</a></p>`;

const editorSelector = '.life-editor[data-page-id="editor-page"] .bn-editor';
const workspace = coreParityWorkspace();
workspace.ui.selectedPageId = "editor-page";
workspace.ui.preferences = { theme: "system" };
workspace.pages.find((page) => page.id === "editor-page").content = [{ id: "start68", type: "paragraph", content: "" }];
for (const [id, title] of [["articles68", "文章"], ["maintenance68", "后台维护"], ["essays68", "随笔"]]) {
  workspace.pages.push({
    ...structuredClone(workspace.pages.find((page) => page.id === "editor-page")),
    id, title, content: [{ id: `${id}-body`, type: "paragraph", content: `${title}目标页68` }],
  });
}
const outer = (page, id) => page.locator(`${editorSelector} .bn-block-outer[data-id="${id}"]`).first();
const textOf = (content) => (content || []).map((item) => item.text ?? item.props?.labelSnapshot ?? textOf(item.content)).join("");
const findSaved = (value, id) => {
  const walk = (blocks) => blocks.flatMap((block) => [block, ...walk(block.children || [])]);
  return walk(value.pages.find((page) => page.id === "editor-page").content).find((block) => block.id === id);
};
const native = (page) => page.evaluate((selector) => document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor.document, editorSelector);

await browserScenario("v12-notion-block-fidelity68", async ({ page, check, assert, persisted, screenshot }) => {
  await page.locator(editorSelector).waitFor();
  const result = await page.evaluate(async (body) => {
    const { notionHtmlToBlocks } = await import("/src/import/notionHtml.js");
    let sequence = 0;
    const options = {
      idFactory: () => `fidelity68-${++sequence}`,
      resolvePage: (href) => ({ "articles.html": "articles68", "maintenance.html": "maintenance68", "essays.html": "essays68", "unknown-title.html": "unknown68" })[href],
      resolvePageTitle: (id) => ({ articles68: "文章", maintenance68: "后台维护", essays68: "随笔" })[id],
    };
    const blocks = notionHtmlToBlocks({ body }, options);
    const legacy = notionHtmlToBlocks({ body }, { ...options, resolvePageTitle: undefined });
    const fallbacks = notionHtmlToBlocks({ body: '<aside class="block-color-brown_background callout"><div><span class="icon" data-emoji="✍️">✍️</span></div><div><p>Body</p><p></p><p>After blank</p></div></aside><aside data-notion-callout-icon=""><div><span class="icon" data-emoji="💡">💡</span></div><p>No icon</p></aside><aside><h2>Heading child</h2><p>Paragraph child</p></aside>' }, options);
    return { blocks, legacy, fallbacks };
  }, source);
  const [gray, brown, writing, green, teal, blue, brownText, tealBackground, links] = result.blocks;

  await check("source callouts retain body, separate native children, background and explicit absence of icon", async () => {
    assert.equal(result.blocks.length, 9);
    assert.deepEqual([gray, brown, writing, green].map((block) => block.type), Array(4).fill("callout"));
    assert.deepEqual([gray, brown, writing, green].map((block) => block.props), [
      { icon: "", tone: "gray", backgroundColor: "gray" }, { icon: "", tone: "brown", backgroundColor: "brown" },
      { icon: "✍️", tone: "gray", backgroundColor: "gray" }, { icon: "🌿", tone: "green", backgroundColor: "green" },
    ]);
    assert.equal(textOf(gray.content), "写长文　进入文章库 →");
    assert.equal(gray.content[0].styles.bold, true);
    assert.deepEqual(gray.children.map((child) => [child.type, textOf(child.content)]), [["paragraph", "技术长文、完整观点与深度复盘。"], ["paragraph", "草稿 → 发布"]]);
    assert.equal(gray.children[1].content[0].styles.textColor, "gray");
    assert.deepEqual(brown.children.map((child) => textOf(child.content)), ["这里才放数据库结构和批量视图；它不是日常使用路径。"]);
    assert.equal(writing.children.length, 0);
    assert.ok(textOf(writing.content).startsWith("用于正式文章"));
    assert.equal(green.content[0].styles.bold, true);
    const fallback = result.fallbacks[0];
    assert.deepEqual(fallback.props, { icon: "✍️", tone: "brown", backgroundColor: "brown" });
    assert.equal(textOf(fallback.content), "Body", "decorative emoji must not become body text");
    assert.deepEqual(fallback.children.map((child) => textOf(child.content)), ["", "After blank"]);
    assert.equal(result.fallbacks[1].props.icon, "", "explicit empty icon takes precedence over decorative markup");
    assert.equal(textOf(result.fallbacks[1].content), "No icon");
    assert.deepEqual(result.fallbacks[2].content, []);
    assert.deepEqual(result.fallbacks[2].children.map((child) => child.type), ["heading", "paragraph"]);
  });

  await check("teal and teal_background map to green while blue and brown controls survive", async () => {
    assert.equal(textOf(teal.content), "札记 · 5 分钟");
    assert.deepEqual([teal, blue, brownText].map((block) => block.content[0].styles.textColor), ["green", "blue", "brown"]);
    assert.deepEqual(tealBackground.content[0].styles, { backgroundColor: "green" });
  });

  await check("custom CTA preserves local target and inherited styles; same-name and unknown-title links keep mentions", async () => {
    assert.deepEqual(links.content[0], { type: "link", href: "lifeatlas://page/essays68", content: [
      { type: "text", text: "浏览全部随笔 →", styles: { bold: true, textColor: "green", italic: true } },
    ] });
    assert.deepEqual(links.content.filter((item) => item.type === "pageMention"), [
      { type: "pageMention", props: { pageId: "essays68", labelSnapshot: "随笔" } },
      { type: "pageMention", props: { pageId: "unknown68", labelSnapshot: "未知目标标题" } },
    ]);
    assert.ok(gray.content.some((item) => item.type === "link" && item.href === "lifeatlas://page/articles68" && textOf(item.content) === "进入文章库 →"));
    assert.deepEqual(result.legacy[8].content.filter((item) => item.type === "pageMention").map((item) => item.props.labelSnapshot), ["浏览全部随笔 →", "随笔", "未知目标标题"]);
    assert.ok(result.legacy[0].content.some((item) => item.type === "pageMention" && item.props.labelSnapshot === "进入文章库 →"));
  });

  await page.evaluate(({ selector, blocks }) => {
    const editor = document.querySelector(selector).pmViewDesc.node.type.schema.cached.blockNoteEditor;
    editor.replaceBlocks(editor.document, [...blocks, { id: "default68", type: "callout", content: "New default callout" }]);
  }, { selector: editorSelector, blocks: result.blocks });
  await outer(page, gray.id).locator(".life-callout").waitFor();

  await check("iconless callout has no default emoji or empty icon column; new callout still defaults to lightbulb", async () => {
    const state = await native(page);
    assert.equal(state.find((block) => block.id === gray.id).props.icon, "");
    assert.equal(state.find((block) => block.id === "default68").props.icon, "💡");
    assert.equal(await outer(page, gray.id).getByRole("button", { name: "添加 Callout 图标" }).textContent(), "");
    assert.equal(await outer(page, writing.id).getByRole("button", { name: "编辑 Callout 图标" }).textContent(), "✍️");
    const geometry = await outer(page, gray.id).evaluate((host) => {
      const face = host.querySelector(".life-callout");
      const body = face.querySelector(".life-callout-content");
      return { bodyLeft: body.getBoundingClientRect().left, expectedLeft: face.getBoundingClientRect().left + parseFloat(getComputedStyle(face).paddingLeft) };
    });
    assert.ok(Math.abs(geometry.bodyLeft - geometry.expectedLeft) <= 1, JSON.stringify(geometry));
  });

  await check("native child paragraph editing and reload preserve siblings, marks, custom link and empty icon", async () => {
    const before = await native(page);
    const childId = gray.children[0].id;
    await outer(page, childId).locator(".bn-inline-content").click();
    await page.keyboard.press("End");
    await page.keyboard.insertText(" 独立编辑68");
    await persisted((value) => textOf(findSaved(value, childId)?.content) === "技术长文、完整观点与深度复盘。 独立编辑68");
    const after = await native(page);
    assert.deepEqual(after[0].content, before[0].content);
    assert.deepEqual(after[0].props, before[0].props);
    assert.deepEqual(after[0].children[1], before[0].children[1]);
    assert.deepEqual(after.slice(1), before.slice(1));
    assert.equal(after[0].children[0].id, childId);
    await page.reload({ waitUntil: "domcontentloaded" });
    await outer(page, gray.id).locator(".life-callout").waitFor();
    assert.deepEqual(await native(page), after);
  });

  await check("gray, brown and green backgrounds enclose child paragraphs in light and dark", async () => {
    for (const mode of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: mode });
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, mode);
      for (const block of [gray, brown, green]) {
        const measurement = await outer(page, block.id).evaluate((host, color) => {
          const face = host.querySelector(":scope > .bn-block");
          const sample = document.createElement("span");
          sample.style.backgroundColor = `var(--mb-u-${color}-bg)`;
          document.body.append(sample);
          const rect = face.getBoundingClientRect();
          const bodyLeft = face.querySelector(".life-callout-content").getBoundingClientRect().left;
          const children = [...face.querySelectorAll(":scope > .bn-block-group > .bn-block-outer")].map((child) => {
            const r = child.getBoundingClientRect();
            return { enclosed: r.left >= rect.left && r.right <= rect.right && r.top >= rect.top && r.bottom <= rect.bottom, inlineLeft: child.querySelector(".bn-inline-content").getBoundingClientRect().left };
          });
          const result = { actual: getComputedStyle(face).backgroundColor, expected: getComputedStyle(sample).backgroundColor, bodyLeft, children };
          sample.remove();
          return result;
        }, block.props.backgroundColor);
        assert.equal(measurement.actual, measurement.expected, `${mode} ${block.props.backgroundColor}`);
        assert.equal(measurement.children.length, block.children.length);
        assert.ok(measurement.children.every((child) => child.enclosed), JSON.stringify(measurement));
        assert.ok(measurement.children.every((child) => Math.abs(child.inlineLeft - measurement.bodyLeft) <= 1), JSON.stringify(measurement));
      }
      await screenshot(mode);
    }
  });

  await check("icon editing can clear an explicit emoji, add one to an iconless callout, and cancel without changing it", async () => {
    await outer(page, writing.id).getByRole("button", { name: "编辑 Callout 图标" }).click();
    let dialog = page.locator('[data-la-dialog="prompt"]').last();
    await dialog.locator("input").fill("");
    await dialog.locator("[data-la-dialog-confirm]").click();
    await persisted((value) => findSaved(value, writing.id)?.props.icon === "");
    await outer(page, writing.id).hover();
    await outer(page, writing.id).getByRole("button", { name: "添加 Callout 图标" }).click();
    dialog = page.locator("[data-la-dialog]").last();
    assert.equal(await dialog.locator("input").inputValue(), "");
    await dialog.locator("[data-la-dialog-cancel]").click();
    assert.equal((await native(page)).find((block) => block.id === writing.id).props.icon, "");
    await outer(page, gray.id).hover();
    await outer(page, gray.id).getByRole("button", { name: "添加 Callout 图标" }).click();
    dialog = page.locator("[data-la-dialog]").last();
    assert.equal(await dialog.locator("input").inputValue(), "");
    await dialog.locator("input").fill("🌿");
    await dialog.locator("[data-la-dialog-confirm]").click();
    await persisted((value) => findSaved(value, gray.id)?.props.icon === "🌿");
    await page.reload({ waitUntil: "domcontentloaded" });
    await outer(page, gray.id).locator(".life-callout").waitFor();
    const state = await native(page);
    assert.equal(state.find((block) => block.id === gray.id).props.icon, "🌿");
    assert.equal(state.find((block) => block.id === writing.id).props.icon, "");
    assert.equal(state.find((block) => block.id === "default68").props.icon, "💡");
  });

  await check("rendered CTA retains wording and styles, navigates locally, and same-name mention follows target rename", async () => {
    const before = await native(page);
    const linkBlock = outer(page, links.id);
    const cta = linkBlock.getByRole("link", { name: "浏览全部随笔 →", exact: true });
    assert.equal(await cta.getAttribute("href"), "lifeatlas://page/essays68");
    const renderedStyle = await cta.evaluate((link) => {
      const leaf = [...link.querySelectorAll("*")].at(-1) || link;
      const style = getComputedStyle(leaf);
      return { fontWeight: Number(style.fontWeight), fontStyle: style.fontStyle };
    });
    assert.ok(renderedStyle.fontWeight >= 600, JSON.stringify(renderedStyle));
    assert.equal(renderedStyle.fontStyle, "italic");
    assert.equal(await linkBlock.locator('[data-mention-type="pageMention"]').getByRole("button", { name: "随笔", exact: true }).isEnabled(), true);
    assert.equal(await outer(page, gray.id).getByRole("link", { name: "进入文章库 →", exact: true }).getAttribute("href"), "lifeatlas://page/articles68");

    await cta.click();
    await page.locator('.life-editor[data-page-id="essays68"] .bn-editor').waitFor();
    const title = page.locator(".page-title-input");
    assert.equal(await title.inputValue(), "随笔");
    await title.fill("随笔 · 已改名68");
    await title.press("Tab");
    await persisted((value) => value.pages.find((entry) => entry.id === "essays68")?.title === "随笔 · 已改名68");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.locator(editorSelector).waitFor();
    await linkBlock.locator('[data-mention-type="pageMention"]').getByRole("button", { name: "随笔 · 已改名68", exact: true }).waitFor();
    assert.equal(await cta.textContent(), "浏览全部随笔 →");
    assert.equal(await cta.getAttribute("href"), "lifeatlas://page/essays68");
    assert.deepEqual(await native(page), before, "navigation and target rename must not rewrite CTA content or mention snapshot");
  });
}, { workspace });
