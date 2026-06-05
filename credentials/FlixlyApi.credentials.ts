import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

/**
 * Credentials for the Flixly REST API + the optional webhook secret
 * used by the FlixlyTrigger node to verify incoming HMAC signatures.
 *
 * Stored as a single n8n credential so users don't have to wire up
 * two — pasting the key once unlocks both the action node and the
 * trigger.
 */
export class FlixlyApi implements ICredentialType {
  name = "flixlyApi";
  displayName = "Flixly API";
  documentationUrl = "https://www.flixly.ai/developers";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        'Your Flixly API key (starts with "flx_live_"). Create one at https://www.flixly.ai/dashboard/settings/api-keys.',
    },
    {
      displayName: "Base URL",
      name: "baseUrl",
      type: "string",
      default: "https://www.flixly.ai",
      description:
        "Leave as-is unless you're pointing at a staging or self-hosted deployment.",
    },
    {
      displayName: "Webhook Secret (optional)",
      name: "webhookSecret",
      type: "string",
      typeOptions: { password: true },
      default: "",
      description:
        "Only needed if you use the Flixly Trigger node with signature verification enabled. Flixly shows this secret when you set up a webhook URL on your API key.",
    },
  ];

  /** Attach the bearer token to every request made with these creds. */
  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  /**
   * "Test" button on the credential editor calls /account — cheapest
   * authenticated endpoint, validates the key without consuming credits.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: "={{$credentials.baseUrl}}",
      url: "/api/v1/account",
      method: "GET",
    },
  };
}
