function readPosition(geolocation) {
  if (!geolocation?.getCurrentPosition) return Promise.resolve({ status: "unavailable" });
  return new Promise(resolve => {
    function gotPosition(position) {
      const { latitude, longitude } = position?.coords || {};
      resolve(Number.isFinite(latitude) && Math.abs(latitude) <= 90 && Number.isFinite(longitude) && Math.abs(longitude) <= 180
        ? { status: "located", point: [latitude, longitude] }
        : { status: "unavailable" });
    }
    const failed = error => resolve({ status: error?.code === 1 ? "denied" : error?.code === 3 ? "timeout" : "unavailable" });
    try { geolocation.getCurrentPosition(gotPosition, failed, { maximumAge: 0, timeout: 12000, enableHighAccuracy: false }); }
    catch { resolve({ status: "unavailable" }); }
  });
}

export async function currentDeviceLocation(geolocation, permission) {
  if (!permission?.authorizeLocation) return readPosition(geolocation);
  if (!geolocation?.getCurrentPosition) return { status: "unavailable" };
  let token;
  try {
    const result = await permission.authorizeLocation();
    if (result.status !== "authorized" || !result.token) return { status: result.status === "denied" ? "denied" : "unavailable" };
    token = result.token;
    return await readPosition(geolocation);
  } catch { return { status: "unavailable" }; }
  finally {
    if (token) {
      try { await permission.releaseLocation?.(token); } catch {}
    }
  }
}
