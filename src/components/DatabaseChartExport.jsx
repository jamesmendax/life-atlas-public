import { useMemo, useState } from "react";
import { buildChartSvg } from "../domain/chartImageExport.js";
import { downloadBlob } from "../domain/pageExport.js";
import { svgToPngBlob } from "../domain/roadmapExport.js";
import { writePngToClipboard } from "../editor/imageClipboard.js";
import { Dialog } from "../ui/Dialog.jsx";

function fileName(title, extension) {
  const name = String(title).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").trim().slice(0, 120).replace(/[. ]+$/g, "");
  return `${name || "图表"}-图表.${extension}`;
}

export function DatabaseChartExport({ title, projection, config, categoryProperty, groupProperty, onClose, restoreFocusRef }) {
  const [background, setBackground] = useState("current");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const currentTheme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const figure = useMemo(() => buildChartSvg({ title, projection, config, categoryProperty, groupProperty,
    theme: background === "current" ? currentTheme : background === "dark" ? "dark" : "light", background: background !== "transparent" }),
    [title, projection, config, categoryProperty, groupProperty, background, currentTheme]);
  const preview = useMemo(() => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(figure.svg)}`, [figure.svg]);

  async function save(format) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    const { svg, width, height } = figure;
    const png = () => svgToPngBlob(svg, { width, height, scale: Math.min(2, 6144 / Math.max(width, height), Math.sqrt(12_000_000 / (width * height))) });
    try {
      if (format === "copy") {
        await writePngToClipboard(png());
        setMessage({ text: "已复制 PNG。" });
      } else {
        const blob = format === "svg" ? new Blob([svg], { type: "image/svg+xml;charset=utf-8" }) : await png();
        const saved = await downloadBlob(blob, fileName(title, format));
        if (saved) setMessage({ text: `已保存 ${format.toUpperCase()}。` });
      }
    } catch (error) {
      setMessage({ error: true, text: format === "copy" ? `未能复制 PNG。${error?.message || "可下载 PNG 后分享。"}` : `未能导出图表。${error?.message || "请重试。"}` });
    } finally {
      setBusy(false);
    }
  }

  return <Dialog title="保存图表" className="db-chart-export" onClose={onClose} busy={busy} restoreFocusRef={restoreFocusRef}>
    <div className="mb-dialog-body">
      <label className="mb-form-row">背景<select aria-label="图表背景" value={background} disabled={busy} onChange={event => setBackground(event.target.value)}>
        <option value="current">当前外观</option><option value="light">浅色</option><option value="dark">深色</option><option value="transparent">透明</option>
      </select></label>
      <img className="db-chart-export-preview" src={preview} alt={`${title}导出预览`} />
      {message && <p role={message.error ? "alert" : "status"} className={message.error ? "mb-danger-text" : "mb-secondary"}>{message.text}</p>}
    </div>
    <footer className="mb-dialog-footer">
      <button className="mb-button" type="button" disabled={busy} onClick={() => save("copy")}>复制为 PNG</button>
      <button className="mb-button" type="button" disabled={busy} onClick={() => save("svg")}>下载 SVG</button>
      <button className="mb-button mb-primary" type="button" disabled={busy} onClick={() => save("png")}>下载 PNG</button>
    </footer>
  </Dialog>;
}
