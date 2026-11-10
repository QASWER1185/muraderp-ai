import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env.js";
import { ApiError } from "../errors/api-error.js";
const COOKIE_NAME = "muraderp_session";
// A secure, persistent business session survives reloads and an overnight pause.
// Membership and branch permissions are still checked on every ERP operation.
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
// Development sessions remain authenticated and signed. This is not an internal
// service bearer token, and restarting requires a new Supabase session exchange.
const LOCAL_SIGNING_SECRET = randomBytes(32);
function signingSecret() {
    if (env.INTERNAL_API_TOKEN)
        return env.INTERNAL_API_TOKEN;
    if (env.NODE_ENV === "test" || env.NODE_ENV === "development")
        return LOCAL_SIGNING_SECRET;
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Browser session signing is not configured. Contact your administrator.");
}
function sign(value) { return createHmac("sha256", signingSecret()).update(value).digest("base64url"); }
function encode(payload) { const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url"); return `${body}.${sign(body)}`; }
function decode(value) {
    if (!value)
        return null;
    const [body, signature] = value.split(".", 2);
    if (!body || !signature)
        return null;
    const expected = sign(body);
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer))
        return null;
    try {
        const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
        if (!payload.userId || !Number.isInteger(payload.exp) || payload.exp <= Math.floor(Date.now() / 1000))
            return null;
        return payload;
    }
    catch {
        return null;
    }
}
function cookieValue(request) {
    const header = request.header("cookie");
    if (!header)
        return undefined;
    for (const part of header.split(";")) {
        const [name, ...rest] = part.trim().split("=");
        if (name === COOKIE_NAME)
            return rest.join("=");
    }
    return undefined;
}
export function issueBrowserSession(userId, response) {
    const payload = { userId, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
    response.cookie(COOKIE_NAME, encode(payload), { httpOnly: true, secure: env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: SESSION_TTL_SECONDS * 1000 });
}
export function browserSessionHandler(required = true) {
    return (request, response, next) => {
        if (request.apiKeyAuth === true) {
            const userId = request.header("X-Actor-User-Id")?.trim();
            if (userId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
                request.browserPrincipal = { userId };
                next();
                return;
            }
            response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid X-Actor-User-Id is required with API-key authentication" } });
            return;
        }
        const session = decode(cookieValue(request));
        if (!session) {
            if (required)
                response.status(401).json({ error: { code: "UNAUTHORIZED", message: "A valid browser session is required" } });
            else
                next();
            return;
        }
        request.browserPrincipal = { userId: session.userId };
        next();
    };
}
export async function bootstrapBrowserSession(accessToken, response) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY)
        throw new ApiError(503, "ERP_NOT_CONFIGURED", "The ERP authentication backend is not configured. Your password has not been rejected.");
    const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data.user)
        throw new ApiError(401, "UNAUTHORIZED", "Invalid or expired Supabase session");
    const userId = data.user.id;
    issueBrowserSession(userId, response);
    return { userId };
}
export function clearBrowserSession(response) { response.clearCookie(COOKIE_NAME, { httpOnly: true, secure: env.NODE_ENV === "production", sameSite: "lax", path: "/" }); }
//# sourceMappingURL=browser-session.js.map