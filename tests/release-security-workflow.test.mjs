import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { SHORTCUTS } from "../src/editor/shortcuts.js";

const security = fs.readFileSync(new URL("./release/security-sweep.e2e.mjs", import.meta.url), "utf8");
const screenshots = fs.readFileSync(new URL("./release/manual-screenshots.e2e.mjs", import.meta.url), "utf8");
const manual = fs.readFileSync(new URL("../docs/用户手册.md", import.meta.url), "utf8");
const chapterTitles = ["安装与第一次打开", "从浏览器版搬到桌面版", "日常备份", "在新电脑上恢复", "密钥库", "模板、时间脉络与官方市集", "页面与编辑器", "数据库", "快速记录与收件箱", "导入 Notion、导出 Markdown", "设置与外观", "快捷键", "常见问题"];
const imageNames = ["first-run", "restore-from-backup", "backup-dialog", "vault-lock", "vault-main", "template-gallery", "roadmap", "slash-menu", "database-table", "quick-capture", "settings"];
const chapterHeadings = [...manual.matchAll(/^## (\d+)\. (.+)$/gm)];
const chapter = (number) => manual.slice(chapterHeadings[number - 1].index, chapterHeadings[number]?.index ?? manual.length);

test("release security workflow keeps the complete production session and failure evidence", () => {
  for (const text of [
    'test("a full release session leaves no plaintext and makes no network requests"',
    'const MASTER = "Release-Sweep-Pass-2026!";',
    `const BACKUP = 'Sweep-Backup-Pass-2026!"';`,
    'import { seedVault } from "../desktop/seed-vault.mjs";',
    'await seedDesktopFullWorkspace(dataRoot);',
    'const inputs = vaultItemInputs(markers);',
    'LIFE_ATLAS_TEST_CLIPBOARD_MS: "1500"',
    'await unlockUi(vaultPage, MASTER);',
    'assert.notEqual(displayed, copied);',
    'name: "显示API Key", exact: true',
    'name: "复制Secret", exact: true',
    'clipboard.readText()), copied',
    'setTimeout(resolve, 2000)',
    'clipboard.readText()), ""',
    'includeVault: true, vaultPage, onConfirm: confirmVault',
    'includeVault: true, encryptPassword: BACKUP, vaultPage, onConfirm: confirmVault',
    '"确认操作的主密码", { exact: true }',
    '"sweep-plain.lifeatlas"',
    '"sweep-encrypted.lifeatlas"',
    '"sweep-markdown"',
    'await exportMarkdown(handle, markdownDirectory);',
    'globalThis.__lifeAtlasTest.snapshots.checkNow()',
    '["workspace.db", "vault.db"]',
    '[...markers.all(), MASTER, BACKUP, recoveryKey]',
    'await assertNoNetworkAndErrors(handle);',
    'await closeApp(handle, { keepDirs: true });',
    '"tools/scan-plaintext.mjs"',
    'dataRoot, plainFile, encryptedFile, markdownDirectory, "--markers", markerFile',
    'assert.equal(scan.status, 0',
    '/plaintext scanner: 0 hits/',
    'RELEASE_SECURITY_PRESERVED',
  ]) assert.ok(security.includes(text), `Missing release security contract: ${text}`);
  assert.doesNotMatch(security, /fastBackupDeriveKey|backupVaultFactory|memoryKiB\s*:|allowedUrls\s*:|expectedHttpErrors\s*:|test\.(?:skip|only)|\.clock\./);
  assert.ok(security.indexOf('if (failure) { console.log(`RELEASE_SECURITY_PRESERVED') < security.indexOf('removeIsolatedDirectory(root)'));
  assert.match(security, /const markerFile = path\.join\(root, "markers\.txt"\)/);
  assert.match(security, /const dataRoot = path\.join\(root, "data"\)/);
  assert.match(security, /const output = path\.join\(root, "artifacts"\)/);
});

test("manual capture preserves real versions native windows and all dual-mode scenes", () => {
  assert.deepEqual(JSON.parse(screenshots.match(/const names = (\[[^\n]+\]);/)[1]), imageNames);
  assert.match(screenshots, /app\.getVersion\(\)\), "1\.0\.0"/);
  assert.match(screenshots, /dataRoot: null, bootstrapDir: firstBootstrap/);
  assert.match(screenshots, /await backupFixture\(\)/);
  assert.match(screenshots, /"\.wiz-summary"/);
  assert.match(screenshots, /await shootModes\(handle, page, name\)/);
  assert.match(screenshots, /await shootModes\(handle, handle\.page, name\)/);
  const captureLoop = screenshots.slice(screenshots.indexOf("  const shootModes ="), screenshots.indexOf("  const shootNative ="));
  let previousStep = -1;
  for (const step of [
    "nativeTheme.themeSource = source",
    "await page.emulateMedia({ colorScheme: mode })",
    'await page.waitForFunction((dark) => matchMedia("(prefers-color-scheme: dark)").matches === dark, mode === "dark")',
    'await page.locator(`html[data-theme="${mode}"]`).waitFor()',
    "await page.evaluate(() => document.fonts.ready)",
    "await page.screenshot",
  ]) {
    const position = captureLoop.indexOf(step);
    assert.ok(position > previousStep, `Manual capture must perform ${step} in readiness order`);
    previousStep = position;
  }
  assert.match(screenshots, /width: 1440, height: 900/);
  assert.match(screenshots, /assert\.equal\(expected\.length, 22\)/);
  assert.match(screenshots, /COPYFILE_EXCL/);
  assert.match(screenshots, /const demoValue = "示例-不是真的"/);
  for (const title of ["示例邮箱", "示例服务器", "示例 API Key"]) assert.ok(screenshots.includes(`title: "${title}"`));
  assert.doesNotMatch(screenshots, /vaultItemInputs|createMarkers|setContentProtection\(false\)|test\.(?:skip|only)|\.clock\./);
  const nativeCapture = screenshots.slice(screenshots.indexOf('const shootNative ='), screenshots.indexOf('const shootWorkspace ='));
  assert.doesNotMatch(nativeCapture, /setViewportSize|setBounds/);
  assert.ok(screenshots.indexOf('await validateImages(shotsDir, dimensions)') < screenshots.indexOf('    deliverImages(shotsDir, files);'));
});

test("the Chinese manual covers all thirteen chapters warnings and delivered image links", () => {
  assert.deepEqual(chapterHeadings.map((heading) => [Number(heading[1]), heading[2]]), chapterTitles.map((title, index) => [index + 1, title]));
  const required = [
    [1, /双击/, /安装位置/, /D:\\LifeAtlas/, /OneDrive/, /程序安装目录/, /原目录/],
    [2, /平时使用的地址/, /完整备份/, /从备份恢复/, /不要清理浏览器数据/],
    [3, /每日、升级前、迁移前、恢复前/, /硬盘损坏/, /另一块硬盘或 U 盘/, /定期备份/, /校验备份/, /备份密码.*主密码/],
    [4, /安装/, /从备份恢复/, /\.lifeatlas/, /备份密码/, /原主密码/],
    [5, /12 个字符/, /5 种不同字符/, /常见密码/, /反复重复/, /打印/, /纸上/, /离线/, /恢复密钥/, /没有后门/, /闲置/, /锁屏/, /睡眠/, /剪贴板/, /截图.*录屏/, /不能保证/, /CSV/],
    [6, /模板库/, /软件开发进程/, /项目名/, /拖动/, /日期/, /缩放/, /PNG 或 SVG/, /16:9/, /PPT/, /专注学习页/, /番茄钟/, /导入本地包/],
    [7, /`\/`/, /`\[\[`/, /`@`/, /页面历史/, /反向链接/, /外部图片/, /双击/, /外部浏览器/],
    [8, /单元格/, /底部/, /统计/, /中心预览/, /CSV/],
    [9, /Ctrl\+Shift\+N/, /Ctrl\+Alt\+Space/, /收件箱/, /归档/, /文件夹/, /本地提醒/],
    [10, /Markdown 和 CSV/, /包含子页面/, /为子页面创建文件夹/, /新文件夹/, /长期保存/, /不是完整备份/],
    [11, /墨白/, /跟随系统、白天、夜间/, /旧目录会保留/, /30 天内可以恢复/],
    [13, /设置 → 数据/, /卸载/, /数据目录保留/, /数据无法读取/, /快照/, /完整备份/, /离线识图/, /云端模型/, /基础网址/, /AI/, /被别的软件占用/],
  ];
  for (const [number, ...patterns] of required) for (const pattern of patterns) assert.match(chapter(number), pattern, `Chapter ${number} omits ${pattern}`);
  for (const name of imageNames) assert.ok(manual.includes(`manual-images/${name}-light.png`));
  assert.ok(chapter(11).includes("manual-images/settings-dark.png"));
  assert.match(manual, /配图来自 1\.0\.0 测试版的实际窗口/);
  assert.match(manual, /共 22 张/);
  for (const name of imageNames) for (const mode of ["light", "dark"]) {
    const file = new URL(`../docs/manual-images/${name}-${mode}.png`, import.meta.url);
    const bytes = fs.readFileSync(file);
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), `${name}-${mode} must be a PNG`);
    assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
    assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0, `${name}-${mode} must have nonzero image dimensions`);
  }
});

test("the manual shortcut table exactly matches the current SHORTCUTS catalog", () => {
  const rows = chapter(12).split(/\r?\n/).filter((line) => line.startsWith("| ") && line.split("|")[2]?.trim().startsWith("`")).map((line) => {
    const columns = line.split("|").slice(1, -1).map((column) => column.trim());
    return { group: columns[0], keys: columns[1].slice(1, -1), description: columns[2], verify: columns[3] };
  });
  assert.deepEqual(rows, SHORTCUTS.map(({ group, keys, description, verify }) => ({ group, keys, description, verify })));
  assert.equal(rows.length, 30);
});
