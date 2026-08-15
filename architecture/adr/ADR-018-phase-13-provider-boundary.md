# ADR-018 — Provider Boundary for AI Assistant

## Status
Accepted — Phase 13

LLM, speech-to-text, OCR, and future model providers are adapters behind the assistant contracts. Provider responses cannot bypass authorization or call database repositories directly. This keeps the ERP domain deterministic and allows provider changes without changing financial controls.
