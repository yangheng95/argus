# In-tree GitHub Copilot SDK adapter

GitHub Copilot does not publish a `@ai-sdk/copilot` integration. This package
is the openai-compatible variant we need to talk to Copilot's chat /
responses endpoints, kept in-tree because there is no upstream alternative.

Scope: Copilot provider only. Do not import from this directory for any
other provider — use `@ai-sdk/openai-compatible` instead.
