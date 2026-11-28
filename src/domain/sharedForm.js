import { formFields, formForView, formDefaults, activeFormFields, validateFormValues } from "./viewProjections.js";
import { normalizeViewConfig } from "./viewRegistry.js";
import { isEmptyProperty } from "./databaseProperties.js";

const publicTypes = new Set(["title","text","number","checkbox","select","multi_select","status","date","url","email","phone"]);
const choiceTypes = new Set(["select", "multi_select", "status"]);

function sharedQuestions(workspace, viewId, allowedIds) {
  const view = workspace.databaseViews?.find(entry => entry.id === viewId && entry.type === "form");
  const source = view && workspace.dataSources?.find(entry => entry.id === view.sourceId);
  const owner = source?.ownerPageId && workspace.pages?.find(page => page.id === source.ownerPageId);
  if (!source || source.trashedAt || source.locked || (source.ownerPageId && (!owner || owner.trashedAt || owner.settings?.locked))) throw new Error("表单所在数据库已关闭或锁定");
  const form = formForView(source, view, normalizeViewConfig("form", view.config).form);
  if (!form.open) throw new Error("表单已关闭提交");
  const allowed = allowedIds == null ? null : new Set(allowedIds);
  const exposed = new Set(), omitted = [], fields = [];
  for (const field of formFields(source, form)) {
    const {property, showWhen} = field;
    if (field.hidden) {
      if (field.required && !showWhen && isEmptyProperty(field.defaultValue)) throw new Error(property.name + " 已隐藏且必填，请先设置默认值");
      continue;
    }
    if (allowed && !allowed.has(property.id)) continue;
    if (showWhen && !exposed.has(showWhen.propertyId)) continue;
    if (!publicTypes.has(property.type)) {
      if (field.required) throw new Error(property.name + " 需要在工作区内填写，请调整必填设置后再分享");
      omitted.push(property.name);
      continue;
    }
    const question = {id:property.id, name:property.name, type:property.type, required:Boolean(field.required)};
    if (choiceTypes.has(property.type)) question.options = (property.options || []).map(({id,name}) => ({id,name}));
    if (showWhen) question.showWhen = { propertyId:showWhen.propertyId, value:showWhen.value };
    if (field.defaultValue != null) {
      const value = field.defaultValue;
      if (property.type === "date") question.defaultValue = String(value.start || value).slice(0, 10);
      else if (["string","boolean","number"].includes(typeof value)) question.defaultValue = value;
      else if (property.type === "multi_select" && Array.isArray(value)) question.defaultValue = value.filter(id => question.options.some(o => o.id === id));
    }
    fields.push(question);
    exposed.add(property.id);
  }
  if (!fields.length) throw new Error("表单没有可共享的问题");
  return {source, form, fields, omitted, exposed};
}

export function sharedFormSpec(workspace, viewId, allowedIds) {
  const {form, fields, omitted} = sharedQuestions(workspace, viewId, allowedIds);
  return {title:form.title, description:form.description, fields, omitted};
}

function typedAnswer(field, raw) {
  const invalid = () => { throw new Error(field.name + " 的答案无效"); };
  if (field.type === "checkbox") {
    if (![true,false,"true","false","on","",null].includes(raw)) invalid();
    return raw === true || raw === "true" || raw === "on";
  }
  if (raw == null || raw === "") return null;
  if (field.type === "multi_select") {
    const values = Array.isArray(raw) ? raw : [raw];
    if (values.length > field.options.length || values.some(id => !field.options.some(o => o.id === id))) invalid();
    return [...new Set(values)];
  }
  if (typeof raw !== "string" && !(field.type === "number" && typeof raw === "number")) invalid();
  const text = String(raw).trim();
  if (text.length > 12000) invalid();
  if (field.type === "number") { if (!Number.isFinite(Number(text))) invalid(); return Number(text); }
  if (choiceTypes.has(field.type) && !field.options.some(o => o.id === text)) invalid();
  if (field.type === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) invalid();
    const day = new Date(text + "T00:00:00Z");
    if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== text) invalid();
    return {start:text,end:null,includeTime:false,timeZone:null};
  }
  return text;
}

export function acceptSharedAnswer(workspace, viewId, allowedIds, input) {
  const {source, form, fields, exposed} = sharedQuestions(workspace, viewId, allowedIds);
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(id => !exposed.has(id))) throw new Error("提交包含未开放的问题");
  const answers = Object.create(null);
  for (const field of fields) {
    if (Object.hasOwn(input, field.id)) answers[field.id] = typedAnswer(field, input[field.id]);
    else if (field.type === "checkbox") answers[field.id] = false;
  }
  // Non-public optional questions and questions added after publishing never
  // receive external values. Hidden local defaults stay on the owner's device.
  const relevant = form.fields.filter(f => f.hidden || exposed.has(f.propertyId));
  const permittedIds = new Set(relevant.map(f => f.propertyId));
  const privateSource = {...source, properties:source.properties.filter(p => permittedIds.has(p.id))};
  const active = new Set(activeFormFields(privateSource, { ...form, fields: relevant }, { ...formDefaults(privateSource,form), ...answers }).filter(f => !f.hidden).map(f => f.propertyId));
  for (const id of Object.keys(answers)) if (!active.has(id)) delete answers[id];
  const result = validateFormValues(privateSource, {...form,fields:relevant}, answers);
  if (!result.valid) throw new Error(Object.values(result.errors).join("。"));
  return {values:result.values};
}
