import { browserScenario, shootBothModes } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";
import { walkBlocks } from "../../src/domain/blockDocument.js";
import { SLASH_GROUP_ORDER } from "../../src/editor/slashMenuCatalog.js";
import { SHORTCUTS } from "../../src/editor/shortcuts.js";

async function newEmptyLine(page) {
  const trailing = page.locator(".bn-editor .bn-trailing-block");
  if (await trailing.count()) { await trailing.last().click(); return; }
  await page.locator(".bn-editor > .bn-block-group > .bn-block-outer").last().locator(".bn-inline-content").first().click();
}

async function paste(page, type, content) {
  await page.evaluate(({ type, content }) => {
    const clipboardData = new DataTransfer();
    clipboardData.setData(type, content);
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }));
  }, { type, content });
}

function blockText(block) {
  if (typeof block?.content === "string") return block.content;
  return (Array.isArray(block?.content) ? block.content : []).map((entry) => typeof entry === "string" ? entry : entry.text || "").join("");
}

const workspace = fullWorkspace();
workspace.ui.preferences = { theme: "system" };

await browserScenario("wp14-editor", async ({ page, context, check, screenshot, saved, persisted, assert }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const pageErrors = [];
  const remoteRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => { if (/^https?:\/\//.test(request.url()) && !request.url().startsWith("http://127.0.0.1:5178/")) remoteRequests.push(request.url()); });
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const openPage = async (pageId, title) => {
    const node = sidebar.locator(`[data-node-id="${pageId}"]`);
    if (await node.isVisible()) await node.click();
    else {
      await page.keyboard.press("Control+k");
      const search = page.getByRole("dialog", { name: "全局搜索", exact: true });
      await search.getByRole("combobox", { name: "搜索文件夹、页面与正文" }).fill(title);
      await search.locator(".search-result-row").filter({ has: page.locator("strong", { hasText: title }) }).first().click();
      await search.waitFor({ state: "hidden" });
    }
    await page.waitForFunction((title) => document.querySelector(".page-title-input")?.value === title, title);
    await page.locator(`.life-editor[data-page-id="${pageId}"] .bn-editor`).first().waitFor();
  };
  const blocks = (value, pageId = "p-a1-child") => walkBlocks(value.pages.find((entry) => entry.id === pageId)?.content);
  const block = (id) => page.locator(`.life-editor .bn-block-outer[data-id="${id}"]`).first();
  const suggestions = page.locator(".bn-suggestion-menu").getByRole("option");
  const slash = async (query) => { await newEmptyLine(page); await page.keyboard.type(`/${query}`); await suggestions.first().waitFor(); await page.keyboard.press("Enter"); };
  const clearSlash = async () => { await page.keyboard.press("Escape"); await page.keyboard.press("Shift+Home"); await page.keyboard.press("Backspace"); };
  const blockMenu = async (id) => {
    const target = block(id).locator(".bn-block-content").first();
    await target.hover();
    const rect = await target.boundingBox();
    assert.ok(rect);
    await page.mouse.move(rect.x + 10, rect.y + Math.min(10, rect.height / 2));
    await page.mouse.move(rect.x + 11, rect.y + Math.min(10, rect.height / 2));
    await page.locator(`.life-editor > .bn-container > .bn-root > .life-block-actions[data-block-id="${id}"]`).getByRole("button", { name: "区块菜单", exact: true }).click();
  };
  await sidebar.waitFor();
  await sidebar.getByRole("button", { name: "Private 更多选项", exact: true }).click();
  await page.getByRole("menu", { name: "Private 更多选项" }).getByRole("menuitem", { name: "展开全部", exact: true }).click();

  await check("Slash menu shows the specified groups and finds blocks by alias", async () => {
    await openPage("p-a1", "A 概览");
    await newEmptyLine(page);
    await page.keyboard.type("/");
    const menu = page.locator(".bn-suggestion-menu");
    await menu.waitFor();
    assert.deepEqual(await menu.locator(".bn-suggestion-menu-label").allTextContents(), SLASH_GROUP_ORDER);
    const style = await menu.evaluate((element) => ({ width: element.getBoundingClientRect().width, font: getComputedStyle(element.querySelector(".bn-mt-suggestion-menu-item-title")).fontSize, footer: getComputedStyle(element, "::after").content }));
    assert.equal(Math.round(style.width), 324);
    assert.equal(style.font, "14px");
    assert.match(style.footer, /Enter 插入/);
    await shootBothModes(page, screenshot, "slash", { keepVisible: ".bn-suggestion-menu" });
    for (const [query, expected] of [["h1", "标题 1"], ["todo", "待办事项"], ["code", "代码"], ["table", "表格"], ["quote", "引用"], ["roadmap", "时间脉络"], ["bt1", "标题 1"], ["dbsx", "待办事项"], ["dm", "代码"], ["zdbt2", "折叠标题 2"], ["sjml", "时间脉络"]]) {
      await clearSlash();
      await page.keyboard.type(`/${query}`);
      await suggestions.first().waitFor();
      assert.ok((await suggestions.first().innerText()).includes(expected), query);
    }
    await clearSlash();
    await openPage("p-a1-child", "A 子页面");
  });

  await check("Toggle headings fold and unfold", async () => {
    await slash("th2");
    await page.keyboard.type("折叠段");
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await page.keyboard.type("里面的内容");
    const state = await persisted((value) => blocks(value).some((entry) => entry.type === "heading" && blockText(entry) === "折叠段" && entry.children?.some((child) => blockText(child) === "里面的内容")));
    const heading = blocks(state).find((entry) => blockText(entry) === "折叠段");
    assert.equal(heading.props.isToggleable, true);
    assert.equal(heading.props.level, 2);
    await block(heading.id).locator(".bn-toggle-button").first().click();
    assert.equal(await page.getByText("里面的内容", { exact: true }).isVisible(), false);
    await block(heading.id).locator(".bn-toggle-button").first().click();
    assert.equal(await page.getByText("里面的内容", { exact: true }).isVisible(), true);
  });

  await check("Equations render and survive errors", async () => {
    await slash("公式区块");
    await page.keyboard.type("\\int_0^1 x^2 dx");
    await page.locator(".life-equation-rendered .katex").last().waitFor();
    await shootBothModes(page, screenshot, "equation");
    const source = page.locator(".life-equation-source").last();
    await source.fill("\\frac{");
    await page.locator(".life-equation-rendered .katex-error").last().waitFor();
    assert.deepEqual(pageErrors, []);
    await slash("行内公式");
    const dialog = page.getByRole("dialog", { name: "行内公式", exact: true });
    await dialog.getByLabel("LaTeX 公式", { exact: true }).fill("a^2+b^2");
    await page.keyboard.press("Control+Enter");
    await page.locator(".life-inline-equation .katex").waitFor();
  });

  await check("Code blocks highlight eight languages and copy", async () => {
    for (const [label, source] of [["JavaScript", "const a = 1;"], ["TypeScript", "let b: number = 2;"], ["Python", "print(1)"], ["JSON", '{"a": 1}'], ["Shell", "echo hi"], ["SQL", "SELECT 1;"], ["Rust", "fn main() {}"], ["Java", "class A {}"]]) {
      await slash("code");
      const code = page.locator('.life-editor [data-content-type="codeBlock"]').last();
      await code.locator("select").selectOption({ label });
      const bounds = await code.locator(".bn-inline-content").boundingBox();
      assert.ok(bounds && bounds.width > 0 && bounds.height > 0, "An empty code block must have a visible editable area");
      await code.locator(".bn-inline-content").click();
      await page.keyboard.type(source);
      await code.locator("span[style]").first().waitFor();
      await code.hover();
      await page.getByRole("button", { name: "复制代码", exact: true }).click();
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), source, label);
    }
    await shootBothModes(page, screenshot, "code-block");
    await page.emulateMedia({ colorScheme: "light" });
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    assert.equal(await page.locator('.life-editor [data-content-type="codeBlock"] .shiki').first().evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span"); probe.style.color = style.getPropertyValue("--shiki-light"); document.body.appendChild(probe);
      const expected = getComputedStyle(probe).color; probe.remove(); return style.color === expected;
    }), true);
  });

  await check("Double brackets and plus create links", async () => {
    await newEmptyLine(page);
    await page.keyboard.type("[[Z 目标");
    await suggestions.filter({ hasText: "Z 目标页" }).first().click();
    await persisted((value) => blocks(value).some((entry) => entry.content?.some?.((inline) => inline.type === "pageMention" && inline.props.pageId === "p-z1")));
    await newEmptyLine(page);
    await page.keyboard.type("[[新页面X");
    await suggestions.filter({ hasText: "新建页面「新页面X」" }).waitFor();
    await shootBothModes(page, screenshot, "double-bracket", { keepVisible: ".bn-suggestion-menu" });
    await suggestions.filter({ hasText: "新建页面「新页面X」" }).click();
    const state = await persisted((value) => value.pages.some((entry) => entry.title === "新页面X" && entry.parentPageId === "p-a1-child"));
    const created = state.pages.find((entry) => entry.title === "新页面X");
    assert.ok(blocks(state).some((entry) => entry.content?.some?.((inline) => inline.type === "pageMention" && inline.props.pageId === created.id)));
    await newEmptyLine(page);
    await page.keyboard.type("+");
    await suggestions.filter({ hasText: "新建子页面" }).first().click();
    await persisted((value) => blocks(value).some((entry) => entry.type === "pageLink" && Boolean(entry.props.pageId)));
    await slash("链接到页面");
    const picker = page.locator(".life-page-link-picker");
    await picker.getByLabel("搜索要链接的页面", { exact: true }).fill("C 深层");
    await picker.getByRole("button", { name: "C 深层", exact: true }).click();
    await persisted((value) => blocks(value).some((entry) => entry.type === "pageLink" && entry.props.pageId === "p-c1"));
    assert.match(await page.locator(".life-page-link-block").last().innerText(), /C 深层/);
  });

  await check("Duplicate move and link blocks", async () => {
    await newEmptyLine(page);
    await page.keyboard.type("移动我");
    await page.keyboard.press("Control+d");
    const duplicated = await persisted((value) => blocks(value).filter((entry) => blockText(entry) === "移动我").length === 2);
    const copies = blocks(duplicated).filter((entry) => blockText(entry) === "移动我");
    assert.notEqual(copies[0].id, copies[1].id);
    await blockMenu(copies[1].id);
    await page.getByRole("menuitem", { name: "移动到…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "移动到", exact: true });
    await dialog.getByLabel("搜索目标页面", { exact: true }).fill("Z 目标页");
    await dialog.getByRole("button", { name: /Z 目标页/ }).click();
    const moved = await persisted((value) => blocks(value).filter((entry) => blockText(entry) === "移动我").length === 1 && value.pages.find((entry) => entry.id === "p-z1").content.at(-1)?.id === copies[1].id);
    assert.equal(blockText(moved.pages.find((entry) => entry.id === "p-z1").content.at(-1)), "移动我");
    await blockMenu(copies[0].id);
    await page.getByRole("menuitem", { name: "复制区块链接", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "已复制区块链接" }).waitFor();
    const href = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(href, `lifeatlas://page/p-a1-child#block-${copies[0].id}`);
    await openPage("p-b1", "B 笔记");
    await newEmptyLine(page);
    await paste(page, "text/html", `<p><a href="${href}">跳转</a></p>`);
    await persisted((value) => blocks(value, "p-b1").some((entry) => entry.content?.some?.((inline) => inline.type === "link" && inline.href === href)));
    await page.getByRole("link", { name: "跳转", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "A 子页面");
    await block(copies[0].id).locator("xpath=self::*[contains(@class,'is-link-target')]").waitFor();
  });

  await check("Find in page counts and moves between matches", async () => {
    for (const text of ["查找词一", "第二个查找词", "查找词"]) { await newEmptyLine(page); await page.keyboard.type(text); }
    await page.keyboard.press("Control+f");
    const input = page.getByLabel("查找内容", { exact: true });
    await input.fill("查找词");
    await page.waitForFunction(() => document.querySelector('[data-testid="find-count"]')?.textContent === "1/3");
    assert.equal(await page.evaluate(() => CSS.highlights.get("la-find").size), 3);
    await shootBothModes(page, screenshot, "find-bar", { keepVisible: '[role="search"]' });
    await input.press("Enter");
    assert.equal(await page.getByTestId("find-count").innerText(), "2/3");
    await input.press("Shift+Enter");
    assert.equal(await page.getByTestId("find-count").innerText(), "1/3");
    await input.fill("不存在的词");
    await page.waitForFunction(() => document.querySelector('[data-testid="find-count"]')?.textContent === "0/0");
    assert.equal(await input.getAttribute("aria-invalid"), "true");
    await input.press("Escape");
    assert.equal(await page.getByRole("search", { name: "页内查找" }).count(), 0);
    assert.equal(await page.evaluate(() => CSS.highlights.has("la-find")), false);
  });

  await check("The shortcut panel lists only working shortcuts", async () => {
    await page.keyboard.press("Control+/");
    const panel = page.getByRole("dialog", { name: "快捷键", exact: true });
    await panel.waitFor();
    assert.equal(await panel.locator("[data-shortcut-id]").count(), SHORTCUTS.length);
    assert.deepEqual(await panel.locator("[data-shortcut-id]").evaluateAll((elements) => elements.map((element) => element.dataset.shortcutId)), SHORTCUTS.map((shortcut) => shortcut.id));
    const plusKeycaps = panel.locator('[data-shortcut-id="plus"] kbd');
    assert.equal(await plusKeycaps.count(), 1);
    assert.deepEqual(await plusKeycaps.allTextContents(), ["+"]);
    assert.ok((await panel.locator("kbd").allTextContents()).every((text) => text.trim().length > 0), "Every shortcut keycap must show its key");
    await shootBothModes(page, screenshot, "shortcuts");
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+k");
    await page.getByRole("dialog", { name: "全局搜索", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "全局搜索", exact: true }).count(), 0);

    await page.keyboard.press("Control+Shift+n");
    await page.getByRole("dialog", { name: "快速记录", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("dialog", { name: "快速记录", exact: true }).count(), 0);

    await openPage("p-z1", "Z 目标页");
    await openPage("p-a1-child", "A 子页面");
    await page.keyboard.press("Alt+ArrowLeft");
    await page.waitForFunction(() => document.querySelector(".page-title-input")?.value === "Z 目标页");
    await openPage("p-a1-child", "A 子页面");

    await page.keyboard.press("Control+\\");
    await page.locator(".app-shell.is-sidebar-collapsed").waitFor();
    assert.equal(await sidebar.count(), 0);
    await page.keyboard.press("Control+\\");
    await sidebar.waitFor();

    await page.keyboard.press("Control+f");
    await page.getByRole("search", { name: "页内查找" }).waitFor();
    await page.getByLabel("查找内容", { exact: true }).press("Escape");

    await newEmptyLine(page);
    await page.keyboard.type("撤销与重做内容");
    await page.keyboard.press("Control+z");
    await persisted((value) => !blocks(value).some((entry) => blockText(entry).includes("撤销与重做内容")));

    await page.keyboard.press("Control+Shift+z");
    await persisted((value) => blocks(value).some((entry) => blockText(entry) === "撤销与重做内容"));

    await newEmptyLine(page);
    await page.keyboard.type("粗体内容");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Control+b");
    await page.locator(".bn-inline-content strong").filter({ hasText: "粗体内容" }).waitFor();
    assert.equal(await page.locator(".bn-inline-content strong").filter({ hasText: "粗体内容" }).count(), 1);
    await page.keyboard.press("End");

    await newEmptyLine(page);
    await page.keyboard.type("斜体内容");
    await page.keyboard.press("Shift+Home");
    await page.keyboard.press("Control+i");
    await page.locator(".bn-inline-content em").filter({ hasText: "斜体内容" }).waitFor();
    assert.equal(await page.locator(".bn-inline-content em").filter({ hasText: "斜体内容" }).count(), 1);
    await page.keyboard.press("End");

    await newEmptyLine(page);
    await page.keyboard.type("快捷键复制段落");
    await page.keyboard.press("Control+d");
    await persisted((value) => blocks(value).filter((entry) => blockText(entry) === "快捷键复制段落").length === 2);

    await newEmptyLine(page);
    await page.keyboard.type("/");
    await page.locator(".bn-suggestion-menu").waitFor();
    await clearSlash();

    await page.keyboard.type("[[Z 目标");
    await suggestions.filter({ hasText: "Z 目标页" }).first().waitFor();
    await clearSlash();
  });

  await check("Markdown and HTML paste become blocks", async () => {
    await newEmptyLine(page);
    await paste(page, "text/plain", "## 粘贴标题\n\n- 列表一\n- 列表二\n\n```js\nconst x = 1;\n```");
    const markdown = await persisted((value) => blocks(value).some((entry) => entry.type === "codeBlock" && blockText(entry) === "const x = 1;"));
    assert.ok(blocks(markdown).some((entry) => entry.type === "heading" && entry.props.level === 2 && blockText(entry) === "粘贴标题"));
    assert.equal(blocks(markdown).filter((entry) => entry.type === "bulletListItem" && ["列表一", "列表二"].includes(blockText(entry))).length, 2);
    assert.ok(blocks(markdown).some((entry) => entry.type === "codeBlock" && ["js", "javascript"].includes(entry.props.language) && blockText(entry) === "const x = 1;"));
    await newEmptyLine(page);
    await paste(page, "text/html", '<p>网页段落</p><img src="https://example.com/x.png">');
    const html = await persisted((value) => blocks(value).some((entry) => entry.type === "image" && entry.props.url === "https://example.com/x.png"));
    assert.ok(blocks(html).some((entry) => entry.type === "paragraph" && blockText(entry) === "网页段落"));
    const image = blocks(html).find((entry) => entry.type === "image" && entry.props.url === "https://example.com/x.png");
    await block(image.id).locator('img[src^="data:image/svg+xml"]').waitFor();
    assert.deepEqual(remoteRequests, []);
  });

  await check("Emoji picker inserts an emoji", async () => {
    await newEmptyLine(page);
    await page.keyboard.type(":sm");
    await page.locator(".bn-grid-suggestion-menu").waitFor();
    await page.locator('.bn-grid-suggestion-menu [role="option"][aria-selected="true"]').first().waitFor();
    await page.keyboard.press("Enter");
    const state = await persisted((value) => blocks(value).some((entry) => entry.type === "paragraph" && /\p{Extended_Pictographic}/u.test(blockText(entry))));
    assert.ok(blocks(state).some((entry) => /\p{Extended_Pictographic}/u.test(blockText(entry)) && !blockText(entry).includes(":sm")));
  });

  await check("Tables offer header rows and cell colors", async () => {
    await slash("表格");
    const state = await persisted((value) => blocks(value).some((entry) => entry.type === "table"));
    const table = blocks(state).findLast((entry) => entry.type === "table");
    await blockMenu(table.id);
    assert.equal(await page.getByRole("menuitem", { name: "行标题", exact: true }).isVisible(), true);
    assert.equal(await page.getByRole("menuitem", { name: "列标题", exact: true }).isVisible(), true);
    await page.getByRole("menuitem", { name: "行标题", exact: true }).click();
    const header = await persisted((value) => blocks(value).find((entry) => entry.id === table.id)?.content.headerRows === 1);
    assert.equal(blocks(header).find((entry) => entry.id === table.id).content.headerRows, 1);
  });

  await check("Existing editor features still work", async () => {
    await slash("col2");
    await persisted((value) => blocks(value).some((entry) => entry.type === "columnList" && entry.props.columns === 2));
    await slash("Tabs");
    await persisted((value) => blocks(value).some((entry) => entry.type === "tabs"));
    await slash("同步区块");
    await persisted((value) => blocks(value).some((entry) => entry.type === "syncedBlock"));
    await newEmptyLine(page);
    await page.keyboard.type("@Z 目标");
    await suggestions.filter({ hasText: "Z 目标页" }).first().click();
    const state = await persisted((value) => blocks(value).some((entry) => entry.content?.some?.((inline) => inline.type === "pageMention" && inline.props.pageId === "p-z1")));
    assert.ok(blocks(state).some((entry) => entry.type === "columnList"));
    assert.ok(blocks(state).some((entry) => entry.type === "tabs"));
    assert.ok(blocks(state).some((entry) => entry.type === "syncedBlock"));
    assert.deepEqual(remoteRequests, []);
    assert.deepEqual(pageErrors, []);
    assert.equal((await saved()).pages.find((entry) => entry.id === "p-a1-child").trashedAt, null);
  });
}, { workspace, viewport: { width: 1440, height: 900 } });
