import { useMemo } from "react";
import { qrcode } from "qrcode-generator";

function encodeLink(url) {
  try {
    const code = qrcode(0, "M");
    code.addData(url, "Byte");
    code.make();
    const modules = code.getModuleCount() + 8;
    const pixels = Math.max(1, Math.min(5, Math.floor(224 / modules)));
    return { image: code.createDataURL(pixels, 4 * pixels), size: modules * pixels };
  } catch {
    // Long links can exceed the QR format's capacity. The URL remains copyable.
    return null;
  }
}

export default function AmapImportCode({ url }) {
  const code = useMemo(() => url ? encodeLink(url) : null, [url]);
  if (!code) return null;
  return <figure className="trip-import-code">
    <img src={code.image} width={code.size} height={code.size} alt="整趟旅行的高德导入二维码" />
    <figcaption>用手机扫码打开高德专属地图</figcaption>
  </figure>;
}
