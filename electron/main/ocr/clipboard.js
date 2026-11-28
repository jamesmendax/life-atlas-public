import path from "node:path";
import { fileURLToPath } from "node:url";
import { OcrError } from "./errors.js";
import { IMAGE_EXTENSIONS, MAX_IMAGE_BYTES, readImageFile } from "./images.js";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
const FILE_LIST = "text/uri-list";

function localFilePath(value) {
  if (!URL.canParse(value)) return;
  const url = new URL(value);
  if (url.protocol !== "file:" || url.hostname || url.search || url.hash) return;
  try {
    return fileURLToPath(url);
  } catch {
    return undefined;
  }
}

export async function readClipboardImage(clipboard) {
  try {
    const items = await clipboard.read();
    for (const type of IMAGE_TYPES) {
      const item = items.find((entry) => entry.types.includes(type));
      if (!item) continue;
      const image = await item.getType(type);
      if (image.size > MAX_IMAGE_BYTES) throw new OcrError("E_OCR_SIZE");
      return Buffer.from(await image.arrayBuffer());
    }

    const files = items.find((entry) => entry.types.includes(FILE_LIST));
    if (!files) throw new OcrError("E_OCR_CLIPBOARD");
    // Electron exposes the Windows file-drop list as local file URIs.
    const uris = await files.getType(FILE_LIST);
    if (uris.size > MAX_IMAGE_BYTES) throw new OcrError("E_OCR_CLIPBOARD_READ");
    const paths = (await uris.text()).split(/\r?\n/).map(localFilePath).filter(Boolean);
    if (!paths.length) throw new OcrError("E_OCR_CLIPBOARD");
    const selected = paths.find((filePath) => IMAGE_EXTENSIONS.includes(path.extname(filePath).slice(1).toLowerCase()));
    if (!selected) throw new OcrError("E_OCR_IMAGE");
    return await readImageFile(selected);
  } catch (error) {
    if (error instanceof OcrError) throw error;
    throw new OcrError("E_OCR_CLIPBOARD_READ");
  }
}
