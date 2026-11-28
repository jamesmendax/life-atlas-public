import { browserScenario } from "./harness.mjs";
import { fullWorkspace, FIXTURE_TIME } from "../fixtures/full-workspace.mjs";

const workspace = fullWorkspace();
const base = workspace.pages.find((page) => page.id === "p-z1");
while (workspace.pages.length < 200) {
  const index = workspace.pages.length;
  workspace.pages.push({ ...structuredClone(base), id: `backup-perf-${index}`, title: `备份性能页面 ${index}`, content: Array.from({ length: 5 }, (_, block) => ({ id: `backup-perf-${index}-${block}`, type: "paragraph", content: `完整保留离线内容 ${index} ${block}` })) });
}
for (let index = 0; index < 3; index += 1) workspace.attachments.push({ id: `backup-perf-file-${index}`, name: `benchmark-${index}.bin`, provider: "local-ref", storageKey: `backup-perf-file-${index}`, mime: "application/octet-stream", size: 5 * 1024 * 1024, createdAt: FIXTURE_TIME, updatedAt: FIXTURE_TIME });

await browserScenario("wp02-backup-performance", async ({ page, check, assert }) => {
  await page.locator('html[data-la-ready="1"]').waitFor();
  await page.evaluate(async () => {
    const { writeBrowserAttachmentBlob } = await import("/src/domain/attachments.js");
    for (let index = 0; index < 3; index += 1) {
      const bytes = new Uint8Array(5 * 1024 * 1024);
      for (let offset = 0; offset < bytes.length; offset += 1) bytes[offset] = (offset + index) % 256;
      await writeBrowserAttachmentBlob(`backup-perf-file-${index}`, new Blob([bytes], { type: "application/octet-stream" }));
    }
  });
  await page.locator(".workspace-switcher").click();
  await page.getByRole("menuitem", { name: "备份与恢复…", exact: true }).click();
  await check("Export of 200 pages and 15 MB of attachments finishes within 10 seconds", async () => {
    const started = performance.now();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("dialog", { name: "备份与恢复", exact: true }).getByRole("button", { name: "导出", exact: true }).click();
    const download = await downloaded;
    const elapsed = performance.now() - started;
    assert.equal(await download.failure(), null);
    console.log(`WP02_EXPORT_MS=${elapsed.toFixed(3)}`);
    assert.ok(elapsed < 10000);
  });
}, { workspace, now: "2026-10-02T08:00:00.000Z" });
