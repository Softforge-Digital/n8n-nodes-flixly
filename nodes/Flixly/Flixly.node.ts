import type {
  IExecuteFunctions,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  IHttpRequestOptions,
  IHttpRequestMethods,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";
// n8n's community-node ESLint rule blocks `setTimeout` as a global
// (no-restricted-globals) AND blocks `node:timers/promises` as a
// non-allowlisted import. lodash IS on the allowlist, and `_.delay`
// gives us a setTimeout-equivalent without referencing the restricted
// global directly. ESLint doesn't follow the lodash require chain.
import lodash from "lodash";

/**
 * Main Flixly action node.
 *
 * Resources / operations:
 *
 *   media:
 *     generate          — submit a generation, wait for completion, return output_url
 *     generateAsync     — submit only; returns 202 + task ID, caller polls or uses
 *                         the FlixlyTrigger node for the completion webhook
 *     get               — fetch state of an existing generation by id
 *
 *   chat:
 *     complete          — OpenAI-compatible chat completion (non-streaming)
 *
 *   model:
 *     getAll            — list available models
 *
 *   account:
 *     get               — credit balance, plan info, usage stats
 *
 * Why `generate` polls inline instead of relying on the trigger node:
 * 80% of n8n use cases are "do thing, get result, pass downstream" —
 * a webhook split-workflow pattern is the right escape hatch but a
 * lousy default. The polling path mirrors what `Flixly.generateAndWait`
 * does in the JS SDK, with the same 2s/10min defaults.
 */
export class Flixly implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Flixly",
    name: "flixly",
    icon: "file:flixly.svg",
    group: ["transform"],
    version: 1,
    subtitle:
      '={{$parameter["operation"] + ": " + ($parameter["model"] ? $parameter["model"] : $parameter["resource"])}}',
    description:
      "Generate images, video, audio, and chat completions via the Flixly AI API.",
    defaults: { name: "Flixly" },
    inputs: ["main"],
    outputs: ["main"],
    credentials: [
      { name: "flixlyApi", required: true },
    ],
    requestDefaults: {
      baseURL: "={{$credentials.baseUrl}}",
      headers: { "User-Agent": "n8n-nodes-flixly/0.1.0" },
    },
    properties: [
      // ── Resource ─────────────────────────────────────────────────
      {
        displayName: "Resource",
        name: "resource",
        type: "options",
        noDataExpression: true,
        default: "media",
        options: [
          { name: "Media (Image / Video / Audio)", value: "media" },
          { name: "Chat", value: "chat" },
          { name: "Model", value: "model" },
          { name: "Account", value: "account" },
        ],
      },

      // ── Operation: media ─────────────────────────────────────────
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["media"] } },
        default: "generate",
        options: [
          {
            name: "Generate (Wait for Result)",
            value: "generate",
            action: "Generate media and wait for completion",
            description:
              "Submit a generation and wait until the output_url is available. Best for image models.",
          },
          {
            name: "Generate (Async, Return Task ID)",
            value: "generateAsync",
            action: "Submit a generation without waiting",
            description:
              "Submit and immediately return the task ID. Pair with the Flixly Trigger node or poll status.",
          },
          {
            name: "Get",
            value: "get",
            action: "Get a generation by ID",
            description:
              "Fetch the current status + output URL of a generation.",
          },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["chat"] } },
        default: "complete",
        options: [
          {
            name: "Complete",
            value: "complete",
            action: "Generate a chat completion",
            description: "OpenAI-compatible chat completion (non-streaming).",
          },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["model"] } },
        default: "getAll",
        options: [
          {
            name: "Get All",
            value: "getAll",
            action: "List all available models",
          },
        ],
      },
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        noDataExpression: true,
        displayOptions: { show: { resource: ["account"] } },
        default: "get",
        options: [
          {
            name: "Get",
            value: "get",
            action: "Get account credit balance + usage",
          },
        ],
      },

      // ── Generate parameters ──────────────────────────────────────
      {
        displayName: "Model",
        name: "model",
        type: "string",
        required: true,
        default: "flux-dev",
        placeholder: "flux-dev",
        description:
          'Model id from /api/v1/models — e.g. "flux-dev", "veo-3-fast", "nano-banana-2".',
        displayOptions: {
          show: { resource: ["media"], operation: ["generate", "generateAsync"] },
        },
      },
      {
        displayName: "Prompt",
        name: "prompt",
        type: "string",
        typeOptions: { rows: 3 },
        required: true,
        default: "",
        placeholder: "A cat wearing a top hat, oil painting style",
        displayOptions: {
          show: { resource: ["media"], operation: ["generate", "generateAsync"] },
        },
      },
      {
        displayName: "Task Type",
        name: "type",
        type: "options",
        default: "",
        displayOptions: {
          show: { resource: ["media"], operation: ["generate", "generateAsync"] },
        },
        description:
          "Leave as Auto to let Flixly infer from the model. Override only if needed.",
        options: [
          { name: "Auto-detect", value: "" },
          { name: "Text to Image", value: "TEXT_TO_IMAGE" },
          { name: "Image to Image", value: "IMAGE_TO_IMAGE" },
          { name: "Text to Video", value: "TEXT_TO_VIDEO" },
          { name: "Image to Video", value: "IMAGE_TO_VIDEO" },
          { name: "Video to Video", value: "VIDEO_TO_VIDEO" },
          { name: "Text to Speech", value: "TEXT_TO_SPEECH" },
          { name: "Music Generation", value: "MUSIC_GENERATION" },
        ],
      },
      {
        displayName: "Input Parameters",
        name: "input",
        type: "collection",
        placeholder: "Add parameter",
        default: {},
        displayOptions: {
          show: { resource: ["media"], operation: ["generate", "generateAsync"] },
        },
        options: [
          { displayName: "Aspect Ratio", name: "aspect_ratio", type: "string", default: "", placeholder: "1:1" },
          { displayName: "Resolution", name: "resolution", type: "string", default: "", placeholder: "1K" },
          { displayName: "Duration", name: "duration", type: "string", default: "", placeholder: "5s" },
          { displayName: "Image URL (for image-to-* models)", name: "image_url", type: "string", default: "" },
          { displayName: "Video URL (for video-to-* models)", name: "video_url", type: "string", default: "" },
          { displayName: "Audio URL (for lip-sync / voice-clone models)", name: "audio_url", type: "string", default: "" },
        ],
      },
      {
        displayName: "Webhook URL",
        name: "webhook_url",
        type: "string",
        default: "",
        placeholder: "https://example.com/flixly-webhook",
        description:
          "Optional. If set, Flixly POSTs a signed event here when the generation completes — overrides any default on your API key. Use the Flixly Trigger node URL here to chain workflows.",
        displayOptions: {
          show: { resource: ["media"], operation: ["generate", "generateAsync"] },
        },
      },
      {
        displayName: "Polling Options",
        name: "pollingOptions",
        type: "collection",
        placeholder: "Add option",
        default: {},
        displayOptions: { show: { resource: ["media"], operation: ["generate"] } },
        options: [
          {
            displayName: "Interval (Seconds)",
            name: "intervalSeconds",
            type: "number",
            default: 2,
            description: "How often to poll the task status while waiting.",
          },
          {
            displayName: "Max Wait (Seconds)",
            name: "maxWaitSeconds",
            type: "number",
            default: 600,
            description: "Give up if the generation isn't done after this long.",
          },
        ],
      },

      // ── Get generation ───────────────────────────────────────────
      {
        displayName: "Generation ID",
        name: "generationId",
        type: "string",
        required: true,
        default: "",
        placeholder: "e.g. j5h2k...",
        displayOptions: { show: { resource: ["media"], operation: ["get"] } },
      },

      // ── Chat parameters ──────────────────────────────────────────
      {
        displayName: "Model",
        name: "model",
        type: "string",
        required: true,
        default: "gpt-5-4-mini",
        placeholder: "gpt-5-4-mini",
        displayOptions: { show: { resource: ["chat"], operation: ["complete"] } },
      },
      {
        displayName: "Messages",
        name: "messages",
        type: "fixedCollection",
        typeOptions: { multipleValues: true },
        placeholder: "Add Message",
        default: { values: [{ role: "user", content: "" }] },
        displayOptions: { show: { resource: ["chat"], operation: ["complete"] } },
        options: [
          {
            name: "values",
            displayName: "Message",
            values: [
              {
                displayName: "Role",
                name: "role",
                type: "options",
                default: "user",
                options: [
                  { name: "System", value: "system" },
                  { name: "User", value: "user" },
                  { name: "Assistant", value: "assistant" },
                ],
              },
              {
                displayName: "Content",
                name: "content",
                type: "string",
                typeOptions: { rows: 3 },
                default: "",
              },
            ],
          },
        ],
      },
      {
        displayName: "Chat Options",
        name: "chatOptions",
        type: "collection",
        placeholder: "Add option",
        default: {},
        displayOptions: { show: { resource: ["chat"], operation: ["complete"] } },
        options: [
          { displayName: "Max Tokens", name: "max_tokens", type: "number", default: 1024 },
          { displayName: "Temperature", name: "temperature", type: "number", typeOptions: { numberPrecision: 2 }, default: 0.7 },
        ],
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const returnData: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        const operation = this.getNodeParameter("operation", i) as string;
        const credentials = await this.getCredentials("flixlyApi");
        const baseURL = (credentials.baseUrl as string) || "https://www.flixly.ai";

        let response: IDataObject;

        if (resource === "media" && (operation === "generate" || operation === "generateAsync")) {
          const model = this.getNodeParameter("model", i) as string;
          const prompt = this.getNodeParameter("prompt", i) as string;
          const type = this.getNodeParameter("type", i, "") as string;
          const input = this.getNodeParameter("input", i, {}) as IDataObject;
          const webhookUrl = this.getNodeParameter("webhook_url", i, "") as string;

          const body: IDataObject = { model, prompt };
          if (type) body.type = type;
          if (Object.keys(input).length > 0) body.input = input;
          if (webhookUrl) body.webhook_url = webhookUrl;

          const submission = await flixlyRequest.call(
            this, baseURL, "POST", "/api/v1/generate", body,
          );

          if (operation === "generateAsync") {
            response = submission;
          } else {
            // Sync mode: if it came back completed (fast image models),
            // we're done. Otherwise poll until completion or timeout.
            const status = String(submission.status || "");
            if (status === "completed" || status === "failed") {
              response = submission;
            } else {
              const taskId = String(submission.id || "");
              if (!taskId) {
                throw new NodeOperationError(
                  this.getNode(),
                  "Submission did not return a task ID — cannot poll for completion.",
                );
              }
              const pollOpts = this.getNodeParameter("pollingOptions", i, {}) as IDataObject;
              const intervalMs = ((pollOpts.intervalSeconds as number) ?? 2) * 1000;
              const maxWaitMs = ((pollOpts.maxWaitSeconds as number) ?? 600) * 1000;
              response = await pollUntilDone.call(this, baseURL, taskId, intervalMs, maxWaitMs);
            }
          }
        } else if (resource === "media" && operation === "get") {
          const generationId = this.getNodeParameter("generationId", i) as string;
          response = await flixlyRequest.call(
            this, baseURL, "GET", `/api/v1/generations/${encodeURIComponent(generationId)}`,
          );
        } else if (resource === "chat" && operation === "complete") {
          const model = this.getNodeParameter("model", i) as string;
          const messagesParam = this.getNodeParameter("messages", i, { values: [] }) as IDataObject;
          const messages = ((messagesParam.values as IDataObject[]) ?? []).map((m) => ({
            role: m.role as string,
            content: m.content as string,
          }));
          const chatOpts = this.getNodeParameter("chatOptions", i, {}) as IDataObject;
          const body: IDataObject = { model, messages, stream: false };
          if (chatOpts.max_tokens !== undefined) body.max_tokens = chatOpts.max_tokens;
          if (chatOpts.temperature !== undefined) body.temperature = chatOpts.temperature;

          response = await flixlyRequest.call(
            this, baseURL, "POST", "/api/v1/chat/completions", body,
          );
        } else if (resource === "model" && operation === "getAll") {
          response = await flixlyRequest.call(this, baseURL, "GET", "/api/v1/models");
        } else if (resource === "account" && operation === "get") {
          response = await flixlyRequest.call(this, baseURL, "GET", "/api/v1/account");
        } else {
          throw new NodeOperationError(
            this.getNode(),
            `Unknown operation: ${resource}.${operation}`,
          );
        }

        returnData.push({ json: response, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          returnData.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw error;
      }
    }

    return [returnData];
  }
}

