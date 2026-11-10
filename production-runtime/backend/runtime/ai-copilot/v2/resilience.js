import { setTimeout as delay } from 'node:timers/promises';
export function resolveRequestGeminiKey(value) {
    if (value == null)
        return undefined;
    if (typeof value !== 'string')
        throw new TypeError('Invalid Gemini key header');
    const key = value.trim();
    return !key || /^(null|undefined)$/i.test(key) ? undefined : key;
}
export async function withGeminiBackoff(operation, signal, wait = ms => delay(ms, undefined, signal ? { signal } : undefined)) {
    for (let retry = 0;; retry++) {
        signal?.throwIfAborted();
        try {
            return await operation();
        }
        catch (error) {
            const e = error;
            if (signal?.aborted || retry >= 3 || !(e.status === 429 || e.status === 503 || e.status === 'UNAVAILABLE' || e.status === 'RESOURCE_EXHAUSTED' || e.error?.status === 'RESOURCE_EXHAUSTED'))
                throw error;
            await wait(2000 * 2 ** retry);
        }
    }
}
export function stripHistoricalMedia(messages) {
    return messages.map(({ role, content, visualParts }) => ({ role, content: content.replace(/data:[^;\s]+;base64,[A-Za-z0-9+/=\r\n]+/g, '[Attached Slip Image]') + (visualParts?.length ? '\n[Attached Slip Image/PDF]' : '') }));
}
//# sourceMappingURL=resilience.js.map