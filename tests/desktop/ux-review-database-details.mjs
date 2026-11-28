import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { openViewSettingsSection, setViewSettings } from "../browser/database-navigation.mjs";
import { databaseViewDetails } from "./ux-review-database-view-details.mjs";

const button = (root, name) => root.getByRole("button", { name, exact: true });
const field = (root, name) => root.getByLabel(name, { exact: true });
const dialog = (page, name) => page.getByRole("dialog", { name, exact: true });
const property = (state, name) => state.dataSources.find(s => s.id === "projects").properties.find(p => p.name === name);
const row = (state, id) => state.databaseItems.find(r => r.id === id);
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");

export async function databaseDetailPaths(context) {
  const { page, db, check, nav, frame, persist, saved, until, nativeFile, file, profile } = context;
  const settings = section => openViewSettingsSection(db, section);
  const closeSettings = () => setViewSettings(db, false);
  const peek = () => dialog(page, "记录预览");
  const openRecord = async id => {
    await nav("gallery");
    await db.locator('[data-item-id="' + id + '"] .db-gallery-open').click();
    await peek().waitFor();
    return peek();
  };
  const header = async name => {
    await button(db, "编辑 " + name + " 属性").click();
    return page.getByRole("menu", { name: name + " 属性菜单", exact: true });
  };
  const editSchema = async (name, type) => {
    const menu = await header(name);
    await menu.getByRole("menuitem", { name: "编辑属性…", exact: true }).click();
    return dialog(page, "编辑" + type + "属性");
  };
  const addSchema = async (type, name) => {
    const panel = await settings("添加属性");
    await field(panel, "新属性名称").fill(name);
    await button(field(panel, "属性类型"), type).click();
  };
  const artifact = (label, extension) => file(label).replace(/\.png$/u, extension);
  const firstCheck = async (loc, checked) => {
    await loc.setChecked(checked);
    assert.equal(await loc.isChecked(), checked);
  };

  await check("column-records", "表头真实拖放、表尾建记录、加子项、复制及批量回收", async () => {
    await nav("table");
    const from = db.locator("th").filter({ has: button(page, "编辑 状态 属性") });
    const to = db.locator("th").filter({ has: button(page, "编辑 金额 属性") });
    await from.dragTo(to, {sourcePosition: {x: 6, y: 6}, targetPosition: {x: 11, y: 6}});
    const moved = await persist(s => s.databaseViews.find(v => v.id === "view-table").visiblePropertyIds[1] === "amount");
    await db.locator(".db-table-create").click();
    const editor = db.locator(".db-title-editor");
    await editor.fill("操作母记录");
    await editor.press("Enter");
    const created = await persist(s => s.databaseItems.some(r => r.values.title === "操作母记录"));
    const parent = created.databaseItems.find(r => r.values.title === "操作母记录");
    const parentRow = db.locator('tr[data-item-id="' + parent.id + '"]');
    await button(parentRow, "+ 子项").click();
    const withChild = await persist(s => s.databaseItems.some(r => r.parentItemId === parent.id));
    const child = withChild.databaseItems.find(r => r.parentItemId === parent.id);
    await button(parentRow, "记录操作 操作母记录").click();
    const menu = page.getByRole("menu", { name: "操作母记录 记录菜单", exact: true });
    await menu.getByRole("menuitem", { name: "复制记录", exact: true }).click();
    const ids = new Set(withChild.databaseItems.map(r => r.id));
    const copied = await persist(s => s.databaseItems.some(r => !ids.has(r.id)));
    const copy = copied.databaseItems.find(r => !ids.has(r.id));
    await firstCheck(parentRow.locator('td.db-selection-cell input'), true);
    await firstCheck(db.locator('tr[data-item-id="' + copy.id + '"] td.db-selection-cell input'), true);
    const batch = db.getByRole("toolbar", { name: "批量操作" });
    assert.ok((await batch.innerText()).includes("已选择 2 条"));
    await button(batch, "移到回收站").click();
    const confirm = page.locator('[data-la-dialog="confirm"]');
    await button(confirm, "取消").click();
    assert.ok(!(await saved()).pages.find(p => p.id === copy.pageId).trashedAt);
    await button(batch, "取消选择").click();
    await firstCheck(db.locator('tr[data-item-id="' + copy.id + '"] td.db-selection-cell input'), true);
    await button(batch, "移到回收站").click();
    await button(confirm, "移到回收站").click();
    const final = await persist(s => s.pages.find(p => p.id === copy.pageId)?.trashedAt);
    assert.ok(!final.pages.find(p => p.id === parent.pageId).trashedAt);
    assert.ok(!final.pages.find(p => p.id === child.pageId).trashedAt);
    return { columnOrder: moved.databaseViews.find(v => v.id === "view-table").visiblePropertyIds.slice(0, 4), parentId: parent.id, childId: child.id, duplicateId: copy.id, copyTrashed: true };
  });

  await check("relation-rollup", "从 UI 创建跨库关联及汇总，选取和清除关联后核对计算", async () => {
    await nav("table");
    await addSchema("关联", "走查合作方");
    const relationDialog = dialog(page, "新建关联属性");
    await button(relationDialog, "保存属性").click();
    assert.ok(await field(relationDialog, "关联目标数据库").evaluate(el => el.validity.valueMissing));
    await field(relationDialog, "关联目标数据库").selectOption("partners");
    await button(relationDialog, "保存属性").click();
    const related = await persist(s => property(s, "走查合作方")?.config.targetSourceId === "partners");
    const relation = property(related, "走查合作方");
    await addSchema("汇总", "走查评分");
    const rollupDialog = dialog(page, "新建汇总属性");
    await field(rollupDialog, "汇总关联属性").selectOption(relation.id);
    await button(rollupDialog, "保存属性").click();
    assert.ok(await field(rollupDialog, "汇总目标属性").evaluate(el => el.validity.valueMissing));
    await field(rollupDialog, "汇总目标属性").selectOption("rating");
    await field(rollupDialog, "汇总计算").selectOption("average");
    await button(rollupDialog, "保存属性").click();
    const created = await persist(s => property(s, "走查评分")?.config.relationPropertyId === relation.id);
    const rollup = property(created, "走查评分");
    const panel = await openRecord("alpha");
    const editor = panel.locator('[data-property-id="' + relation.id + '"]');
    const calculated = panel.locator('[data-property-id="' + rollup.id + '"] .db-readonly-cell');
    await editor.locator("summary").click();
    await field(editor, "走查合作方 搜索").fill("供应方一");
    const choice = editor.getByRole("checkbox", { name: "走查合作方: 供应方一", exact: true });
    await choice.check();
    const withValue = await persist(s => row(s, "alpha").values[relation.id]?.includes("partner-one"));
    await until(() => calculated.innerText().then(t => t.includes("4.5")));
    const calculatedValue = await calculated.innerText();
    await choice.uncheck();
    await persist(s => !row(s, "alpha").values[relation.id]?.length);
    const cleared = await until(async () => { const value = await calculated.innerText(); return value !== calculatedValue && value; });
    await field(editor, "走查合作方 搜索").press("Escape");
    await button(panel, "关闭预览").click();
    return { relationId: relation.id, target: relation.config.targetSourceId, relatedIds: row(withValue, "alpha").values[relation.id], rollupId: rollup.id, calculation: rollup.config, calculatedValue, cleared };
  });

  await check("formula-format", "公式错误预览、插入属性、保存计算和数字格式", async () => {
    await nav("table");
    const modal = await editSchema("双倍金额", "公式");
    const expression = field(modal, "公式表达式");
    await expression.fill("1 + (");
    await until(() => modal.getByRole("status").innerText().then(t => t.includes("错误")));
    const error = await modal.getByRole("status").innerText();
    await expression.fill("");
    await button(modal.locator(".db-formula-properties"), "金额").click();
    await expression.press("End");
    await page.keyboard.insertText(" + 7");
    await field(modal, "数字格式").selectOption("cny");
    await field(modal, "小数位数").selectOption("2");
    await button(modal, "保存属性").click();
    const state = await persist(s => property(s, "双倍金额").config.expression.includes("+ 7") && property(s, "双倍金额").config.numberFormat?.format === "cny");
    const cell = db.locator('tr[data-item-id="alpha"] td[data-property-id="formula"]');
    await until(() => cell.innerText().then(t => /127\.00/u.test(t)));
    return { error, config: property(state, "双倍金额").config, computed: await cell.innerText() };
  });

  await check("people-place-contact", "人员选择、地点错误和校正、网址邮箱电话的输入与存储", async () => {
    const panel = await openRecord("alpha");
    const people = panel.locator('[data-property-id="people"]');
    await people.locator("summary").click();
    await field(people, "负责人 搜索").fill("周宁");
    await field(people, "负责人: 周宁").check();
    await field(people, "负责人 搜索").press("Escape");
    const place = panel.locator('[data-property-id="place"]');
    await place.locator("summary").click();
    await field(place, "地点 纬度").fill("100");
    await field(place, "地点 纬度").press("Tab");
    assert.ok((await place.getByRole("alert").innerText()).includes("90"));
    await field(place, "地点 纬度").fill("31.24");
    await field(place, "地点 纬度").press("Tab");
    await field(place, "地点 经度").fill("121.47");
    await field(place, "地点 经度").press("Tab");
    await field(place, "地点 名称").fill("走查地点");
    await field(place, "地点 名称").press("Tab");
    for (const [name, valid] of [["链接", "https://example.invalid/fixture"], ["邮箱", "fixture@example.invalid"], ["电话", "+86 021 12345678"]]) {
      const input = panel.getByRole("textbox", {name, exact:true});
      await input.fill(valid);
      await input.press("Tab");
    }
    const state = await persist(s => {
      const v = row(s, "alpha").values;
      return v.people.includes("person-b") && v.place.name === "走查地点" && v.place.latitude === 31.24 && v.place.longitude === 121.47 && v.url === "https://example.invalid/fixture" && v.email === "fixture@example.invalid" && v.phone === "+86 021 12345678";
    });
    const values = row(state, "alpha").values;
    await button(panel, "关闭预览").click();
    return { people: values.people, place: values.place, url: values.url, email: values.email, phone: values.phone };
  });

  async function fileSettings(maxSizeMb = 1, accept = ".txt") {
    await nav("table");
    const modal = await editSchema("附件", "文件和媒体");
    await field(modal, "文件类型约束").fill(accept);
    await field(modal, "文件大小上限").fill(String(maxSizeMb));
    await button(modal, "保存属性").click();
    return persist(s => property(s, "附件").config.maxSizeMb === maxSizeMb && property(s, "附件").config.accept === accept);
  }

  async function selectFiles(upload, paths) {
    if (process.env.LIFE_ATLAS_UX_DB_HTML_FILE_INPUT === "native" && paths.length === 1) {
      return nativeFile("open", paths[0], () => upload.click());
    }
    const chooser = page.waitForEvent("filechooser");
    await upload.click();
    await (await chooser).setFiles(paths);
    return {action:"real HTML file input with CDP-supplied QA files", files:paths.map(p => path.basename(p))};
  }

  const assetPath = digest => path.join(profile, "assets", digest.slice(0,2),digest);
  async function rejectWithoutMutation(before, recordId, files, expectedIssue) {
    const alert = page.getByRole("alertdialog");
    const message = await alert.innerText();
    assert.ok(message.includes(expectedIssue), message);
    await button(alert, "知道了").click();
    const after = await saved();
    assert.deepEqual(row(after,recordId).values.files, row(before,recordId).values.files);
    assert.deepEqual(after.attachments.map(a => a.id), before.attachments.map(a => a.id));
    for (const file of files) await assert.rejects(fs.access(assetPath(file.hash)), {code:"ENOENT"});
    return {message, existingRecordReferences:row(after,recordId).values.files, metadataUnchanged:true, absentAssets:files.map(f=>f.hash)};
  }

  if (process.env.LIFE_ATLAS_UX_DB_NATIVE_OPEN === "1") {
    await check("file-native-open", "Windows 文件字段原生打开框，取消并重新选择正常文件", async () => {
      const before = await fileSettings();
      const input = artifact("system-picker-fixture", ".txt");
      const bytes = Buffer.from("Windows 原生文件字段选择\n");
      const digest = sha256(bytes);
      await fs.writeFile(input, bytes);
      const panel = await openRecord("alpha");
      const files = panel.locator('[data-property-id="files"]');
      await files.locator("summary").click();
      const upload = files.locator('input[type="file"]');
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Page.setInterceptFileChooserDialog",{enabled:false});
      const proof = {source:path.basename(input),sha256:digest,chooserListenerCount:page.listenerCount("filechooser"),interceptEnabled:false};
      const record = () => fs.writeFile(artifact("native-file-field", ".json"), JSON.stringify(proof,null,2));
      proof.activation=await context.activateApp();
      await record();
      assert.ok(proof.activation.foregroundAfter.owned,"The field must be operated in the foreground isolated application");
      const choose = async () => {
        await upload.scrollIntoViewIfNeeded();
        proof.geometry = await upload.evaluate(el => {
          const r=el.getBoundingClientRect(); const x=r.left+12, y=r.top+r.height/2;
          window.__uxFileClick=null;
          el.addEventListener('click',event=>{window.__uxFileClick={trusted:event.isTrusted,tag:event.target.tagName,type:event.target.type,x:event.clientX,y:event.clientY};},{once:true});
          return {x,y,width:r.width,height:r.height,hit:document.elementFromPoint(x,y)===el,focused:document.hasFocus()};
        });
        assert.ok(proof.geometry.hit && proof.geometry.focused);
        await page.mouse.click(proof.geometry.x,proof.geometry.y);
      };
      try {
        proof.cancel=await nativeFile("cancel-open",input,choose);
        const afterCancel=await saved();
        assert.deepEqual(row(afterCancel,'alpha').values.files,row(before,'alpha').values.files);
        assert.deepEqual(afterCancel.attachments.map(a=>a.id),before.attachments.map(a=>a.id));
        await assert.rejects(fs.access(assetPath(digest)),{code:"ENOENT"});
        proof.open=await nativeFile("open",input,choose);
        const stored=await persist(s=>s.attachments.some(a=>a.storageKey===digest && row(s,'alpha').values.files.includes(a.id)));
        assert.ok((await fs.readFile(assetPath(digest))).equals(bytes));
        proof.asset=stored.attachments.find(a=>a.storageKey===digest);
        proof.assetBytesEqual=true;
        for (const receipt of [proof.cancel,proof.open]) {
          assert.equal(receipt.foregroundBeforeOpen.hwnd,proof.activation.hwnd);
          assert.ok(receipt.appForegroundAfter && receipt.foregroundAfterClose.hwnd===proof.activation.hwnd,"The native file chooser must return to the original isolated window");
        }
      } catch (error) { proof.error=error.message; throw error; }
      finally {
        proof.click=await page.evaluate(()=>window.__uxFileClick).catch(()=>null);
        await record();
        await cdp.detach();
      }
      await button(panel,"关闭预览").click();return proof;
    });
  }

  for (const [id, name, extension, length, expectedIssue] of [
    ["file-upload", "at-one-mib", ".TXT", 1024 * 1024, null],
    ["file-limit", "over-one-mib", ".txt", 1024 * 1024 + 1, "单文件上限"],
    ["file-type", "wrong-type", ".bin", 143, "允许的文件类型"],
  ]) {
    await check(id, expectedIssue ? "拒绝不符合限制的文件且保留既有引用和资产" : "选择恰好达到上限的大写扩展名文件并逐字节验证", async () => {
      const configured = await fileSettings();
      const input = artifact(name, extension);
      const bytes = Buffer.alloc(length, 65);
      const digest = sha256(bytes);
      await fs.writeFile(input, bytes);
      const panel = await openRecord("alpha");
      const files = panel.locator('[data-property-id="files"]');
      await files.locator("summary").click();
      const upload = files.locator('input[type="file"]');
      assert.equal(await upload.getAttribute("accept"), ".txt");
      const native = await selectFiles(upload,[input]);
      const observation = await until(async () => {
        const state = await saved();
        const stored = state.attachments.find(a => a.name === path.basename(input) && a.storageKey === digest);
        if (stored && row(state, "alpha").values.files.includes(stored.id)) return { stored };
        const alert = page.getByRole("alertdialog");
        if (await alert.isVisible()) return { error: await alert.innerText() };
        return false;
      });
      const result = { limits: property(configured, "附件").config, size: bytes.length, sha256: digest, native, ...observation };
      if (observation.stored) {
        const actual = await fs.readFile(assetPath(digest));
        assert.ok(actual.equals(bytes));
        result.assetBytesEqual = true;
      } else result.unchanged = await rejectWithoutMutation(configured, "alpha", [{hash:digest}], expectedIssue || "");
      await fs.writeFile(artifact(id + "-observation", ".json"), JSON.stringify(result, null, 2));
      if (expectedIssue) assert.ok(observation.error && !observation.stored, "Field accepted and persisted disallowed file " + path.basename(input) + " with " + bytes.length + " bytes");
      else assert.ok(result.assetBytesEqual);
      await button(panel, "关闭预览").click();
      return result;
    });
  }

  await check("file-multiple", "批量选择先整批校验、拒绝中间项后重选和混合 MIME/扩展名成功", async () => {
    const before = await fileSettings(1, "image/*,.txt,application/pdf");
    const panel = await openRecord("alpha");
    const files = panel.locator('[data-property-id="files"]');
    await files.locator("summary").click();
    const upload = files.locator('input[type="file"]');
    assert.equal(await upload.evaluate(node => node.multiple), true);
    const inputs = await Promise.all([["batch-photo", ".PNG", Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")], ["batch-large", ".txt", Buffer.alloc(1024*1024+1, 91)], ["batch-doc", ".pdf", Buffer.from("%PDF-1.4\nQA local file\n%%EOF\n")]].map(async ([name,ext,bytes]) => {
      const location=artifact(name,ext); await fs.writeFile(location,bytes); return {location,bytes,hash:sha256(bytes)};
    }));
    const invalid = await selectFiles(upload,inputs.map(f=>f.location));
    const rejected = await rejectWithoutMutation(before, "alpha", inputs, "单文件上限");
    if (!await upload.isVisible()) await files.locator("summary").click();
    const allowed=[inputs[0],inputs[2]];
    const retry = await selectFiles(upload,allowed.map(f=>f.location));
    const state=await persist(s => allowed.every(f => s.attachments.some(a=>a.storageKey===f.hash && row(s,'alpha').values.files.includes(a.id))));
    for (const f of allowed) assert.ok((await fs.readFile(assetPath(f.hash))).equals(f.bytes));
    assert.ok(row(before,'alpha').values.files.every(id=>row(state,'alpha').values.files.includes(id)));
    await button(panel,"关闭预览").click();
    return {invalid,rejected,retry,verifiedAssets:allowed.map(f=>f.hash),references:row(state,'alpha').values.files};
  });

  await check("file-reuse", "收紧限制保留已有附件、复用不符合上限的本地附件时明确拒绝", async () => {
    await fileSettings(2);
    const bytes=Buffer.alloc(1024*1024+3, 75), input=artifact("existing-binary", ".txt"), digest=sha256(bytes);
    await fs.writeFile(input,bytes);
    let panel=await openRecord("beta");
    let files=panel.locator('[data-property-id="files"]'); await files.locator("summary").click();
    const selected=await selectFiles(files.locator('input[type="file"]'),[input]);
    const created=await persist(s=>s.attachments.some(a=>a.storageKey===digest && row(s,'beta').values.files.includes(a.id)));
    const asset=created.attachments.find(a=>a.storageKey===digest);
    await button(panel,"关闭预览").click();
    const before=await fileSettings(1);
    assert.ok(row(before,'beta').values.files.includes(asset.id));
    panel=await openRecord("alpha"); files=panel.locator('[data-property-id="files"]');await files.locator("summary").click();
    await files.getByRole("checkbox",{name:"附件: "+path.basename(input),exact:true}).click();
    const rejected=await rejectWithoutMutation(before,"alpha",[],"单文件上限");
    const final=await saved(); assert.ok(row(final,'beta').values.files.includes(asset.id));
    assert.ok((await fs.readFile(assetPath(digest))).equals(bytes));
    await button(panel,"关闭预览").click();return {selected,assetId:asset.id,originalRecord:'beta',rejected,assetSha256:digest};
  });

  await databaseViewDetails({...context, button, field, dialog, row, peek, settings, closeSettings, openRecord, artifact, sha256});
}
