# Factory Provider Robustness

This document describes the reliability and multi-account protections implemented by `pi-provider-factory`. All behavior lives in the plugin; no Oh My Pi source changes are required.

## Multi-account routing

Oh My Pi stores Factory OAuth logins as separate credentials under the `factory` provider. For every request, the plugin receives the account selected by OMP and keeps these values together:

- OAuth access token
- Factory organization ID
- Factory regional API endpoint

The request-time credential envelope is:

```json
{
  "token": "<access token>",
  "orgId": "<Factory organization ID>",
  "apiEndpoint": "https://api.factory.ai"
}
```

Refresh tokens are never included in this envelope. The `token` field also lets supported OMP versions identify the credential that failed and route a retry to another stored Factory account.

Account behavior:

- New sessions are distributed by OMP's credential selector.
- A session stays attached to its selected account while that account remains usable.
- A persistent `401` refreshes the current account once, then tries a sibling if the refreshed credential still fails.
- An account-specific `403` can move directly to another account.
- A recognized quota failure temporarily blocks the exhausted account and retries with a sibling.
- If every account is exhausted, OMP tries each account once and returns the final error without looping indefinitely.

These retry features require OMP 17.4.1 or newer. That version is now the plugin's minimum peer dependency.

## Factory organization selection

A Factory identity can belong to more than one organization. During `/login factory`:

1. An already organization-scoped token is used directly.
2. A single available organization is selected automatically.
3. Multiple organizations are displayed as a numbered prompt.
4. The selected organization is stored with the credential for future refreshes.

Run `/login factory` again to add another organization. Different organization IDs remain separate OMP credentials. A legacy credential with multiple possible organizations and no saved selection is rejected with re-login guidance instead of silently choosing the first organization.

Before a login or refresh is accepted, the plugin requires agreement between:

- the organization selected by the user or stored credential;
- the organization claim in the access token; and
- the organization returned by Factory's `/api/cli/whoami` endpoint.

A missing, mismatched, or rejected `whoami` response fails the login or refresh rather than creating an ambiguous credential.

## Endpoint safety

OAuth-discovered endpoints are validated before any bearer token is sent. A hosted endpoint must:

- use HTTPS;
- match `api.factory.ai` or `api.<region>.factory.ai` exactly;
- have no username, password, custom port, path prefix, query, or fragment.

This rejects lookalike hosts such as `api.factory.ai.evil.example` and prevents credential metadata from redirecting an OAuth bearer to an unrelated service.

`FACTORY_API_BASE` remains the explicit escape hatch for local development and trusted custom proxies. When set, it intentionally overrides OAuth-discovered endpoints.

## Optional exhausted-account preflight

Set:

```bash
export FACTORY_QUOTA_PREFLIGHT=1
```

The plugin then checks the selected OAuth account's Factory billing limits before starting a model request. Preflight is disabled by default, so normal routing performs no additional request unless the option is enabled.

Factory quotas are evaluated independently:

| Quota pool | Model families |
| --- | --- |
| Standard | Claude, GPT, Codex, Grok |
| Droid Core | GLM, Kimi, DeepSeek, MiniMax, Nemotron, Inkling |

Only an explicitly exhausted relevant pool blocks a request. For example, an exhausted Standard pool does not block Kimi or GLM, and an exhausted Core pool does not block Claude or GPT.

Preflight behavior:

- Results are cached for 30 seconds by normalized endpoint and organization ID.
- Concurrent checks for the same account share one upstream request.
- Cache keys never contain bearer tokens.
- Preflight requests time out after 2.5 seconds.
- Ordinary usage requests time out after 10 seconds.
- Warning, unknown, malformed, timed-out, and unavailable usage data fail open and allow the model request.
- Accounts with Factory Extra Usage enabled are not preflight-blocked.
- Raw `FACTORY_API_KEY` requests are not preflighted because Factory's billing endpoint is OAuth-only.

This feature skips accounts already known to be exhausted. It does not rank healthy accounts by remaining percentage; healthy-account balancing remains owned by OMP's credential selector.

## Usage reporting

The plugin registers a native Factory usage provider with OMP 17.4.1 or newer. `/usage` reports:

- Standard 5-hour, weekly, and monthly windows;
- Droid Core 5-hour, weekly, and monthly windows;
- Extra Usage balance and eligibility metadata.

Usage reports and quota preflight share the same parser and account-scoped snapshot cache, preventing the two paths from interpreting Factory's response differently.

## OAuth and discovery timeouts

OAuth device authorization, token polling, organization lookup, `whoami`, and refresh requests are cancellable and have a 30-second per-request limit. Device polling still respects the overall device-code expiration time.

OAuth response bodies are limited to 64 KiB. Errors include the HTTP status and a short allowlisted error code when available; raw upstream bodies and token values are not copied into diagnostics.

Dynamic Factory model documentation requests time out after 10 seconds. Optional OpenRouter pricing remains independently bounded at 2.5 seconds. A Factory documentation failure remains an error so OMP can retain its last-known-good dynamic catalog.

## Diagnostics

Factory gateway diagnostics include enough routing context to identify configuration problems without exposing credentials:

- model and target protocol;
- normalized Factory endpoint;
- credential source type;
- redacted organization ID;
- whether `FACTORY_API_BASE` or `FACTORY_ORG_ID` affected routing.

Bearer tokens, refresh tokens, complete organization IDs, and serialized credentials are redacted. Original HTTP status classification is preserved so OMP can still distinguish refresh, sibling rotation, quota exhaustion, and transient backoff.

## Verification

Automated coverage includes:

- credential-envelope account attribution;
- token, organization, and endpoint pairing;
- explicit multi-organization login;
- strict token/selection/`whoami` agreement;
- persistent `401` refresh and sibling rotation;
- account-specific `403` sibling rotation;
- Standard/Core quota isolation;
- exhausted-account sibling rotation;
- bounded all-accounts-exhausted behavior;
- shared usage fetches with independent caller cancellation;
- malicious endpoint rejection;
- OAuth cancellation and bounded response handling;
- dynamic model discovery timeout;
- native Factory usage-provider registration.

The suite uses synthetic credentials, local fetch mocks, and disposable temporary SQLite databases. It does not use real OAuth credentials or make paid model calls.

## Environment variables

| Variable | Behavior |
| --- | --- |
| `FACTORY_QUOTA_PREFLIGHT` | Set to `1` or `true` to skip explicitly exhausted OAuth accounts before model generation. |
| `FACTORY_API_BASE` | Trusted explicit override for every Factory endpoint, including local development proxies. |
| `FACTORY_API_KEY` | Uses a raw Factory API key instead of OAuth account selection. |
| `FACTORY_ORG_ID` | Optional organization fallback for raw credentials. OAuth envelopes do not borrow this value. |
| `FACTORY_ORGANIZATION_ID` | Alias for `FACTORY_ORG_ID`. |
| `FACTORY_UPSTREAM_CLIENT_TYPE` | Overrides the Factory client header; defaults to `cli`. |

## Known limitations

- Quota preflight is reactive to an explicitly exhausted account; it is not percentage-based load balancing.
- Factory billing-limit reporting and preflight are OAuth-only.
- `FACTORY_API_BASE` is trusted configuration and intentionally bypasses the hosted-endpoint allowlist.
- Automated tests do not validate live Factory entitlement or production OAuth service availability.
