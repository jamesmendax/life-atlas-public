import { randomBytes } from "node:crypto";

// All field text and option titles use DOM text nodes. No remote assets or scripts.
function renderPublicForm(spec) {
  const form = document.querySelector("form"),
    message = document.querySelector('[role="status"]');
  document.querySelector("h1").textContent = spec.title || "填写表单";
  document.querySelector("#description").textContent = spec.description || "";
  const fields = [];
  let requestId;
  const uuid = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = bytes[6] & 15 | 64;
    bytes[8] = bytes[8] & 63 | 128;
    const s = Array.from(bytes, v => v.toString(16).padStart(2, "0")).join("");
    return [s.slice(0, 8), s.slice(8, 12), s.slice(12, 16), s.slice(16, 20), s.slice(20)].join("-");
  };
  for (const field of spec.fields) {
    const label = document.createElement("label"),
      title = document.createElement("span");
    title.textContent = field.name + (field.required ? " *" : "");
    const choice = ["select", "multi_select", "status"].includes(field.type);
    const input = document.createElement(choice ? "select" : field.type === "text" ? "textarea" : "input");
    if (choice) {
      input.multiple = field.type === "multi_select";
      if (!input.multiple) input.add(new Option("请选择", ""));
      for (const opt of field.options || []) {
        const selected = [].concat(field.defaultValue || []).includes(opt.id);
        input.add(new Option(opt.name, opt.id, selected, selected));
      }
    } else {
      if (input.tagName === "INPUT") input.type = {
        title: "text",
        phone: "tel",
        checkbox: "checkbox",
        email: "email",
        number: "number",
        date: "date",
        url: "url"
      }[field.type] || "text";
      if (field.type === "number") input.step = "any";
      if (field.type === "checkbox") input.checked = field.defaultValue === true;else input.value = field.defaultValue ?? "";
    }
    // A required yes/no question can be answered false.
    input.required = field.required && field.type !== "checkbox";
    label.append(title, input);
    form.insertBefore(label, form.querySelector("button"));
    fields.push({
      field,
      input,
      label
    });
  }
  function collect() {
    const answers = Object.create(null);
    for (const {
      field,
      input,
      label
    } of fields) {
      const rule = field.showWhen,
        trigger = rule && answers[rule.propertyId];
      const shown = !rule || (typeof trigger === "boolean" ? trigger === (rule.value === true || rule.value === "true") : Array.isArray(trigger) ? trigger.includes(rule.value) : trigger === rule.value);
      if (!shown && !label.hidden) {
        if (input.multiple) for (const option of input.options) option.selected = [].concat(field.defaultValue || []).includes(option.value);else if (field.type === "checkbox") input.checked = field.defaultValue === true;else input.value = field.defaultValue ?? "";
      }
      label.hidden = !shown;
      input.disabled = !shown;
      if (shown) answers[field.id] = input.multiple ? [...input.selectedOptions].map(o => o.value) : field.type === "checkbox" ? input.checked : input.value;
    }
    return answers;
  }
  collect();
  form.addEventListener("input", () => {
    requestId = undefined;
    message.textContent = "";
    collect();
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const button = form.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    message.textContent = "正在提交…";
    requestId ||= uuid();
    try {
      const result = await fetch(location.pathname, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          requestId,
          values: collect()
        })
      });
      const reply = await result.json();
      if (!result.ok) throw new Error(reply.message || "无法提交，请稍后重试。");
      form.hidden = true;
      message.textContent = "提交成功，感谢填写。";
    } catch (error) {
      message.textContent = error.message === "Failed to fetch" ? "连接中断，请重试提交。" : error.message;
      button.disabled = false;
    }
  });
}
export function formSharePage({
  title,
  description,
  fields
}) {
  const nonce = randomBytes(16).toString("base64");
  const data = JSON.stringify({
    title,
    description,
    fields
  }).replaceAll("<", "\\u003c");
  const csp = "default-src 'none'; style-src 'nonce-" + nonce + "'; script-src 'nonce-" + nonce + "'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  const html = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>填写表单 · Life Atlas</title><style nonce="' + nonce + '">' + 'html{font:16px/1.55 system-ui,sans-serif;color:#232420;background:#fbfbf9}main{box-sizing:border-box;max-width:40rem;margin:5vh auto;padding:2rem}h1{font-size:clamp(1.7rem,6vw,2.4rem);line-height:1.2}p{white-space:pre-wrap}label{display:block;margin:1.3rem 0}label span{display:block;font-weight:600;margin-bottom:.35rem}input,select,textarea,button{box-sizing:border-box;font:inherit}input:not([type=checkbox]),select,textarea{width:100%;padding:.55rem;border:1px solid #acaea7;border-radius:.35rem;background:white;color:#222}textarea{min-height:6rem}input[type=checkbox]{width:1.2rem;height:1.2rem}button{background:#292b27;color:white;border:0;border-radius:.35rem;padding:.55rem 1.1rem;cursor:pointer}button:disabled{opacity:.65}[hidden]{display:none!important}</style>' + '<main><h1></h1><p id="description"></p><form><button type="submit">提交</button></form><p role="status" aria-live="polite"></p></main>' + '<script nonce="' + nonce + '">(' + renderPublicForm.toString() + ')(' + data + ')</script></html>';
  return {
    html,
    csp
  };
}
