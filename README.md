# Pi Provider Factory

**Pi Provider Factory is an Oh My Pi (`omp`) provider extension for accessing Factory.ai Droid models, including Claude Opus, Claude Sonnet, GPT, Codex, Grok, GLM, Kimi, DeepSeek, MiniMax, and Nemotron through Factory's authenticated LLM gateway.**

Last updated: 2026-09-02

## What this package does

This package registers a custom `factory` provider for [Oh My Pi](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent). It mirrors Factory Droid's authentication, tool serialization, and multi-gateway request routing so `omp` can call Factory-hosted models with either Factory WorkOS browser OAuth or a Factory API key.

Key features:

- **Full Model Portfolio**: Access Claude Opus 5, GPT-5.6 Sol/Luna/Terra, Grok 4.6, GLM 5.3 / 5.3 Flash, Kimi K3, DeepSeek V4 Pro, and MiniMax M3 inside `omp`.
- **Droid-Compatible Multi-Account OAuth**: Device login at `https://auth.factory.ai/device`, explicit organization selection, WorkOS token refresh, session-sticky OMP account routing, and automatic sibling failover after account quota/auth failures.
- **Account-Isolated Routing**: Keeps each selected account's bearer, `X-Factory-Org-Id`, and validated regional endpoint together; credential endpoints must be HTTPS Factory API origins.
- **Tri-Gateway Wire Routing**: Accurately routes to Factory's Anthropic (`/api/llm/a`), OpenAI Responses (`/api/llm/o/v1/responses`), and Fireworks (`/api/llm/o/v1/chat/completions`) endpoints.
- **Native Tool Normalization & Wire Healing**: Converts tool calls and message history into Droid PascalCase primitives (`Read`, `Execute`, `Grep`, `Glob`, `LS`), and uses real-time stream markup healing to parse in-band reasoning and XML tool calls cleanly.
- **Reasoning & Adaptive Thinking**: Supports Anthropic adaptive thinking for Claude Opus/Fable 5, effort ladders (`minimal` to `max`/`xhigh`), and preserves reasoning history across multi-turn tool loops for Fireworks-hosted models (`interleaved` for DeepSeek, `preserved` for GLM/Kimi).
- **Real-Time Quota Tracking**: Query live Standard/Core billing limits and credit balances with `/usage`, with optional exhausted-account preflight failover.

---

## Supported models

The extension ships a curated static catalog synchronized with the authoritative Droid CLI binary and automatically checks Factory's model discovery endpoint for newly available models at session start.

### Claude and Anthropic-family models
*Routed through Factory's Anthropic-compatible gateway (`/api/llm/a/v1/messages`):*

- **Claude**: `claude-fable-5`, `claude-opus-5`, `claude-opus-5-fast`, `claude-opus-4-8`, `claude-opus-4-8-fast`, `claude-opus-4-7`, `claude-opus-4-7-fast`, `claude-opus-4-6`, `claude-opus-4-6-fast`, `claude-opus-4-5-20251101`, `claude-sonnet-5`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001`, `atlas-07-21`, `aster-07-15` (`x-api-provider: anthropic`)
- **MiniMax**: `minimax-m3`, `minimax-m2.7`, `minimax-m2.5` (`x-api-provider: fireworks`)

### GPT, Codex, and Grok models
*Routed through Factory's OpenAI Responses gateway (`/api/llm/o/v1/responses`):*

- **GPT**: `gpt-5.6-sol`, `gpt-5.6-sol-fast`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.5`, `gpt-5.5-pro`, `gpt-5.5-fast`, `gpt-5.4`, `gpt-5.4-fast`, `gpt-5.4-mini`, `gpt-5.4-mini-fast`, `gpt-5.2`, `gpt-5.1`, `gpt-5` (`x-api-provider: openai`)
- **Codex**: `gpt-5.3-codex`, `gpt-5.3-codex-fast`, `gpt-5.2-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-max`, `gpt-5-codex` (`x-api-provider: openai`)
- **Grok**: `grok-4.6`, `grok-4.5` (`x-api-provider: xai`)

### Factory Core and Open-Weight models
*Routed through Factory's OpenAI Chat Completions gateway (`/api/llm/o/v1/chat/completions`):*

