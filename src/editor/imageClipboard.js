// Call during the user's click with a blob or its encoding promise.
export function writePngToClipboard(png) {
  if (!navigator.clipboard?.write || typeof ClipboardItem !== "function") {
    return Promise.resolve(png).then(() => { throw new Error("当前环境无法复制 PNG。可下载 PNG 后分享。"); });
  }
  return navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

// Use the rendered image: its source has already been resolved by the editor's
// attachment resolver, including managed local attachments.
export function copyImagePixels(image) {
  if (!image?.complete || !image.naturalWidth || !image.naturalHeight) throw new Error("图片尚未就绪");
  const canvas = image.ownerDocument.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("图片无法解码");
  context.drawImage(image, 0, 0);
  const png = new Promise((resolve, reject) => {
    try { canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("图片无法编码")), "image/png"); }
    catch (error) { reject(error); }
  });
  return writePngToClipboard(png);
}
