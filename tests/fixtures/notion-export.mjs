import JSZip from "jszip";
import { PNG_1X1_BASE64, fixtureBytes } from "./full-workspace.mjs";

export const NOTION_IDS = Object.freeze({
  overview: "0123456789abcdef0123456789abcdef",
  meeting: "1111111111111111111111111111111a",
  tasks: "2222222222222222222222222222222b",
  personal: "3333333333333333333333333333333c",
});

const taskTitles = ["任务一", "任务二", "任务三", "任务四", "任务五"];
const taskStatuses = ["进行中", "完成", "进行中", "完成", "进行中"];
const taskDates = ["September 19, 2026", "September 20, 2026 10:00 AM", "", "September 21, 2026 → September 23, 2026", "Sep 25, 2026"];
const csvRows = [
  '任务一,进行中,"September 19, 2026","前端, 后端",Yes',
  '任务二,完成,"September 20, 2026 10:00 AM",前端,No',
  "任务三,进行中,,后端,No",
  '任务四,完成,"September 21, 2026 → September 23, 2026",,Yes',
  '任务五,进行中,"Sep 25, 2026",前端,No',
];

export function notionExportFiles() {
  const overview = `项目总览 ${NOTION_IDS.overview}`;
  const meeting = `会议记录 ${NOTION_IDS.meeting}`;
  const tasks = `任务库 ${NOTION_IDS.tasks}`;
  const personal = `个人笔记 ${NOTION_IDS.personal}`;
  const files = {
    [`${overview}.md`]: [
      "# 项目总览", "", "欢迎来到项目。", "", "## 本周", "", "- [ ] 写周报", "- [x] 开会", "", "> 一句引用", "",
      "```js", "const x = 1;", "```", "", `![架构图](项目总览%20${NOTION_IDS.overview}/架构图.png)`, "",
      `[会议记录](项目总览%20${NOTION_IDS.overview}/会议记录%20${NOTION_IDS.meeting}.md)`, "", "<aside>", "💡 提示：这是一个标注", "</aside>", "",
      "$$", "E = mc^2", "$$", "", "| 名称 | 数量 |", "| --- | --- |", "| 苹果 | 3 |", "",
      `[任务库](项目总览%20${NOTION_IDS.overview}/任务库%20${NOTION_IDS.tasks}.csv)`,
    ].join("\n"),
    [`${overview}/架构图.png`]: new Uint8Array(Buffer.from(PNG_1X1_BASE64, "base64")),
    [`${overview}/${meeting}.md`]: [
      "# 会议记录", "", `回到[项目总览](../项目总览%20${NOTION_IDS.overview}.md)。`, "", "- 第一条", "    - 子条目", "",
      `[说明文件](会议记录%20${NOTION_IDS.meeting}/说明.pdf)`,
    ].join("\n"),
    [`${overview}/${meeting}/说明.pdf`]: fixtureBytes("notion-pdf", 2048),
    [`${overview}/${tasks}.csv`]: ["名称,状态,截止,标签,完成", ...csvRows.slice(0, 4)].join("\n"),
    [`${overview}/${tasks}_all.csv`]: ["名称,状态,截止,标签,完成", ...csvRows].join("\n"),
    "readme.txt": "这是一个不认识的文件",
    [`${personal}.md`]: ["# 个人笔记", "", "**重要**：记得~~买菜~~。", "", `![照片](个人笔记%20${NOTION_IDS.personal}/照片.jpg)`].join("\n"),
    [`${personal}/照片.jpg`]: fixtureBytes("notion-jpg", 4096),
  };
  for (const [index, title] of taskTitles.entries()) {
    files[`${overview}/${tasks}/${title} 4444444444444444444444444444440${index + 1}.md`] = [
      `# ${title}`, "", `状态: ${taskStatuses[index]}`, `截止: ${taskDates[index]}`, "", `${title}的正文。`,
    ].join("\n");
  }
  return files;
}

export async function buildNotionExportZip({ split = true } = {}) {
  const zip = new JSZip();
  const files = Object.entries(notionExportFiles());
  if (split) {
    for (const part of [1, 2]) {
      const child = new JSZip();
      for (const [filePath, bytes] of files) {
        const inSecondPart = filePath.startsWith(`个人笔记 ${NOTION_IDS.personal}`);
        if (inSecondPart === (part === 2)) child.file(`Export-test/${filePath}`, bytes, { createFolders: false });
      }
      zip.file(`Export-test/Export-test-Part-${part}.zip`, await child.generateAsync({ type: "uint8array", compression: "DEFLATE" }), { createFolders: false });
    }
  } else {
    for (const [filePath, bytes] of files) zip.file(`Export-test/${filePath}`, bytes, { createFolders: false });
  }
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}

export async function buildHtmlExportZip() {
  const zip = new JSZip();
  zip.file(`Export-test/页面 ${NOTION_IDS.overview}.html`, "<html><body>页面</body></html>", { createFolders: false });
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