- **Kimi**: `kimi-k3`, `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k2.5` (`x-api-provider: fireworks`)
- **GLM**: `glm-5.3`, `glm-5.3-flash`, `glm-5.2`, `glm-5.2-fast`, `glm-5.1`, `glm-5`, `glm-4.7`, `glm-4.6` (`x-api-provider: fireworks`)
- **DeepSeek**: `deepseek-v4-pro`, `deepseek-v4-flash-0731` (`x-api-provider: fireworks`)
- **Nemotron / Inkling**: `nemotron-3-ultra`, `inkling` (`x-api-provider: fireworks`)

---

## Installation & Management

### Install from GitHub

To install the extension into `omp`:

```zsh
omp install https://github.com/TapZe/pi-provider-factory.git
```

### Uninstall

To uninstall or remove the plugin from `omp`:

```zsh
omp plugin uninstall pi-provider-factory
```

### Local Development / Linking

If you are developing locally:

```zsh
# 1. Install dependencies
bun install

# 2. Link into omp
omp plugin link "$PWD"
```

Verify the provider is registered:

```zsh
omp models find factory
```

---

## Request routing & Protocol Details

Factory model requests are directed to Factory's LLM gateway (`https://api.factory.ai` or region-specific endpoints like `https://api.eu.factory.ai`).

| Model Family | Wire Endpoint | Upstream Provider Header | Special Flags & Compat |
| --- | --- | --- | --- |
| **Claude** | `POST /api/llm/a/v1/messages` | `x-api-provider: anthropic` | `anthropic-version: 2023-06-01`<br>`anthropic-beta: interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14`<br>Adaptive thinking (`type: "adaptive"`) |
| **MiniMax** | `POST /api/llm/a/v1/messages` | `x-api-provider: fireworks` | Served over Anthropic Messages protocol |
| **GPT / Codex / Grok** | `POST /api/llm/o/v1/responses` | `x-api-provider: openai` (`xai` for Grok) | `OpenAI-Platform: org-bHuLtG1fGmYk5YaOihAAXFBw`<br>PascalCase tools (`Read`, `Execute`, `Grep`, `Glob`, `LS`) |
| **Kimi / GLM / DeepSeek** | `POST /api/llm/o/v1/chat/completions` | `x-api-provider: fireworks` | `reasoning_history: "preserved"` (`"interleaved"` for DeepSeek)<br>Stream markup healing (`thinking` / `kimi` / `dsml`)<br>Assistant reasoning signature replay |

```text
/login factory
```

The extension opens Factory's Droid device login URL:

```text
https://auth.factory.ai/device
```

After successful login, the extension stores refreshable OAuth credentials through Oh My Pi's normal provider auth storage.

If an account belongs to multiple Factory organizations, login asks which organization to add. Run `/login factory` again to add another organization; OMP stores different organization IDs as separate Factory OAuth accounts and keeps each session sticky to its selected account.

OAuth login and refresh requests are cancellable and bounded. Region metadata returned by Factory is accepted only when it resolves to an HTTPS `api[.<region>].factory.ai` origin. Use the explicit `FACTORY_API_BASE` override for intentional local or custom proxies.

### Factory API key

You can use a Factory API key by setting `FACTORY_API_KEY`:

```zsh
export FACTORY_API_KEY="fk-..."
```

When `FACTORY_API_KEY` is present, Oh My Pi treats it as the provider API key source. If you want to test OAuth instead, unset it first:

```zsh
unset FACTORY_API_KEY
```

Billing-limit reporting (`/usage`) is OAuth-only; API-key sessions never query it (see below).

## Usage reporting

Native `/usage` reports Factory account quotas for OAuth accounts. The extension queries `GET {apiEndpoint}/api/billing/limits` with the OAuth bearer and Droid-compatible headers, and renders:

- Standard 5-hour, weekly, and monthly windows
- Droid Core 5-hour, weekly, and monthly windows — inactive pools are shown explicitly as having no active window instead of looking like available quota
- Extra Usage balance as a remaining dollar amount, with eligibility and overage-preference notes

