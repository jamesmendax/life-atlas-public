const MESSAGES = {
  E_OCR_ACCESS: "当前窗口无法使用识图。",
  E_OCR_BUSY: "正在处理另一张图片，请稍后重试。",
  E_OCR_ENGINE: "离线识别引擎或语言模型无法加载，请检查 Life Atlas 安装。",
  E_OCR_IMAGE: "无法读取这张图片。请选择有效的 PNG、JPG 或 WebP 图片。",
  E_OCR_LANGUAGE: "请选择支持的识别语言。",
  E_OCR_FILE: "无法打开所选图片，请检查文件是否可读。",
  E_OCR_SIZE: "图片太大，请裁剪或缩小后重试。",
  E_OCR_CLIPBOARD: "剪贴板里没有图片，请先复制一张图片。",
  E_OCR_CLIPBOARD_READ: "无法读取剪贴板，请重新复制图片后重试。",
  E_OCR_SCREEN: "无法获取屏幕画面，请重试或选择图片文件。",
  E_OCR_SELECTION: "选区太小，请重新框选要识别的文字。",
  E_OCR_DISPLAY: "屏幕布局已变化，请重新框选。",
  E_OCR_TIMEOUT: "识别超时，请缩小图片或选区后重试。",
  E_OCR_COPY: "无法复制文字，请再试一次。",
  E_OCR_UNKNOWN: "识图时遇到问题，请重试。",
};

export class OcrError extends Error {
  constructor(code) {
    super(MESSAGES[code] ?? MESSAGES.E_OCR_UNKNOWN);
    this.name = "OcrError";
    this.code = code;
  }
}

export function ocrFailure(error) {
  const safe = error instanceof OcrError ? error : new OcrError("E_OCR_UNKNOWN");
  return { ok: false, code: safe.code, message: safe.message };
}
