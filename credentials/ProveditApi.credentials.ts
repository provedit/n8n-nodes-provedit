import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from 'n8n-workflow';

/**
 * Provedit API credential. Holds the agent key (pvk_...) and the base URL.
 * The agent key is sent as `Authorization: Bearer <key>` on every request.
 * Tenant and policy binding are resolved server-side from the key.
 */
export class ProveditApi implements ICredentialType {
  name = 'proveditApi';
  displayName = 'Provedit API';
  documentationUrl = 'https://provedit.ai/docs.html';

  properties: INodeProperties[] = [
    {
      displayName: 'API URL',
      name: 'apiUrl',
      type: 'string',
      default: 'https://api.provedit.ai',
      placeholder: 'https://api.provedit.ai',
      description: 'Base URL of the Provedit chain API. Override for self-hosted or staging.',
    },
    {
      displayName: 'Agent Key',
      name: 'agentKey',
      type: 'string',
      typeOptions: { password: true },
      default: '',
      required: true,
      placeholder: 'pvk_...',
      description:
        'Agent key issued in the Provedit console (Tenant > Agent keys). Determines tenant and bound policy.',
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: 'generic',
    properties: {
      headers: {
        Authorization: '=Bearer {{$credentials.agentKey}}',
      },
    },
  };

  /**
   * Lightweight credential test: hit /v1/policies/decide with a no-op tool.
   * A 200/4xx response from this endpoint proves the key is valid and the
   * base URL is correct without recording anything in the timeline.
   */
  test: ICredentialTestRequest = {
    request: {
      baseURL: '={{$credentials.apiUrl}}',
      url: '/v1/policies/decide',
      method: 'POST',
      body: { tool: 'provedit.credential_test', params: {} },
      headers: { 'Content-Type': 'application/json' },
    },
  };
}
