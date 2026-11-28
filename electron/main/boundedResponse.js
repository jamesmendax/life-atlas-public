export async function boundedBytes(response, limit) {
  if (!response.body) throw new Error("没有返回数据");
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    if (Number(response.headers.get("content-length")) > limit) throw new Error("超出响应上限");
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error("超出响应上限");
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, size);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
