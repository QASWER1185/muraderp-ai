export async function boundedFetch(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...options, signal: controller.signal }); }
  catch (error) {
    if (controller.signal.aborted) throw new Error("The request timed out. Check your connection and try again.");
    throw error;
  } finally { clearTimeout(timer); }
}
