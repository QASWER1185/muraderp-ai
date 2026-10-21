# Phase 22 Provider Boundaries

Voice and image providers are adapters only. Provider output is untrusted input and must enter the same normalized AI review pipeline as text. Provider keys must remain server-side. No provider adapter may execute ERP mutations or bypass confirmation, authorization, pricing resolution, idempotency, or audit controls.
