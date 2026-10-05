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
Frontend JavaScript receives no provider or database secrets. Groq uses the
existing text model and dedicated vision/STT adapters; configurable model names
are `AI_MODEL`, `AI_VISION_MODEL`, `AI_SPEECH_MODEL`.
Groq vision uses Chat Completions JSON mode followed by local schema validation.
PDF pages use the same vision transport. STT uses the transcription endpoint.

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

Production acceptance uses synthetic media and scoped read/conversational draft
requests. Do not execute financial transactions or destructive cleanup for smoke tests.
The release is verified only after actual deployment, traffic/readiness checks,
frontend checks, real-provider requests and post-deployment error-log inspection.
