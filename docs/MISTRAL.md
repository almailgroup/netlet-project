# Mistral Search Refinement Reference

NetLet’s search refinement uses Mistral’s official Chat Completion endpoint: `POST https://api.mistral.ai/v1/chat/completions`. Requests authenticate with `Authorization: Bearer $MISTRAL_API_KEY`, send `model` and `messages`, and may use `response_format: {"type":"json_object"}` when the prompt explicitly requests JSON. The official documentation notes that the chat endpoint accepts a message list and that JSON mode requires an instruction to produce JSON. NetLet keeps the key server-side, asks for a short JSON search refinement only, and falls back to local catalog matching when refinement is unavailable.

Sources:

- https://docs.mistral.ai/api/endpoint/chat
- https://docs.mistral.ai/getting-started/quickstarts/developer/first-api-request
