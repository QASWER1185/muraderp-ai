# Phase 22 Acceptance Contract

A request such as `50 Popular 25mm pipes, rate 120` or `50 Popular 25mm pipes using the Popular Rate List` must first become a reviewable AI action. The UI must preserve the user's explicit text and selected Rate List context. It must not calculate or invent a financial rate in the browser and it must not execute a transaction without the authoritative backend confirmation path.

Supported action types are estimate, invoice, purchase, return, and inventory adjustment. Supported input types are text, voice, and image. Voice/image providers are adapter boundaries and are not allowed to bypass the review/confirmation flow.
