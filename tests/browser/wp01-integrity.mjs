import { browserScenario } from "./harness.mjs";
import { fullWorkspace } from "../fixtures/full-workspace.mjs";

await browserScenario("wp01-integrity", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const sidebar = page.getByRole("complementary", { name: "主导航" });
  const folder = (name) => sidebar.locator(".tree-folder-main").filter({ hasText: name });
  const leaf = (name) => sidebar.locator(".page-tree-row").filter({ hasText: name });
  const trash = async () => { await sidebar.getByRole("button", { name: /回收站/ }).click(); await page.locator(".trash-view").waitFor(); };
  const confirmTrash = async () => { await page.getByRole("menuitem", { name: "移到回收站", exact: true }).click(); await page.getByRole("alertdialog").getByRole("button", { name: "移到回收站", exact: true }).click(); };

  await check("Folder moves to trash as one group", async () => {
    await folder("A 项目").click({ button: "right" });
    await confirmTrash();
    await folder("A 项目").waitFor({ state: "detached" });
    await persisted((workspace) => workspace.folders.find((entry) => entry.id === "f-a").trashedAt);
    await trash();
    assert.equal(await page.locator(".trash-row").count(), 2);
    assert.match(await page.locator('[data-trash-id="f-a"]').innerText(), /包含 3 个文件夹、6 个页面/);
    assert.match(await page.locator('[data-trash-id="p-b-solo"]').innerText(), /B 单独删除的页/);
    await screenshot("trash-folder-group");
  });
  await check("Search hides trashed content", async () => {
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "全局搜索", exact: true });
    await dialog.locator("input").fill("深层");
    await dialog.getByText(/没有找到/).waitFor();
    assert.equal(await dialog.getByRole("option").count(), 0);
    await page.keyboard.press("Escape");
  });
  await check("Restoring the folder group brings content back after reload", async () => {
    await page.locator('[data-trash-id="f-a"]').getByRole("button", { name: "恢复", exact: true }).click();
    await folder("A 项目").waitFor();
    await persisted((workspace) => workspace.folders.find((entry) => entry.id === "f-a").trashedAt === null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await sidebar.getByRole("button", { name: "展开C 细节", exact: true }).click();
    await leaf("C 深层").click();
    await page.locator(".life-editor").getByText("深层正文", { exact: true }).waitFor();
    await screenshot("after-restore");
  });
  await check("Folder moves into another folder but not into its own child", async () => {
    await folder("B 资料").click({ button: "right" });
    await page.getByRole("menuitem", { name: "移动到…", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "移动文件夹", exact: true });
    assert.equal(await dialog.getByRole("option", { name: /C 细节/ }).isDisabled(), true);
    await dialog.getByRole("option", { name: "Private / Z 其他", exact: true }).click();
    await dialog.getByRole("button", { name: "移动文件夹", exact: true }).click();
    await persisted((workspace) => workspace.folders.find((entry) => entry.id === "f-b").parentId === "f-z");
    await page.reload({ waitUntil: "domcontentloaded" });
    await folder("B 资料").waitFor();
    assert.equal((await saved()).folders.find((entry) => entry.id === "f-b").parentId, "f-z");
  });
  await check("Permanently deleted targets render as placeholders", async () => {
    await leaf("B 笔记").click({ button: "right" });
    await confirmTrash();
    await trash();
    await page.locator('[data-trash-id="p-b1"]').getByRole("button", { name: "永久删除", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "永久删除", exact: true }).click();
    await persisted((workspace) => !workspace.pages.some((entry) => entry.id === "p-b1"));
    await leaf("Z 目标页").click();
    await page.locator(".life-editor").getByText("数据库已删除", { exact: true }).waitFor();
    await page.locator(".life-editor").getByText("已删除的页面", { exact: true }).first().waitFor();
  });
}, { workspace: fullWorkspace(), now: "2026-10-02T08:00:00.000Z", viewport: { width: 1440, height: 900 } });