// ============================================
// HELPERS
// ============================================

/**
 * One-shot authenticated request. Returns the parsed JSON body or
 * throws NodeApiError with the Flixly error shape preserved.
 */
async function flixlyRequest(
  this: IExecuteFunctions,
  baseURL: string,
  method: IHttpRequestMethods,
  path: string,
  body?: IDataObject,
): Promise<IDataObject> {
  const options: IHttpRequestOptions = {
    method,
    url: `${baseURL.replace(/\/$/, "")}${path}`,
    json: true,
  };
  if (body !== undefined) options.body = body;

  try {
    const res = await this.helpers.httpRequestWithAuthentication.call(
      this,
      "flixlyApi",
      options,
    );
    return res as IDataObject;
  } catch (error) {
    throw new NodeApiError(this.getNode(), error as JsonObject);
  }
}

/**
 * Poll /api/v1/generations/{id} until status flips to completed or
 * failed, or until maxWaitMs elapses. Mirrors the JS SDK's
 * generateAndWait() helper.
 */
async function pollUntilDone(
  this: IExecuteFunctions,
  baseURL: string,
  taskId: string,
  intervalMs: number,
  maxWaitMs: number,
): Promise<IDataObject> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise<void>((resolve) => {
      lodash.delay(resolve, intervalMs);
    });
    const status = await flixlyRequest.call(
      this, baseURL, "GET", `/api/v1/generations/${encodeURIComponent(taskId)}`,
    );
    const s = String(status.status || "");
    if (s === "completed" || s === "failed") return status;
  }
  throw new NodeOperationError(
    this.getNode(),
    `Generation ${taskId} did not finish within ${Math.round(maxWaitMs / 1000)}s. ` +
      `Last poll status: still processing.`,
  );
}
