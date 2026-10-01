# OMP Provider Factory Droid

**`omp-provider-factory-droid` is a production-ready [Oh My Pi (`omp`)](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent) provider extension for accessing Factory.ai Droid models—including Claude Opus 5, Gemini 3.8 / 3.1 Pro, GPT-6 Astra, Grok 4.6, GLM 5.3, Kimi K3, and DeepSeek V4—through Factory's authenticated LLM Quad-Gateway.**

> [!NOTE]
> **Actively Maintained Fork (`v1.4.1`)**: Maintained continuation of [`tjboudreaux/pi-provider-factory`](https://github.com/tjboudreaux/pi-provider-factory) by [Muhammad Nabil Muyassar Rahman (@TapZe)](https://github.com/TapZe). Droid v0.226.1 contract parity, native Google Gemini Quad-Gateway routing, bidirectional Droid CLI Keychain sync (`auth.v2.loginkeychain`), session auto-recovery, multi-account quota preflight failover, tool-call stream healing, and 403/400 diagnostics.

---

## Key Features

- **Full Model Portfolio**: Access Claude Opus 5 / Fable 5, Gemini 3.8 / 3.7 / 3.6 Flash, Gemini 3.1 Pro, GPT-6 Astra, GPT-5.6 Sol/Luna/Terra, Grok 4.6, GLM 5.3 / 5.3 Flash, Kimi K3, DeepSeek V4 Flash / V4 Pro, Qwen 3.8 Max, Mistral Medium 3.5, and MiniMax M3 directly inside `omp`.
- **Quad-Gateway Wire Routing**: Routes each model family to its dedicated Factory gateway endpoint with W3C `traceparent` telemetry injection:
  - Anthropic Messages (`/api/llm/a`)
  - OpenAI Responses (`/api/llm/o/v1/responses`)
  - Google Generative AI (`/api/llm/g/v1/generate`)
  - Fireworks & Upstream Completions (`/api/llm/o/v1/chat/completions`)
- **Droid-Compatible OAuth, Bidirectional Keychain Sync & Auto-Recovery**: Run `/login factory` to auto-import an existing Droid CLI login session (`~/.factory/`) or initiate device authorization at `https://auth.factory.ai/device`. Rotated credentials synchronize back to macOS Keychain (`auth.v2.loginkeychain`) and Linux file storage (`auth.v2.file`) with AES-256-GCM, and stale sessions recover from local Droid CLI storage.
- **Account-Isolated Sibling Failover**: Manages credentials with atomic account isolation (`token`, `X-Factory-Org-Id`, `apiEndpoint`). Enables automated sibling account retry if an account runs out of quota or encounters an authentication error.
- **Real-Time Quota Tracking & Preflight**: Query live Standard and Core usage limits and Extra Usage balances via `/usage`. Optionally enable `FACTORY_QUOTA_PREFLIGHT=1` to failover to sibling accounts before emitting model requests when a tier is exhausted.
- **Defensive Tool Normalization & Stream Healing**: Automatically repairs in-band XML tool calls (`<tool_call>`) from open-weight models via Hermes markup healing, and unwraps malformed embedded JSON tool names into structured harness calls.
- **Dynamic Model Discovery**: Ships an audited static catalog and automatically queries Factory's live model documentation at session start with real-time OpenRouter pricing synchronization.
- **Intelligent 403 Diagnostics**: Automatically enriches gateway 403 errors with redacted credential contexts, endpoint origins, organization IDs, and actionable remediation instructions.

---

## Supported Models

Curated static catalog synchronized with the Droid CLI 0.230.0 model registry and Factory's published model list, augmented by dynamic discovery. Feature-gated models require access on the selected Factory organization.

### 1. Claude and Anthropic Family
*Wire Endpoint: `POST /api/llm/a/v1/messages`*
- **Claude**: `claude-fable-5.1`, `claude-fable-5`, `claude-opus-5-5`, `claude-opus-5-5-fast`, `claude-opus-5`, `claude-opus-5-fast`, `claude-opus-4-8`, `claude-opus-4-8-fast`, `claude-opus-4-7`, `claude-opus-4-7-fast`, `claude-opus-4-6`, `claude-opus-4-6-fast`, `claude-opus-4-5-20251101`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `atlas-07-21`, `aster-07-15` (`x-api-provider: anthropic`)
- **MiniMax**: `minimax-m3`, `minimax-m2.7`, `minimax-m2.5` (`x-api-provider: fireworks`)

### 2. Google Gemini Family
*Wire Endpoint: `POST /api/llm/g/v1/generate`*
- **Gemini & Garnet**: `gemini-3.8-flash`, `gemini-3.7-flash`, `gemini-3.6-flash`, `gemini-3.5-flash`, `gemini-3-flash-preview`, `gemini-3.1-pro-preview`, `gemini-3-pro-preview`, `garnet-07-15` (`x-api-provider: google`)

### 3. GPT, Codex, and Grok Family
*Wire Endpoint: `POST /api/llm/o/v1/responses`*
- **GPT**: `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-fast`, `gpt-5.4`, `gpt-5.4-fast`, `gpt-5.4-mini`, `gpt-5.4-mini-fast`, `gpt-5.2`, `gpt-5.1`, `gpt-5` (`x-api-provider: openai`)
- **Codex**: `gpt-5.3-codex`, `gpt-5.3-codex-fast`, `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5-codex` (`x-api-provider: openai`)
- **Grok**: `grok-4.7`, `grok-4.6`, `grok-4.5` (`x-api-provider: xai`)

### 4. Factory Core & Open Models
*Wire Endpoint: `POST /api/llm/o/v1/chat/completions`*
- **GLM**: `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.2-fast`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6` (`x-api-provider: fireworks`)
- **Kimi**: `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5` (`x-api-provider: fireworks`)
- **DeepSeek**: `deepseek-v4.1-flash`, `deepseek-v4-flash-0731`, `deepseek-v4-pro` (`x-api-provider: fireworks`); V4.1 Flash accepts images, while the deprecated V4 variants are text-only.
- **Qwen**: `qwen3.8-max` (`x-api-provider: fireworks`)
- **Nemotron / Inkling**: `nemotron-3-ultra`, `inkling` (`x-api-provider: fireworks`)
- **Mistral**: `mistral-medium-3.5` (`x-api-provider: mistral`)

### 5. Dynamic Discovery & Live Pricing
Beyond the curated static catalog, the plugin automatically checks Factory's live model documentation (`https://docs.factory.ai/models.md`) and queries OpenRouter for live per-million token pricing at session start (throttled to every 15 minutes). Newly launched models become immediately discoverable without waiting for OMP's 24-hour cache TTL.

---

## Model Selection & Reasoning Controls

### Selecting Models
In Oh My Pi, select any Factory model via the `/model` picker or type the full model identifier directly:

```text
/model factory/claude-opus-5
/model factory/gemini-3.8-flash
/model factory/gpt-6-astra
/model factory/glm-5.3-flash
```

To set a Factory model as your default in `~/.omp/config.json`:

```json
{
  "defaultModel": "factory/claude-opus-5"
}
```

### Thinking & Reasoning Efforts
The plugin supports Oh My Pi's thinking effort levels (`minimal`, `low`, `medium`, `high`, `xhigh`, `max`):

- **Extra-High (`xhigh` / `max`)**: Supported on flagship reasoning models:
  - `gpt-6-astra` / `gpt-6-sol` / `gpt-6-luna`
  - `gpt-5.6-sol` / `gpt-5.6-terra` / `gpt-5.6-luna`
  - `claude-opus-5-5` / `claude-opus-5` / `claude-fable-5`
  - `glm-5.3` / `glm-5.3-flash`
  - `grok-4.7` / `grok-4.6`
  *(For models without extra-high effort support, `max` and `xhigh` automatically clamp to `high` upstream to prevent gateway rejection).*
- **Google Gemini Thinking**: Mapped to native level-based thinking (`low`, `medium`, `high`; `minimal` supported on Flash Preview / 3.5).
- **Claude Adaptive Thinking**: Claude models automatically infer Anthropic's adaptive thinking protocol (`type: "adaptive"`) with an allocated high-effort thinking budget of 24,576 tokens.
- **Fireworks History Preservation**: Preserves multi-turn reasoning content across tool calls (`reasoning_history: "interleaved"` for DeepSeek, `"preserved"` for GLM/Kimi).


## Installation

### From GitHub (Recommended)
Install the plugin directly into Oh My Pi:

```zsh
omp install https://github.com/TapZe/omp-provider-factory-droid.git
```

### Local Development / Linking
If developing locally:

```zsh
git clone https://github.com/TapZe/omp-provider-factory-droid.git
cd omp-provider-factory-droid
bun install
omp plugin link "$PWD"
```

### Verify Installation
Check that the plugin is active:

```zsh
omp plugin list
```

### Uninstall / Remove
To cleanly remove or unlink the plugin from Oh My Pi:

```zsh
omp plugin uninstall omp-provider-factory-droid
```

---

## Authentication

### 1. Droid CLI Session Auto-Import & Browser OAuth
Inside Oh My Pi, run:

```text
/login factory
```

1. **Native Droid CLI Auto-Import**: The extension automatically inspects your local Droid CLI environment (`~/.factory/auth.v2.loginkeychain` or `~/.factory/auth.v2.file`). If you are already logged in via `droid`, the plugin decrypts and imports your credentials directly into Oh My Pi with **no browser interaction required**.
2. **Device Code Fallback**: If no local Droid CLI session exists or if it has expired, the plugin automatically falls back to generating an interactive device authorization code:
   ```text
   https://auth.factory.ai/device
   ```
3. Confirm the code in your browser and authorize the application.
4. If your account belongs to multiple Factory organizations, the CLI prompts you to select which organization to bind to this profile.
5. **Zero Re-Login Token Refresh**: Tokens are automatically refreshed in the background before expiry via WorkOS OAuth token refresh. Parameter filtering guarantees that internal WorkOS organizational scoping does not trigger `organization_not_found` errors, ensuring persistent session validity without requiring repeated manual logins.
6. To add another organization or account, simply run `/login factory` again. OMP manages multiple accounts and enables automatic failover.

### 2. Factory API Key (Headless / CI Environments)
If running in headless environments where browser login is unavailable:

```zsh
export FACTORY_API_KEY="fk-..."
```

*(Note: Live billing limit tracking via `/usage` requires an OAuth account; API keys bypass `/usage` by design).*

---

## Request Routing & Quad-Gateway Protocols

All requests route through Factory's LLM gateway (`https://api.factory.ai` or regional endpoints like `https://api.eu.factory.ai`). Every outbound gateway request includes a valid W3C distributed trace header (`traceparent: 00-${traceId}-${spanId}-01`) alongside `X-Client-Version` matching Droid v0.226.1.

| Family | Wire Gateway URL | Upstream Provider Header | Protocol Details |
| :--- | :--- | :--- | :--- |
| **Claude** | `POST /api/llm/a/v1/messages` | `x-api-provider: anthropic` | `anthropic-version: 2023-06-01`<br>`anthropic-beta: interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`<br>`x-provider-routing-source: registry_default`<br>Native adaptive thinking |
| **Google Gemini & Garnet** | `POST /api/llm/g/v1/generate` | `x-api-provider: google` | `x-provider-routing-source: registry_default`<br>Factory Google fetch adapter with top-level `model` injection<br>Thinking Level (`low`, `medium`, `high`) |
| **GPT / Codex / Grok** | `POST /api/llm/o/v1/responses` | `x-api-provider: openai`<br>(`xai` for Grok) | `OpenAI-Platform: org-bHuLtG1fGmYk5YaOihAAXFBw`<br>`x-provider-routing-source: registry_default`<br>OpenAI Responses stream |
| **Factory Core Models** | `POST /api/llm/o/v1/chat/completions` | `x-api-provider: fireworks`<br>(`mistral` for Mistral) | `reasoning_history: "preserved"` (`"interleaved"` for DeepSeek)<br>`x-provider-routing-source: registry_default`<br>Hermes stream markup healing |

---

## Tool Execution & Normalization

All tool declarations, parameter schemas, and tool execution routines are provided directly by the Oh My Pi harness (`read`, `write`, `edit`, `bash`, etc.). The plugin ensures frictionless execution between OMP and Factory:

1. **System Prompt Attestation**: Factory's gateway requires Droid system instructions to validate client legitimacy and enforce active tool usage for reasoning models. The extension automatically prepends `FACTORY_DROID_SYSTEM_PROMPT` while preserving your custom instructions.
2. **Stream Markup Healing**: Open-weight models (GLM, Kimi, DeepSeek) that occasionally output tool calls as in-band XML (`<tool_call>...`) are repaired on the fly into structured tool events via Hermes healing.
3. **Embedded JSON Unwrapping**: If an open model mistakenly outputs a JSON payload inside the tool name field (e.g. `name: '{"name": "read", "arguments": ...}'`), the normalizer extracts the real tool name and arguments so OMP executes the tool call directly.

---

## Quota Tracking & Account Rotation

### Real-Time Billing Limits (`/usage`)
Check remaining usage quotas at any time:

```text
/usage
```

Displays:
- **Standard Quota**: 5-hour, weekly, and monthly limits (Claude, GPT, Grok, Gemini).
- **Droid Core Quota**: 5-hour, weekly, and monthly limits (GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling).
- **Extra Usage Balance**: Remaining balance in USD, overage preferences, and billing rate notes.

### Optional Quota Preflight Gate
To automatically skip exhausted accounts and rotate to a healthy sibling account before calling the model:

```zsh
export FACTORY_QUOTA_PREFLIGHT=1
```

- **In-Memory Cache & Shared In-Flight**: Quotas are cached for 30 seconds per endpoint/org; concurrent requests coalesce into a single in-flight billing check.
- **Strict Tier Isolation**: Core quota exhaustion will never block Standard models, and Standard exhaustion will never block Core models.
- **Extra Usage Exemption**: Accounts with Factory Extra Usage (pay-as-you-go overages) enabled are never blocked.
- **Automatic Sibling Rotation**: If an account's quota tier is exhausted, the gate emits a synthetic `usage_limit_reached` event with a reset countdown. Oh My Pi catches this and automatically retries with your next authenticated Factory sibling account without interrupting your workflow.
- **Fail-Open Resilience**: Billing limit timeouts, network hiccups, and API-key sessions fail open so model calls are never blocked unnecessarily.


---

## Environment Variables

| Variable | Description |
| :--- | :--- |
| `FACTORY_API_KEY` | Optional Factory `fk-...` API key. Bypasses OAuth when set. |
| `FACTORY_API_BASE` | Overrides the Factory API base origin (e.g. `https://custom-proxy.internal`). |
| `FACTORY_ORG_ID` | Explicitly overrides `X-Factory-Org-Id` header (or alias `FACTORY_ORGANIZATION_ID`). |
| `FACTORY_QUOTA_PREFLIGHT` | Set `1` or `true` to enable automatic account failover on exhausted quotas. Default: disabled (`0`). |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Overrides `X-Factory-Client` header. Default: `cli`. |

---

## Intelligent Diagnostics & Troubleshooting

### `403 Forbidden` Gateway Errors
If Factory returns a 403 Forbidden error, the plugin automatically inspects and enriches the diagnostic stream:
- **Displays**: Model ID, wire gateway URL, endpoint origin, credential source, and organization ID.
- **Redacts**: All access tokens, bearer secrets, and organization IDs for safe logging.
- **Common causes**:
  1. `FACTORY_API_KEY` is set in your shell environment and overriding your OAuth session. Unset it: `unset FACTORY_API_KEY`.
  2. The account lacks an active subscription or entitlement for that specific model family.
  3. The account's selected organization changed. Re-authenticate via `/logout factory` and `/login factory`.

### Changing or Switching Accounts
To switch organizations or refresh an expired session:

```text
/logout factory
/login factory
```

---

## Credits & Attribution

This project is an actively maintained continuation of the initial [`pi-provider-factory`](https://github.com/tjboudreaux/pi-provider-factory) extension created by [Travis Boudreaux](https://github.com/tjboudreaux).

Due to upstream inactivity, this hard fork is maintained and expanded by [Muhammad Nabil Muyassar Rahman (@TapZe)](https://github.com/TapZe) with ongoing Droid parity synchronization, Google Gemini Quad-Gateway routing, quota-aware failover, dynamic discovery, and production hardening.

---

## License

[MIT License](LICENSE) — Copyright (c) 2026 Travis Boudreaux & Muhammad Nabil Muyassar Rahman (TapZe).
