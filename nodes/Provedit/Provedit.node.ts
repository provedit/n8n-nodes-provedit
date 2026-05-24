import {
  NodeConnectionTypes,
  NodeOperationError,
  type IExecuteFunctions,
  type INode,
  type INodeExecutionData,
  type INodeType,
  type INodeTypeDescription,
} from 'n8n-workflow';

/**
 * Provedit node. Four operations:
 *   - decide: ask the API for a policy verdict (allow / require_approval / deny).
 *             Output includes `decision` so you can branch with an IF / Switch node.
 *   - recordEvent: standalone audit entry. Use for "user said X" / "model returned Y" / etc.
 *   - recordInvocation: pre-execution intent. Returns actionId.
 *   - recordResult: follow-up to a prior invocation, linked via parentActionId.
 *
 * For workflow gating, the recommended pattern is: Decide -> IF (decision != allow) -> Stop
 * before any side-effecting node runs.
 */
export class Provedit implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Provedit',
    name: 'provedit',
    icon: 'file:provedit.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: 'Record AI actions to a tamper-evident chain and gate workflows on policy decisions.',
    defaults: { name: 'Provedit' },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: 'proveditApi', required: true }],
    requestDefaults: {
      baseURL: '={{$credentials.apiUrl}}',
      headers: { 'Content-Type': 'application/json' },
    },
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        default: 'decide',
        options: [
          {
            name: 'Check Policy (Decide)',
            value: 'decide',
            description: 'Ask Provedit whether a tool call would be allowed, denied, or require approval',
            action: 'Check policy for a tool',
          },
          {
            name: 'Record Event',
            value: 'recordEvent',
            description: 'Record a standalone audit entry (no executor follow-up)',
            action: 'Record an event',
          },
          {
            name: 'Record Invocation',
            value: 'recordInvocation',
            description: 'Record the intent to perform an action; returns an actionId for the result follow-up',
            action: 'Record an invocation',
          },
          {
            name: 'Record Result',
            value: 'recordResult',
            description: 'Record the result of a prior invocation, linked by parentActionId',
            action: 'Record a result',
          },
        ],
      },

      // ---- Shared: tool ----
      {
        displayName: 'Tool',
        name: 'tool',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'send_email',
        description: 'Tool name matched by your Provedit policy (snake_case or dotted, e.g. send_email, billing.refund)',
      },

      // ---- decide: minimal extra fields ----
      {
        displayName: 'Params (JSON)',
        name: 'params',
        type: 'json',
        default: '{}',
        description: 'Parameters the tool would be called with. Some policy rules match on these.',
        displayOptions: { show: { operation: ['decide'] } },
      },

      // ---- record*: full action shape ----
      {
        displayName: 'Params (JSON)',
        name: 'paramsRecord',
        type: 'json',
        default: '{}',
        description: 'Parameters recorded on the action',
        displayOptions: { show: { operation: ['recordEvent', 'recordInvocation', 'recordResult'] } },
      },
      {
        displayName: 'Target Kind',
        name: 'targetKind',
        type: 'options',
        default: 'record',
        options: [
          { name: 'Database', value: 'db' },
          { name: 'Deploy', value: 'deploy' },
          { name: 'Email', value: 'email' },
          { name: 'File', value: 'file' },
          { name: 'Message', value: 'message' },
          { name: 'Other', value: 'other' },
          { name: 'Payment', value: 'payment' },
          { name: 'Record (Opaque ID)', value: 'record' },
          { name: 'Repository', value: 'repo' },
          { name: 'URL (Outbound HTTP)', value: 'url' },
        ],
        displayOptions: { show: { operation: ['recordEvent', 'recordInvocation', 'recordResult'] } },
      },
      {
        displayName: 'Target Ref',
        name: 'targetRef',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'cust_123 or https://api.example.com/...',
        description: 'Identifier of what the action touched. For URL kind, use the full http(s) URL; for record kind, use the record ID.',
        displayOptions: { show: { operation: ['recordEvent', 'recordInvocation', 'recordResult'] } },
      },
      {
        displayName: 'Target Summary',
        name: 'targetSummary',
        type: 'string',
        default: '',
        placeholder: 'refund $48.00 to ACME Corp',
        description: 'Optional human-readable line shown on the timeline next to the target',
        displayOptions: { show: { operation: ['recordEvent', 'recordInvocation', 'recordResult'] } },
      },

      // ---- recordResult: link to parent ----
      {
        displayName: 'Parent Action ID',
        name: 'parentActionId',
        type: 'string',
        default: '',
        required: true,
        placeholder: 'act_...',
        description: 'The actionId returned by the prior Record Invocation step',
        displayOptions: { show: { operation: ['recordResult'] } },
      },

      // ---- Optional advanced fields ----
      {
        displayName: 'Additional Fields',
        name: 'additional',
        type: 'collection',
        placeholder: 'Add Field',
        default: {},
        displayOptions: {
          show: { operation: ['recordEvent', 'recordInvocation', 'recordResult'] },
        },
        options: [
          {
            displayName: 'Actor Agent Name',
            name: 'actorAgentName',
            type: 'string',
            default: '',
            description: 'Override the agent name on this entry',
          },
          {
            displayName: 'Actor Model Name',
            name: 'actorModelName',
            type: 'string',
            default: '',
            placeholder: 'gpt-4o',
          },
          {
            displayName: 'Actor User Email',
            name: 'actorUserEmail',
            type: 'string',
            default: '',
            description: 'End user on whose behalf the action runs, if any',
          },
          {
            displayName: 'Result Duration (Ms)',
            name: 'resultDurationMs',
            type: 'number',
            default: 0,
            displayOptions: { show: { '/operation': ['recordResult'] } },
          },
          {
            displayName: 'Result Output (JSON, Hashed)',
            name: 'resultOutput',
            type: 'json',
            default: '',
            description: 'Output is SHA-256 hashed and stored under params._meta.outputDigest; the raw value is not transmitted',
            displayOptions: { show: { '/operation': ['recordResult'] } },
          },
          {
            displayName: 'Session ID',
            name: 'sessionId',
            type: 'string',
            default: '',
            description: 'Groups related actions in one conversation or workflow run',
          },
          {
            displayName: 'Tool Version',
            name: 'toolVersion',
            type: 'string',
            default: '0.0.0',
          },
        ],
      },

      // ---- decide: gate ----
      {
        displayName: 'Fail Workflow on Non-Allow',
        name: 'failOnNonAllow',
        type: 'boolean',
        default: false,
        description:
          'Whether to throw if the decision is deny or require_approval. Use this when you want Decide to act as a hard gate without an IF branch.',
        displayOptions: { show: { operation: ['decide'] } },
      },
    ],
		usableAsTool: true,
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    const creds = await this.getCredentials('proveditApi');
    const baseUrl = String(creds.apiUrl || 'https://api.provedit.ai').replace(/\/+$/, '');

    for (let i = 0; i < items.length; i++) {
      const operation = this.getNodeParameter('operation', i) as string;
      const tool = this.getNodeParameter('tool', i) as string;

      try {
        if (operation === 'decide') {
          const params = parseJson(this.getNode(), this.getNodeParameter('params', i, '{}'), 'Params');
          const failOnNonAllow = this.getNodeParameter('failOnNonAllow', i, false) as boolean;
          const res = await this.helpers.httpRequestWithAuthentication.call(this, 'proveditApi', {
            method: 'POST',
            url: baseUrl + '/v1/policies/decide',
            body: { tool, params },
            json: true,
          });
          if (failOnNonAllow && res?.decision && res.decision !== 'allow') {
            throw new NodeOperationError(
              this.getNode(),
              `Provedit policy ${res.decision} for tool '${tool}' (policy ${res.policyName} v${res.policyVersion})`,
              { itemIndex: i },
            );
          }
          out.push({ json: res, pairedItem: { item: i } });
          continue;
        }

        // record* operations share most of the body.
        const params = parseJson(this.getNode(), this.getNodeParameter('paramsRecord', i, '{}'), 'Params');
        const targetKind = this.getNodeParameter('targetKind', i) as string;
        const targetRef = this.getNodeParameter('targetRef', i) as string;
        const targetSummary = this.getNodeParameter('targetSummary', i, '') as string;
        const additional = this.getNodeParameter('additional', i, {}) as Record<string, unknown>;

        // Vendor is always 'n8n' for this node: any action recorded through
        // here is, by definition, originating from an n8n workflow. The
        // console uses this to render the brand chip on the timeline.
        const actor: Record<string, string> = { vendor: 'n8n' };
        if (additional['actorAgentName']) actor['agentName'] = String(additional['actorAgentName']);
        if (additional['actorUserEmail']) actor['userEmail'] = String(additional['actorUserEmail']);
        if (additional['actorModelName']) actor['modelName'] = String(additional['actorModelName']);

        // The body intentionally does NOT carry a policyDecision. Per the
        // Provedit security model, the API always re-evaluates against the
        // tenant's active policy (configured in the console) and stamps its
        // own decision, version, and bundle hash. A recorder cannot label
        // a destructive call as 'allow' to bypass review. See SPEC.md.
        const body: Record<string, unknown> = {
          tool,
          toolVersion: (additional['toolVersion'] as string) || '0.0.0',
          params,
          target: {
            kind: targetKind,
            ref: targetRef,
            ...(targetSummary ? { summary: targetSummary } : {}),
          },
        };
        if (Object.keys(actor).length > 0) body['actor'] = actor;
        if (additional['sessionId']) body['sessionId'] = String(additional['sessionId']);

        if (operation === 'recordEvent') {
          body['actionKind'] = 'event';
        } else if (operation === 'recordInvocation') {
          body['actionKind'] = 'invocation';
        } else if (operation === 'recordResult') {
          body['actionKind'] = 'result';
          body['parentActionId'] = this.getNodeParameter('parentActionId', i) as string;
          const meta: Record<string, unknown> = {};
          if (additional['resultDurationMs'] !== undefined && additional['resultDurationMs'] !== null) {
            meta['durationMs'] = Number(additional['resultDurationMs']);
          }
          if (additional['resultOutput'] !== undefined && additional['resultOutput'] !== '') {
            const out = additional['resultOutput'];
            const str = typeof out === 'string' ? out : JSON.stringify(out);
            meta['outputDigest'] = {
              hash: 'sha256:' + (await sha256Hex(str)),
              bytes: Buffer.byteLength(str, 'utf8'),
            };
          }
          if (Object.keys(meta).length > 0) (params as Record<string, unknown>)['_meta'] = meta;
        }

        const res = await this.helpers.httpRequestWithAuthentication.call(this, 'proveditApi', {
          method: 'POST',
          url: baseUrl + '/v1/actions',
          body,
          json: true,
        });
        out.push({ json: res, pairedItem: { item: i } });
      } catch (err) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (err as Error).message },
            error: err as NodeOperationError,
            pairedItem: { item: i },
          });
          continue;
        }
        throw new NodeOperationError(this.getNode(), err as Error, { itemIndex: i });
      }
    }

    return [out];
  }
}

function parseJson(node: INode, value: unknown, label: string): Record<string, unknown> {
  if (value === undefined || value === null || value === '') return {};
  if (typeof value === 'object') return value as Record<string, unknown>;
  try {
    return JSON.parse(String(value));
  } catch (err) {
    throw new NodeOperationError(node, `${label} is not valid JSON: ${(err as Error).message}`);
  }
}

async function sha256Hex(input: string): Promise<string> {
  // Lazy require so we don't pay for it on every execute call boot.
  const { createHash } = await import('node:crypto');
  return createHash('sha256').update(input).digest('hex');
}
