import { browserScenario } from "./harness.mjs";
import { CURRENT_SCHEMA_VERSION } from "../../src/persistence/migrations.js";

await browserScenario("phase3-workspace", async ({ page, check, screenshot, saved, persisted, assert }) => {
  const waitForRecordPage = async () => {
    await page.getByLabel("记录属性", { exact:true }).waitFor();
    await page.getByRole("button", { name:"工作区工具", exact:true }).waitFor();
  };
  const openAlpha = async () => {
    const db = page.locator('section.database-view[data-source-id="projects"]');
    await db.waitFor();
    await db.locator('tr[data-item-id="alpha"] td[data-property-id="title"]').hover();
    await db.getByRole("button", { name:"打开 Alpha 项目", exact:true }).click();
    await page.getByRole("button", { name:"打开完整页面", exact:true }).click();
    await waitForRecordPage();
  };
  const openTools = async (tab = null) => {
    const trigger = page.getByRole("button",{name:"工作区工具",exact:true});
    if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
    const panel = page.getByLabel("工作区工具面板",{exact:true});
    await panel.waitFor();
    if (tab) await panel.getByRole("button",{name:tab,exact:true}).click();
  };

  await check("Page and database templates persist, clone fresh block IDs and create a new database item on the same source", async () => {
    await openAlpha();
    await openTools("模板");

    await page.getByLabel("页面模板名称",{exact:true}).fill("Phase3 项目页模板");
    await page.getByRole("button",{name:"保存为模板",exact:true}).click();
    const pageTemplateState = await persisted((value)=>value.pageTemplates?.some((entry)=>entry.name==="Phase3 项目页模板"));
    const pageTemplate = pageTemplateState.pageTemplates.find((entry)=>entry.name==="Phase3 项目页模板");
    assert.ok(pageTemplate);

    await page.getByLabel("数据库模板名称",{exact:true}).fill("Phase3 冲刺模板");
    await page.getByRole("button",{name:"保存数据库模板",exact:true}).click();
    const dbTemplateState = await persisted((value)=>value.databaseTemplates?.some((entry)=>entry.name==="Phase3 冲刺模板"));
    const dbTemplate = dbTemplateState.databaseTemplates.find((entry)=>entry.name==="Phase3 冲刺模板");
    assert.equal(dbTemplate.sourceId,"projects");

    const before = await saved();
    await page.getByLabel("选择数据库模板",{exact:true}).selectOption(dbTemplate.id);
    await page.getByRole("button",{name:"从模板新建记录",exact:true}).click();
    const created = await persisted((value)=>value.databaseItems.length===before.databaseItems.length+1);
    const newItem = created.databaseItems.at(-1);
    assert.equal(newItem.sourceId,"projects");
    assert.equal(newItem.values.status,"doing");
    const newPage = created.pages.find((entry)=>entry.id===newItem.pageId);
    const oldPage = created.pages.find((entry)=>entry.id==="alpha-page");
    assert.ok(newPage && oldPage);
    assert.notEqual(newPage.content[0].id,oldPage.content[0].id);
  });

  await check("Page and block discussions support replies, resolve/reopen and survive reload", async () => {
    if (!(await page.getByLabel("记录属性",{exact:true}).count())) {
      await openAlpha();
    }
    await openTools("讨论");
    await page.getByLabel("新评论",{exact:true}).fill("Phase3 页面讨论 唯一搜索词");
    await page.getByRole("button",{name:"添加讨论",exact:true}).click();
    const pageThread = await persisted((value)=>value.comments?.some((entry)=>entry.body.includes("Phase3 页面讨论")));
    const pageDiscussion = pageThread.discussions.find((entry)=>entry.pageId==="alpha-page" && entry.anchor.kind==="page");
    assert.ok(pageDiscussion);

    await page.getByLabel("评论锚点类型",{exact:true}).selectOption("block");
    await page.getByLabel("评论区块",{exact:true}).selectOption("alpha-body");
    await page.getByLabel("新评论",{exact:true}).fill("Phase3 区块讨论");
    await page.getByRole("button",{name:"添加讨论",exact:true}).click();
    const blockState = await persisted((value)=>value.discussions?.some((entry)=>entry.pageId==="alpha-page" && entry.anchor?.blockId==="alpha-body"));
    const blockDiscussion = blockState.discussions.find((entry)=>entry.anchor?.blockId==="alpha-body");
    assert.ok(blockDiscussion);

    const pageThreadCard = page.locator(`[data-discussion-id="${pageDiscussion.id}"]`);
    await pageThreadCard.getByLabel(`回复 ${pageDiscussion.id}`,{exact:true}).fill("收到，继续补充");
    await pageThreadCard.getByRole("button",{name:"回复",exact:true}).click();
    await persisted((value)=>value.comments?.some((entry)=>entry.discussionId===pageDiscussion.id && entry.body==="收到，继续补充"));
    await pageThreadCard.getByRole("button",{name:"解决",exact:true}).click();
    await persisted((value)=>Boolean(value.discussions.find((entry)=>entry.id===pageDiscussion.id)?.resolvedAt));
    await pageThreadCard.getByRole("button",{name:"重新打开",exact:true}).click();
    await persisted((value)=>value.discussions.find((entry)=>entry.id===pageDiscussion.id)?.resolvedAt===null);

    await page.reload({waitUntil:"domcontentloaded"});
    await waitForRecordPage();
    await openTools("讨论");
    assert.equal(await page.locator(`[data-discussion-id="${blockDiscussion.id}"]`).count(),1);
  });

  await check("Attachment metadata binds to the database Files property without binary localStorage payloads", async () => {
    await openTools("附件");
    await page.getByLabel("附件名称",{exact:true}).fill("Phase3-spec.pdf");
    await page.getByLabel("附件地址",{exact:true}).fill("https://example.com/phase3-spec.pdf");
    await page.getByRole("button",{name:"添加附件",exact:true}).click();
    const state = await persisted((value)=>{
      const file=value.attachments?.find((entry)=>entry.name==="Phase3-spec.pdf");
      const item=value.databaseItems.find((entry)=>entry.id==="alpha");
      return file && item.values.files?.includes(file.id);
    });
    const file=state.attachments.find((entry)=>entry.name==="Phase3-spec.pdf");
    assert.equal(file.provider,"external");
    assert.equal(file.externalUrl,"https://example.com/phase3-spec.pdf");
    assert.equal(JSON.stringify(state.attachments).includes("data:"),false);
    assert.match(await page.locator(".workspace-attachment-list").getByText("Phase3-spec.pdf",{exact:true}).innerText(),/Phase3-spec\.pdf/);
  });

  await check("Workspace search retrieves comments and human-readable database values and routes back to the record page", async () => {
    await page.keyboard.press("Control+k");
    const dialog=page.getByRole("dialog",{name:"全局搜索",exact:true});
    await dialog.waitFor();
    const search=dialog.locator('input').first();
    await search.fill("Phase3 页面讨论 唯一搜索词");
    const result=dialog.getByRole("option").first();
    await result.waitFor();
    assert.match(await result.innerText(),/Phase3 页面讨论/);
    await result.click();
    await waitForRecordPage();

    await page.keyboard.press("Control+k");
    const dialog2=page.getByRole("dialog",{name:"全局搜索",exact:true});
    await dialog2.locator('input').first().fill("柏林");
    const dbResult=dialog2.getByRole("option").filter({hasText:"Alpha 项目"}).first();
    await dbResult.waitFor();
    await dbResult.click();
    await waitForRecordPage();
  });

  await check("Phase 3 collections and workspace tools persist after reload with no data-source duplication", async () => {
    const before=await saved();
    const sourceCount=before.dataSources.length;
    const projectItems=before.databaseItems.filter((entry)=>entry.sourceId==="projects").length;
    await page.reload({waitUntil:"domcontentloaded"});
    await waitForRecordPage();
    const after=await saved();
    assert.equal(after.schemaVersion,CURRENT_SCHEMA_VERSION);
    assert.equal(after.dataSources.length,sourceCount);
    assert.equal(after.databaseItems.filter((entry)=>entry.sourceId==="projects").length,projectItems);
    assert.ok(after.pageTemplates.some((entry)=>entry.name==="Phase3 项目页模板"));
    assert.ok(after.databaseTemplates.some((entry)=>entry.name==="Phase3 冲刺模板"));
    assert.ok(after.comments.some((entry)=>entry.body.includes("Phase3 页面讨论")));
    assert.ok(after.attachments.some((entry)=>entry.name==="Phase3-spec.pdf"));
    await openTools("讨论");
    await screenshot("workspace");
  });
});
