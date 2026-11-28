export async function probeSyntheticClipboard({ clipboard, ClipboardItem }) {
  const text = "Life-Atlas-Synthetic-Clipboard-Probe-48";
  const format = 'electron application/osclipboard;format="ExcludeClipboardContentFromMonitorProcessing"';
  let ownershipLost = false;
  let phase = "write-marker";
  const ensureOwned = async (nextPhase) => {
    phase = nextPhase;
    if (ownershipLost) throw new Error("E_CLIPBOARD_PROBE_OWNERSHIP");
    if (await clipboard.readText() !== text) {
      ownershipLost = true;
      throw new Error("E_CLIPBOARD_PROBE_OWNERSHIP");
    }
  };
  const inspect = async () => {
    await ensureOwned("before-items");
    phase = "read-items";
    const entries = await clipboard.read();
    await ensureOwned("after-items");
    const types = [...new Set(entries.flatMap((entry) => entry.types))];
    const entry = entries.find((value) => value.types.includes(format));
    let rawFourZeroBytes = false;
    if (entry) {
      await ensureOwned("before-payload");
      phase = "get-payload";
      const payload = await entry.getType(format);
      await ensureOwned("after-payload");
      phase = "read-payload";
      const buffer = await payload.arrayBuffer();
      await ensureOwned("after-payload-bytes");
      const bytes = new Uint8Array(buffer);
      rawFourZeroBytes = bytes.length === 4 && bytes.every((value) => value === 0);
    }
    await ensureOwned("after-inspection");
    return { formats: types, textPreserved: true, rawFourZeroBytes };
  };
  try {
    await clipboard.writeText(text);
    await ensureOwned("after-marker-write");
    const before = await inspect();
    let formatWriteError = null;
    await ensureOwned("before-format-write");
    try {
      const item = new ClipboardItem({ "text/plain": text, [format]: new Blob([new Uint8Array(4)]) });
      await ensureOwned("after-item-created");
      phase = "write-format";
      await clipboard.write([item]);
    } catch (error) {
      if (ownershipLost) throw error;
      formatWriteError = error?.name === "NotSupportedError" ? "NOT_SUPPORTED" : "E_IO";
    }
    await ensureOwned("after-format-write");
    const after = await inspect();
    const fallback = await inspect();
    await ensureOwned("before-clear");
    phase = "clear-marker";
    await clipboard.clear();
    return { before, after, fallback, formatWriteError, excluded: after.textPreserved && after.formats.includes(format) && after.rawFourZeroBytes };
  } catch {
    throw new Error(`E_CLIPBOARD_PROBE_${ownershipLost ? "OWNERSHIP" : "IO"}:${phase}`);
  }
}
