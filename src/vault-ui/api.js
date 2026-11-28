export async function invokeVault(method, args) {
  const result = await window.lifeAtlasVault[method](args);
  if (!result.ok) {
    const error = new Error(result.error.message);
    Object.assign(error, result.error);
    throw error;
  }
  return result.value;
}
