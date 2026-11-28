import { createContext, useContext, useEffect, useRef, useState } from "react";
import { attachmentForUrl, resolveAttachmentMediaUrl } from "../domain/attachmentUrls.js";

export const AttachmentMediaContext = createContext(null);

export function useAttachmentMediaUrl(url) {
  const runtime = useContext(AttachmentMediaContext);
  const runtimeRef = useRef(runtime);
  runtimeRef.current = runtime;
  const attachment = attachmentForUrl(url, runtime?.workspace?.attachments);
  const key = `${url || ""}:${attachment?.id || ""}:${attachment?.provider || ""}:${attachment?.storageKey || ""}`;
  const [result, setResult] = useState(null);
  const needsResolution = /^(?:blob|life-asset):/i.test(url || "");
  const remote = /^(?:https?|wss?|file|ftp):/i.test(url || "") || /^\/\//.test(url || "");
  useEffect(() => {
    if (!needsResolution) return undefined;
    let active = true;
    resolveAttachmentMediaUrl(url, runtimeRef.current).then((value) => {
      if (active) setResult({ key, value });
    }).catch(() => { if (active) setResult({ key, value: null }); });
    return () => { active = false; };
  }, [key, needsResolution, url]);
  if (remote) return null;
  return needsResolution ? result?.key === key ? result.value : null : url;
}
