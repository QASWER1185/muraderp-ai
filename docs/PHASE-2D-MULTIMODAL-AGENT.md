# Phase 2D: multimodal business Agent

The existing Unified Stateful Agent accepts text and validated image, camera,
PDF and voice input. Media enters through the existing AI input abstraction;
extraction and transcription only propose wording. The Agent resolves entities
through the indexed ERP services and obtains fresh authoritative business data.
No extraction adapter has ERP write access.

## Runtime flow

- Browser media requests use `POST /api/v1/ai/copilot/agent/input`, the browser
  session and organization/branch headers. Internal bearer credentials do not
  authorize this endpoint.
- Scope and any signed conversation are checked before provider work. A new
  input invalidates transient preparation while preserving existing draft choices.
- Image/PDF extraction proposes names, quantities, units and discounts. Visible
  prices/totals are shown as observations and excluded from the Agent request.
- Weak confidence, warnings, missing quantity/unit, or no lines require an
  editable review before the same signed conversation continues.
- Voice invokes STT once, then passes the transcript to the same Agent/tool loop.
  Urdu, Roman Urdu and English remain supported by the existing model instructions.
- Structured ambiguous ERP candidates are signed into the conversation.
  Selection must match the offered kind/ID, current user, organization, branch
  and conversation. Ownership and permissions are rechecked on selection.
- Estimate/payment preparation remains separate from confirmation, domain
  execution and independent verification. No conversational tool posts accounting.

## Media and frontend limits

Attachments are bounded at 8 MiB. Supported types are JPEG, PNG, WebP, PDF,
WebM/MP4/MP3/WAV/Ogg audio. The backend checks content signatures, source/type,
real image decoding and a 16-megapixel image limit. WAV structure and non-empty
PCM payload are checked; other audio containers require recognized codec/payload
markers and successful provider transcription. Empty/no-speech output fails closed.
PDFs are parsed and rendered locally in memory, with a 3-page, 16-megapixel and
8-MiB rendered-image limit and a 15-second rendering deadline. Uploads are not
persisted by this input workflow or logged as request bodies.

The existing zero-build Copilot shows processing status, observed extraction,
completed ERP tools, interactive candidates, active draft rates/discounts/totals,
and separate Prepare and Confirm controls. Recorder MIME types are normalized;
recording stops at 60 seconds or the attachment-size limit. Streams are released
on errors, close and reset. Late responses cannot restore stale media or approval
controls after a reset. A workspace/user change invalidates acceptance.

## Provider and release configuration

Production keeps existing Cloud Run Secret Manager bindings for server credentials.
Frontend JavaScript receives no provider or database secrets. Business code depends
on the internal structured-extraction and tool-turn contracts in
`backend/src/ai/providers/contracts.ts`. The configuration factory selects isolated
transports; no adapter receives ERP services or executes tools. The existing
Unified Stateful Agent alone validates and invokes its registered tools.

`AI_PROVIDER` selects `openai`, `groq`, `gemini`, `anthropic`, or `compatible`.
`AI_API_KEY` supplies the selected server credential; named provider key variables
remain supported. Model names are `AI_MODEL`, `AI_VISION_MODEL`, and
`AI_SPEECH_MODEL`. Gemini, Anthropic and compatible providers require explicit
`AI_MODEL`; model availability and modality support are account-dependent.
Gemini uses native generateContent JSON schema, inline media/audio, and function
calling. Anthropic uses native Messages image/document and tool schemas.
Native tool IDs and opaque reasoning/thought signatures survive the adapter
round trip; they do not become signed business state.
OpenAI uses Responses with storage disabled. Compatible endpoints must implement
the Responses protocol and supported extraction/transcription endpoints;
`AI_BASE_URL` must be server-configured HTTPS without credentials, query or fragment.
Native Anthropic transcription is unsupported and fails explicitly. An operator
can configure `AI_SPEECH_PROVIDER` separately as OpenAI, Groq, Gemini or compatible,
with `AI_SPEECH_API_KEY`, `AI_SPEECH_MODEL` and, for compatible speech,
`AI_SPEECH_BASE_URL`. This is explicit routing, never automatic fallback.

The current production configuration remains Groq with its existing text model.
Groq vision uses Chat Completions JSON mode followed by local schema validation.
PDF pages use the same vision transport. STT uses the transcription endpoint.
No provider purchase, billing change, or automatic model switch is part of this release.

A provider HTTP 429 is a known provider/environment limitation. The Agent returns
`rate_limited`, preserves signed choices, clears transient preparation, and refreshes
an existing draft through scoped ERP reads when available. The browser retains
wording/media for retry. Extraction failures retain the original request in the
browser. No quota response constitutes successful AI completion or authorizes
execution. The current Groq 8,000 TPM limit is disclosed separately from engineering
gates; the release request explicitly permits deployment with that known limitation.

Part 3 migration `20261005110000_phase2c_business_reads.sql` is required for
ledger/vendor business reads. Deployment preserves prior revisions and their tags.
Use a no-traffic candidate first. Confirm the release commit, pushed pre-deployment
tag, clean tree, migration history, secure environment bindings and rollback
revision before promoting production traffic.

## Verification

Run backend/frontend full suites, typechecks and builds. Focused new tests are
`backend/test/multimodal-input.test.ts`,
`backend/src/routes/ai-copilot-multimodal.routes.test.ts` and
`frontend/copilot-multimodal.test.js`.
They cover actual image/PDF parsing, provider transports, media failures, Urdu
transcription wording, signed context, authoritative pricing, weak OCR,
existing-draft voice changes, preparation/confirmation separation, tenant rejection,
candidate selection, recording cleanup, retry and reset races.
Existing Parts 1–3 regression/database tests remain part of the full gate.
Provider tests in `backend/src/ai/providers/adapters.test.ts` exercise native wire
formats, strict output validation, configuration, speech capability boundaries,
quota failures and the unchanged ERP tool loop. They use controlled transports;
they do not claim live alternate-provider validation.

Production acceptance uses synthetic media and scoped read/conversational draft
requests. Do not execute financial transactions or destructive cleanup for smoke tests.
The release is verified only after actual deployment, traffic/readiness checks,
frontend checks, real-provider requests and post-deployment error-log inspection.
