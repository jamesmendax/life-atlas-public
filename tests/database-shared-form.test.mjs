import test from "node:test";
import assert from "node:assert/strict";
import { sharedFormSpec, acceptSharedAnswer } from "../src/domain/sharedForm.js";
import { changeFormAnswer, formForView, validateFormValues } from "../src/domain/viewProjections.js";

function example() {
  const fields = [
    {id:"title",type:"title",name:"名称"}, {id:"kind",type:"select",name:"类型",options:[{id:"trip",name:"出行"},{id:"work",name:"办公"}]},
    {id:"seat",type:"number",name:"人数"},{id:"day",type:"date",name:"日期"},{id:"internal",type:"text",name:"内部备注"},
    {id:"files",type:"files",name:"附件"},
  ];
  return {pages:[{id:"p",settings:{}}],dataSources:[{id:"source",ownerPageId:"p",properties:fields}],databaseViews:[{id:"form",sourceId:"source",type:"form",config:{form:{title:"报名",fields:[
    {propertyId:"title",required:true},{propertyId:"kind"},{propertyId:"seat",required:true,showWhen:{propertyId:"kind",value:"trip"}},{propertyId:"day"},{propertyId:"internal",hidden:true,defaultValue:"private"},
  ]}}}]};
}

test("公开表单的选项和字段是明确投影，后来增加的字段不会加入既有链接", () => {
  const w=example(), spec=sharedFormSpec(w,"form"), allowed=spec.fields.map(f=>f.id);
  assert.deepEqual(allowed,["title","kind","seat","day"]);
  assert.ok(!JSON.stringify(spec.fields).includes("private"));
  w.dataSources[0].properties.push({id:"later",name:"新增保密字段",type:"text"});
  assert.deepEqual(sharedFormSpec(w,"form",allowed).fields,spec.fields);
  assert.throws(()=>acceptSharedAnswer(w,"form",allowed,{title:"X",later:"x"}));
  w.pages[0].settings.locked=true;
  assert.throws(()=>sharedFormSpec(w,"form"));
});

test("本地与匿名表单均不保存未进入的分支或填写者伪造的隐藏值", () => {
  const w=example(), src=w.dataSources[0], v=w.databaseViews[0], form=formForView(src,v);
  const allowed=sharedFormSpec(w,"form").fields.map(f=>f.id);
  assert.equal(validateFormValues(src,form,{title:"A",kind:"work",seat:33,internal:"fake"}).values.seat,undefined);
  const switched = changeFormAnswer(src, form, {title:"A",kind:"trip",seat:79}, "kind", "work");
  assert.equal(changeFormAnswer(src, form, switched, "kind", "trip").seat, undefined);
  assert.deepEqual(acceptSharedAnswer(w,"form",allowed,{title:"A",kind:"work",seat:"33"}).values,{title:"A",kind:"work",internal:"private"});
  assert.throws(()=>acceptSharedAnswer(w,"form",allowed,{title:"A",kind:"trip"}));
  assert.throws(()=>acceptSharedAnswer(w,"form",allowed,{title:"A",kind:"other"}));
  assert.throws(()=>acceptSharedAnswer(w,"form",allowed,{title:"A",internal:"fake"}));
  const {values}=acceptSharedAnswer(w,"form",allowed,{title:"A",kind:"trip",seat:"2",day:"2028-02-29"});
  assert.equal(values.seat,2); assert.equal(values.day.start,"2028-02-29");
  assert.throws(()=>acceptSharedAnswer(w,"form",allowed,{title:"A",day:"2027-02-29"}));
});
