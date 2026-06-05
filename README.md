# n8n-nodes-flixly

Official [n8n](https://n8n.io) community nodes for the [Flixly](https://www.flixly.ai) AI API. Generate images, video, audio, and chat completions directly from your workflows.

## Install

In your n8n instance, go to **Settings → Community Nodes → Install** and enter:

```
n8n-nodes-flixly
```

Or for self-hosted n8n with npm:

```bash
cd ~/.n8n/nodes
npm install n8n-nodes-flixly
```

Restart n8n. The Flixly nodes appear in the node picker.

## What you get

This package adds two nodes:

### 🟠 Flixly (action node)

Submit generations and chat completions inside a workflow. Resources:

- **Media** — `Generate (Wait for Result)` · `Generate (Async)` · `Get`
- **Chat** — `Complete` (OpenAI-compatible)
- **Model** — `Get All`
- **Account** — `Get`

The default **Generate (Wait for Result)** operation polls until completion and emits the output URL — drop-in compatible with anything that takes a media URL downstream (HTTP Request, S3 Upload, Slack Send, etc.).

### 🟠 Flixly Trigger

Receives Flixly's signed completion webhooks. Auto-generates a webhook URL on activation — paste it into the `webhook_url` field of your generate request (or set it as the default on your API key in the Flixly dashboard), and Flixly POSTs the completion event to this node.

Includes optional HMAC-SHA256 signature verification with replay protection — flip it on once you've set the webhook secret on the Flixly credential.

## Getting started

### 1. Get a Flixly API key

Sign in at [www.flixly.ai](https://www.flixly.ai) → **Dashboard → Settings → API Keys → Create**. Copy the `flx_live_...` key.

### 2. Create the credential in n8n

In any workflow, drop a Flixly node, click **Create New Credential**, paste the key. The Base URL stays as `https://www.flixly.ai`.

If you plan to use the Trigger node with signature verification, paste your webhook secret here too. Otherwise leave it blank.

### 3. Build a workflow

**Quick win — generate an image:**

```
[Schedule Trigger] → [Flixly: Media · Generate] → [HTTP Request: download]
```

Set model `flux-dev`, prompt `"A futuristic cityscape at dusk, cinematic"`. Drag the output `output_url` into a downstream HTTP node and you have a recurring image generator.

**Async with webhook callback:**

```
[Flixly Trigger]  ←─── Flixly webhook callback
        ↓
[Process Result]

(separate workflow:)

[Manual Trigger] → [Flixly: Generate (Async)]  
  webhook_url = <copy from the Flixly Trigger node URL>
```

The Async operation returns immediately with the task ID — no n8n function call sitting idle for 60 seconds while a video renders.

## Configuration

### Credential fields

| Field | Required | Notes |
|---|---|---|
| API Key | ✅ | `flx_live_...` from your Flixly dashboard |
| Base URL | ✅ | Defaults to `https://www.flixly.ai`. Override only for staging |
| Webhook Secret | optional | Needed only if Trigger node verifies signatures |

### Action node — `media: generate`

| Field | Required | Notes |
|---|---|---|
| Model | ✅ | Model id from `GET /api/v1/models` |
| Prompt | ✅ | Free-form text |
| Task Type | optional | Leave on Auto-detect unless overriding |
| Input Parameters | optional | aspect_ratio, resolution, duration, image_url, etc. |
| Webhook URL | optional | If set, Flixly also POSTs to this URL on completion |
| Polling Interval | optional | Default 2 seconds |
| Max Wait | optional | Default 600 seconds (10 minutes) |

### Trigger node

| Field | Required | Notes |
|---|---|---|
| Verify Signature | ✅ | On by default — recommended |
| Replay Tolerance | optional | Default 300s (5 minutes) |
| Event Filter | optional | Drop `generation.failed` events here if you want |

## Output shape

Every successful operation returns the Flixly API response unchanged. Example for `media: generate`:

```json
{
  "id": "j5h2k...",
  "status": "completed",
  "type": "TEXT_TO_IMAGE",
  "model": "flux-dev",
  "output_url": "https://cdn.flixly.ai/outputs/...",
  "status_url": "https://www.flixly.ai/api/v1/generations/j5h2k...",
  "credits_charged": 1,
  "created_at": "2026-06-06T12:00:00Z",
  "completed_at": "2026-06-06T12:00:05Z"
}
```

## Spending caps & rate limits

The Flixly API enforces:

- **Per-key monthly credit caps** — set on the API key in your Flixly dashboard. When hit, returns `402 insufficient_credits`. The error message tells you which key + the current usage.
- **Per-key rate limits** — every response includes `X-RateLimit-*` headers. When exceeded, returns `429 rate_limit_exceeded` with `Retry-After`. n8n surfaces this as a NodeApiError; the **Continue on Fail** node setting lets your workflow handle it.

## Support & docs

- API docs: [www.flixly.ai/developers](https://www.flixly.ai/developers)
- OpenAPI spec: [www.flixly.ai/api/v1/openapi.json](https://www.flixly.ai/api/v1/openapi.json)
- JS / PHP SDKs: [www.flixly.ai/sdks](https://www.flixly.ai/sdks)
- Issues / feature requests: [github.com/Softforge-Digital/n8n-nodes-flixly/issues](https://github.com/Softforge-Digital/n8n-nodes-flixly/issues)
- Email: [support@flixly.ai](mailto:support@flixly.ai)

## License

[MIT](LICENSE)
