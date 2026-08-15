# AI Assistant module

The assistant is an orchestration boundary, not a database layer.

- Intent resolution is replaceable.
- Authorization is mandatory before gateway execution.
- Reads delegate to existing ERP/reporting services.
- Mutations only create drafts and always require confirmation.
- Organization and user context are mandatory.
- Ambiguous input is clarified rather than guessed.
