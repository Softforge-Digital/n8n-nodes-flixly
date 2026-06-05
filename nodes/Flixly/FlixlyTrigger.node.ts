import type {
  IHookFunctions,
  IWebhookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookResponseData,
  IDataObject,
} from "n8n-workflow";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Flixly webhook trigger.
 *
 * n8n generates a unique webhook URL when this node is activated.
 * The user pastes that URL into their Flixly generation request's
 * `webhook_url` field (or sets it as the default on their API key)
 * and Flixly POSTs the completion event there when the generation
 * finishes.
 *
 * Two flavors of trigger:
 *
 *   - "All completions" — fires for every webhook the credential's
 *     API key receives. Lets a single workflow handle "any generation
 *     done" → "process result" pipelines.
 *
 *   - "Specific webhook URL" — the default. Fires only for requests
 *     POSTed to THIS node's auto-generated path. Cleaner isolation
 *     between workflows.
 *
 * Signature verification (HMAC-SHA256 over `${timestamp}.${rawBody}`)
 * is on by default if a webhook secret is configured on the
 * credential. Without a secret, verification is skipped — n8n's TLS
 * already protects the channel, but anyone who knows the URL can
 * forge events, so always set the secret in production.
 */
export class FlixlyTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Flixly Trigger",
    name: "flixlyTrigger",
    icon: "file:flixly.svg",
    group: ["trigger"],
    version: 1,
    description:
      "Receives Flixly generation completion webhooks. Verifies HMAC signatures.",
    defaults: { name: "Flixly Trigger" },
    inputs: [],
    outputs: ["main"],
    credentials: [
      { name: "flixlyApi", required: true },
    ],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "webhook",
      },
    ],
    properties: [
      {
        displayName:
          "Paste this node's webhook URL into your Flixly generation request's <b>webhook_url</b> field. Find it on the node's main panel after activation.",
        name: "notice",
        type: "notice",
        default: "",
      },
      {
        displayName: "Verify Signature",
        name: "verifySignature",
        type: "boolean",
        default: true,
        description:
          "Recommended. Rejects requests whose HMAC-SHA256 signature doesn't match the webhook secret configured on the credential. Disable only for testing.",
      },
      {
        displayName: "Replay Tolerance (Seconds)",
        name: "tolerance",
        type: "number",
        default: 300,
        description:
          "Reject signatures with a timestamp older than this. Stripe-style replay protection. Lower = stricter.",
        displayOptions: { show: { verifySignature: [true] } },
      },
      {
        displayName: "Event Filter",
        name: "events",
        type: "multiOptions",
        default: ["generation.completed", "generation.failed"],
        description:
          "Only emit when the webhook event matches one of these. Drop the rest.",
        options: [
          { name: "Generation Completed", value: "generation.completed" },
          { name: "Generation Failed", value: "generation.failed" },
        ],
      },
    ],
  };

  // No remote webhook registration — Flixly's webhook URLs are passed
  // per-request in the generate body, not registered upfront. This
  // returns true so n8n treats the webhook as always "registered."
  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async create(this: IHookFunctions): Promise<boolean> {
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const headers = (req.headers ?? {}) as Record<string, string | string[] | undefined>;
    const body = this.getBodyData() as IDataObject;

    // Pick out the signing headers (lowercase per Node's http normalization).
    const signature = headerOf(headers["x-flixly-signature"]);
    const timestamp = headerOf(headers["x-flixly-timestamp"]);
    const event = headerOf(headers["x-flixly-event"]) || String(body?.event || "");

    const verifySignature = this.getNodeParameter("verifySignature", true) as boolean;
    const tolerance = this.getNodeParameter("tolerance", 300) as number;
    const eventFilter = this.getNodeParameter("events", []) as string[];

    if (verifySignature) {
      const credentials = await this.getCredentials("flixlyApi");
      const secret = (credentials.webhookSecret as string) || "";
      if (!secret) {
        return {
          webhookResponse: {
            status: 500,
            body: {
              error:
                "Webhook secret is not set on the Flixly credential. Either disable signature verification on this trigger, or paste your webhook secret into the credential.",
            },
          },
        };
      }
      const verdict = verifyHmac({
        secret,
        timestamp,
        signature,
        rawBody: JSON.stringify(body),  // n8n already parsed it; re-stringify is OK since Flixly signs over JSON.stringify output too
        tolerance,
      });
      if (!verdict.ok) {
        return {
          webhookResponse: {
            status: 401,
            body: { error: `Signature verification failed: ${verdict.reason}` },
          },
        };
      }
    }

    // Event filtering — if user only wants completions, drop failures
    // before they hit the workflow.
    if (eventFilter.length > 0 && event && !eventFilter.includes(event)) {
      return {
        webhookResponse: { status: 200, body: { received: true, skipped: true, event } },
        noWebhookResponse: false,
      };
    }

    return {
      workflowData: [
        [
          {
            json: body,
            // Surface the headers as binary-ish meta so downstream nodes
            // can inspect them if needed (delivery ID for dedup, etc.)
            pairedItem: { item: 0 },
          },
        ],
      ],
    };
  }
}

// ============================================
// HELPERS
// ============================================

function headerOf(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] || "";
  return v || "";
}

interface VerifyResult { ok: boolean; reason?: string; }

function verifyHmac(args: {
  secret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
  tolerance: number;
}): VerifyResult {
  if (!args.signature.startsWith("sha256=")) {
    return { ok: false, reason: "missing or malformed signature header" };
  }
  const ts = Number(args.timestamp);
  if (!Number.isFinite(ts) || ts <= 0) {
    return { ok: false, reason: "missing or malformed timestamp header" };
  }
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > args.tolerance) {
    return { ok: false, reason: "timestamp outside tolerance window (replay protection)" };
  }
  const provided = args.signature.slice(7);
  const expected = createHmac("sha256", args.secret)
    .update(`${args.timestamp}.${args.rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return { ok: false, reason: "signature length mismatch" };
  }
  if (!timingSafeEqual(a, b)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}