Queries use the same base-URL precedence as model routing (`FACTORY_API_BASE`, then the OAuth credential's region-specific `apiEndpoint`, then `https://api.factory.ai`) and reuse Oh My Pi's normal usage cache window and history recording.

The billing-limits endpoint is queried with OAuth credentials only. Factory `fk-...` API keys are intentionally never sent to it (a live probe returns `401`), so with only `FACTORY_API_KEY` configured, model calls still work but `/usage` shows no Factory billing limits by design.

Native Factory `/usage` integration requires OMP 17.4.1 or newer; this package declares that minimum peer version.

### Optional exhausted-account preflight

Set `FACTORY_QUOTA_PREFLIGHT=1` (or `true`) to check the selected OAuth account's cached Factory billing limits before starting a model request. If the relevant quota tier is explicitly exhausted, the plugin returns a replay-safe usage-limit result before any model content is emitted, allowing OMP's existing retry resolver to select a sibling Factory account.

- Standard quota: Claude, GPT/Codex, and Grok.
- Droid Core quota: GLM, Kimi, DeepSeek, MiniMax, Nemotron, and Inkling.
- Reports are cached for 30 seconds per normalized endpoint and organization, with concurrent checks sharing one fetch.
- Warning, unknown, malformed, timed-out, and unavailable usage data fail open and send the real model request.
- Accounts with Factory Extra Usage enabled are not preflight-blocked.
- Raw `FACTORY_API_KEY` requests are never preflighted because Factory's billing endpoint is OAuth-only.

This is a plugin-only exhausted-account failover, not proactive balancing: it does not rank healthy siblings by remaining percentage. The option is disabled by default, so normal request count and routing remain unchanged unless explicitly enabled.

### Organization and region handling

Factory's gateway requires an organization-scoped bearer token or an organization header. This extension derives the Factory organization ID from OAuth JWT claims or `/api/cli/whoami`, and it can recover WorkOS organization scope during refresh.

OAuth login and refresh support:

- WorkOS device authorization
- Organization-scoped token refresh
- Factory org ID extraction for `X-Factory-Org-Id`
- Region discovery via `/api/cli/whoami`
- Region-to-base-URL mapping, including `eu` → `https://api.eu.factory.ai`

## Environment variables

| Variable | Purpose |
| --- | --- |
| `FACTORY_API_KEY` | Optional Factory `fk-...` API key. Takes precedence over OAuth in normal provider resolution. |
| `FACTORY_API_BASE` | Overrides the Factory API base URL for every request, including OAuth-discovered endpoints. |
| `FACTORY_ORG_ID` | Optional explicit Factory organization ID header value. |
| `FACTORY_ORGANIZATION_ID` | Alias for `FACTORY_ORG_ID`. |
| `FACTORY_QUOTA_PREFLIGHT` | Optional `1`/`true`: skip OAuth accounts whose relevant Standard/Core quota is explicitly exhausted. Disabled by default. |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Optional override for `X-Factory-Client`; defaults to `cli`. |

## Usage examples

> **Note:** `omp -p --model factory/<id>` does not currently work from a cold start: omp resolves `--model` before extension-provider catalogs hydrate, so factory models are only selectable in interactive mode. Tracked upstream in [oh-my-pi#4216](https://github.com/can1357/oh-my-pi/issues/4216).

Run a Factory model interactively:

```zsh
omp
```

Then select a model with the picker and prompt normally:

```text
/model
# filter for e.g. factory/claude-sonnet-5, Enter to select
reply with the single word ok
```

Any factory model works the same way, e.g. `factory/claude-opus-4-8`, `factory/gpt-5.5`, or `factory/glm-5.2`.

### Droid System Prompt Attestation & Tool Normalization

Factory's gateway enforces two critical invariants:

1. **System Prompt Attestation**: Factory requires Droid system instructions as a prefix on incoming turns to validate client legitimacy and enforce active tool usage for reasoning models. The extension prepends `FACTORY_DROID_SYSTEM_PROMPT` while preserving Oh My Pi's system prompts.
2. **Tool Name Normalization**: Models are prompted and trained on Droid's canonical PascalCase tool primitives (`Read`, `Execute`, `Grep`, `Glob`, `LS`, `Edit`, `Create`, `AskUser`, `TodoWrite`). The router maps all OMP tool names and message history references to these primitives so models invoke tools seamlessly across multi-turn sessions.
3. **Stream Markup Healing**: Open models on Fireworks (GLM-5.3, Kimi K3, DeepSeek) that emit in-band `<tool_call>` XML or raw reasoning delimiters in the text stream are automatically parsed and sanitized in real-time by OMP's `StreamMarkupHealing` layer.

### API-key and OAuth credential formats

The router accepts either:

1. A raw bearer/API key string.
2. OMP's request-time OAuth envelope containing `token`, `orgId`, and `apiEndpoint`.

The envelope is generated from the selected stored account for each request. It never contains the refresh token. Raw OAuth JWTs are decoded locally only to derive non-secret routing metadata such as Factory org ID. Tokens are not logged or printed by the extension.

## Troubleshooting

### `No API key found for factory`

Run:

```text
/login factory
```

Then leave the `fk-...` prompt blank for browser OAuth, or paste a Factory API key.

### Factory login opens the wrong page

The expected OAuth URL is Factory's Droid device URL:

```text
https://auth.factory.ai/device
```

If you see a generic WorkOS authorize URL, reinstall or relink the plugin and log in again:

```zsh
omp plugin uninstall pi-provider-factory
omp install https://github.com/TapZe/pi-provider-factory.git
omp
/logout factory
/login factory
```

### `403 Forbidden` from Factory

Most 403s are caused by one of these issues:

1. `FACTORY_API_KEY` is set and overriding OAuth credentials.
2. The OAuth token is not organization-scoped.
3. The request is missing `X-Factory-Org-Id`.
4. The wrong regional endpoint is being used.

If `/api/cli/whoami` works but LLM calls still return `403 {"detail":"Forbidden",...}`, the credential is valid but Factory's LLM gateway is refusing that model/org request. Check Factory model entitlement for the org shown by the plugin diagnostic, then unset local overrides and re-login.

Start with a clean OAuth run:

```zsh
unset FACTORY_API_KEY FACTORY_ORG_ID FACTORY_ORGANIZATION_ID FACTORY_API_BASE
omp
/logout factory
/login factory
/model factory/claude-opus-5
```

## FAQ

### What is Pi Provider Factory?

Pi Provider Factory is an Oh My Pi extension that adds a `factory` provider for Factory.ai's Droid LLM gateway. It lets `omp` use Factory-routed Claude, GPT, Codex, and open-weight coding models with Droid-compatible OAuth, request headers, and tool normalization.

### Does this call Anthropic or OpenAI directly?

No. Requests go to Factory's gateway first. Factory then routes each request to the appropriate upstream family based on model ID and the `x-api-provider` header.

### Which endpoint does `factory/claude-opus-5` use?

`factory/claude-opus-5` uses Factory's Anthropic-compatible endpoint: `${apiEndpoint}/api/llm/a/v1/messages` with adaptive thinking enabled (`x-api-provider: anthropic`).

### Which endpoint does `factory/gpt-5.6-sol` use?

`factory/gpt-5.6-sol` uses Factory's OpenAI Responses-compatible endpoint: `${apiEndpoint}/api/llm/o/v1/responses` with `OpenAI-Platform` headers and PascalCase tool definitions.

### Which endpoint do Factory Core models use?

Factory Core chat-completions models — `glm-5.3`, `glm-5.3-flash`, `kimi-k3`, `deepseek-v4-pro`, `nemotron-3-ultra`, and `inkling` — use `${apiEndpoint}/api/llm/o/v1/chat/completions` with `reasoning_history` (`"interleaved"` for DeepSeek, `"preserved"` for GLM/Kimi) and `x-api-provider: fireworks`. MiniMax models (`minimax-m3`, `minimax-m2.7`, `minimax-m2.5`) are served through the Anthropic-compatible endpoint `${apiEndpoint}/api/llm/a/v1/messages` with `x-api-provider: fireworks`. Grok models (`grok-4.6`, `grok-4.5`) are served through the OpenAI Responses endpoint `${apiEndpoint}/api/llm/o/v1/responses` with `x-api-provider: xai`.

### What `x-api-provider` value does each request send?

Factory's gateway routes by the `x-api-provider` request header, which names the upstream:

- `anthropic` — Claude models (Anthropic endpoint)
- `openai` — GPT and Codex models (OpenAI Responses endpoint)
- `xai` — Grok models (OpenAI Responses endpoint)
- `fireworks` — Factory Core models (GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling)

## Development

Run the TypeScript compiler:

```zsh
bunx tsc --noEmit
```

Run a live smoke test after authenticating — use interactive mode ([oh-my-pi#4216](https://github.com/can1357/oh-my-pi/issues/4216) blocks `-p --model factory/...`):

```zsh
unset FACTORY_API_KEY FACTORY_ORG_ID FACTORY_ORGANIZATION_ID FACTORY_API_BASE
omp
# /model → select factory/claude-opus-4-8 → prompt: reply with the single word ok
```

Expected output:

```text
ok
```
