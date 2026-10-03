# Read-only Copilot agent (Phase 1)

`POST /api/v1/ai/copilot/agent` accepts a text `message` and optional signed `conversationToken`. It requires a browser session plus `X-Organization-Id` and `X-Branch-Id`. The response contains an `answer`, a new token, a trace ID, and a completion status. The existing review, draft, confirmation, execution, and verification endpoints are unchanged.

The model receives the six registered ERP functions through the Responses API. The registry validates arguments and independently checks user permission and branch access on every invocation. Product and party searches use the existing organization-scoped Copilot catalog; prices use the active rate-list repository and authoritative pricing service. Search results disclose when the catalog's 5,000-row bound is reached. No model-supplied tenant or record ID is trusted without an organization-scoped lookup.

The loop allows ten model iterations and twelve tool calls, with a 40-second deadline. Repeated calls, malformed calls, provider errors, and exhausted bounds return a safe fallback. Final answers require at least one successful tool result. Conversation state is a three-turn, 30-minute, HMAC-signed token bound to user, organization, and branch. The token carries short previous messages and answers, never authorization or tool authority.

Future image, PDF, and voice adapters can normalize their extracted text into the same agent request after the existing extraction boundary. Add ERP capabilities by registering a typed tool and its authorization and service dependencies. Write tools are deliberately absent from this Phase 1 registry; the existing action approval boundary remains the only execution path.
