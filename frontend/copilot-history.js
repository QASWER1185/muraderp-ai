const historyText = text => text.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=\r\n]+/g, "[Attached Slip Image]");
// Readable text only: never restore executable approval cards or attachment bytes.
export function copilotHistoryKey(userId, context) {
  return userId && context?.organizationId && context?.branchId ? `muraderp.copilot.v2.history:${userId}:${context.organizationId}:${context.branchId}` : null;
}
export function loadCopilotHistory(storage, key) {
  if (!storage || !key) return null;
  try {
    const data = JSON.parse(storage.getItem(key));
    if (!data || !Array.isArray(data.messages)) return null;
    return { conversationId: typeof data.conversationId === 'string' ? data.conversationId : null,
      messages: data.messages.filter(row => ['user','assistant'].includes(row?.role) && typeof row.text === 'string').slice(-200).map(row => ({role:row.role,text:historyText(row.text)})) };
  } catch { return null; }
}
export function saveCopilotHistory(storage, key, value) {
  if (!storage || !key) return;
  try { storage.setItem(key, JSON.stringify({conversationId:value.conversationId,messages:value.messages.map(row=>({role:row.role,text:historyText(row.text)}))})); } catch { /* Server history still persists. */ }
}
