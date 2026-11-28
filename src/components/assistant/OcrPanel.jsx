import React, { useCallback, useEffect, useRef, useState } from "react";
import IconClipboard from "@tabler/icons-react/dist/esm/icons/IconClipboard.mjs";
import IconCopy from "@tabler/icons-react/dist/esm/icons/IconCopy.mjs";
import IconPhoto from "@tabler/icons-react/dist/esm/icons/IconPhoto.mjs";
import IconScan from "@tabler/icons-react/dist/esm/icons/IconScan.mjs";

const LANGUAGES = [
  { value: "chi_sim+eng", label: "简体中文 + English" },
  { value: "chi_sim", label: "简体中文" },
  { value: "eng", label: "English" },
];

function afterPaint() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

export default function OcrPanel({ onScreenSelectingChange }) {
  const api = window.lifeAtlas?.ocr;
  const [language, setLanguage] = useState(LANGUAGES[0].value);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [status, setStatus] = useState();
  const [notice, setNotice] = useState(null);
  const running = useRef(false);
  const section = useRef(null);
  const resultField = useRef(null);
  const screenButton = useRef(null);
  const textId = React.useId();

  useEffect(() => {
    if (!api) return;
    let current = true;
    api.getStatus().then(
      (value) => { if (current) setStatus(value); },
      () => { if (current) setStatus({ available: false, message: "无法连接离线识别引擎。" }); },
    );
    return () => { current = false; };
  }, [api]);

  const recognize = useCallback(async (source) => {
    if (running.current || !status?.available) return;
    running.current = true;
    setBusy(source);
    setNotice(null);
    const selecting = source === "recognizeScreen";
    try {
      if (selecting) {
        onScreenSelectingChange?.(true);
        await afterPaint();
      }
      const result = await api[source](language);
      if (!result.ok) setNotice({ error: true, text: result.message });
      else if (!result.cancelled) {
        setText(result.text);
        if (!result.text) setNotice({ text: "未识别到文字，请试试更清晰的图片或更小的选区。" });
      }
    } catch {
      setNotice({ error: true, text: "识图时遇到问题，请重试。" });
    } finally {
      if (selecting) onScreenSelectingChange?.(false);
      running.current = false;
      setBusy("");
      if (selecting) requestAnimationFrame(() => screenButton.current?.focus({ preventScroll: true }));
    }
  }, [api, language, onScreenSelectingChange, status?.available]);

  useEffect(() => {
    const panel = section.current?.closest(".workspace-assistant");
    if (!panel || !status?.available) return;

    function paste(event) {
      if (event.defaultPrevented) return;
      const types = event.clipboardData?.types ?? [];
      const hasImageOrFile = types.includes("Files") || types.some((type) => type.startsWith("image/"));
      if (event.target === resultField.current && types.includes("text/plain") && !hasImageOrFile) return;
      event.preventDefault();
      void recognize("recognizeClipboard");
    }

    function shortcut(event) {
      if (event.defaultPrevented || event.target === resultField.current || event.isComposing ||
          !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== "v") return;
      event.preventDefault();
      if (!event.repeat) void recognize("recognizeClipboard");
    }

    panel.addEventListener("paste", paste);
    panel.addEventListener("keydown", shortcut);
    return () => {
      panel.removeEventListener("paste", paste);
      panel.removeEventListener("keydown", shortcut);
    };
  }, [recognize, status?.available]);

  async function copyText() {
    if (running.current || !text.trim()) return;
    running.current = true;
    setBusy("copy");
    setNotice(null);
    try {
      const result = await api.copyText(text);
      setNotice(result.ok ? { text: "已复制文字" } : { error: true, text: result.message });
    } catch {
      setNotice({ error: true, text: "无法复制文字，请再试一次。" });
    } finally {
      running.current = false;
      setBusy("");
    }
  }

  const disabled = Boolean(busy) || !status?.available;
  const selecting = busy === "recognizeScreen";
  const activity = busy && busy !== "copy" ? "正在识别…" : "";
  const engineError = api ? status?.message : "请在 Life Atlas 桌面版中使用识图。";

  return (
    <section ref={section} className="la-ocr" aria-label="识图" aria-busy={Boolean(busy)} hidden={selecting}>
      <div className="la-ocr__settings">
        <label>
          识别语言
          <select className="la-ocr__language" value={language} disabled={disabled} onChange={(event) => setLanguage(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape" && event.currentTarget.matches(":open")) event.stopPropagation(); }}>
            {LANGUAGES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        {status?.available && <span title={status.engine}>离线识别</span>}
      </div>

      <div className="la-ocr__sources">
        <button ref={screenButton} type="button" className="la-ocr__primary" disabled={disabled} onClick={() => recognize("recognizeScreen")}><IconScan size={16} aria-hidden="true" />框选屏幕</button>
        <button type="button" disabled={disabled} onClick={() => recognize("recognizeFile")}><IconPhoto size={16} aria-hidden="true" />选择图片</button>
        <button type="button" disabled={disabled} title="从剪贴板识图（Ctrl+V）" aria-keyshortcuts="Control+V Meta+V" onClick={() => recognize("recognizeClipboard")}><IconClipboard size={16} aria-hidden="true" />剪贴板图片</button>
      </div>

      <div className="la-ocr__result">
        <label htmlFor={textId}>识别结果</label>
        <textarea ref={resultField} id={textId} spellCheck={false} value={text} readOnly={Boolean(busy)} placeholder="识别出的文字会显示在这里" onChange={(event) => { setText(event.target.value); setNotice(null); }} />
      </div>

      <footer className="la-ocr__footer">
        <span className="la-ocr__notice" data-error={Boolean(notice?.error || engineError)} role="status">{activity || notice?.text || engineError}</span>
        <button type="button" disabled={!api || !text.trim() || Boolean(busy)} onClick={copyText}><IconCopy size={16} aria-hidden="true" />复制文字</button>
      </footer>
    </section>
  );
}
