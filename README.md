# n8n-nodes-provedit

n8n community node for [Provedit](https://provedit.ai). Record AI tool invocations to a tamper-evident chain, check policy decisions, and gate workflows on `allow` / `require_approval` / `deny`.

- Docs: https://provedit.ai/docs.html#recipe-n8n
- Source: https://github.com/provedit/n8n-nodes-provedit
- Issues: https://github.com/provedit/n8n-nodes-provedit/issues

## What you get

A single node with four operations:

| Operation | Use it when |
| --- | --- |
| Check Policy (Decide) | You want to gate a downstream step without writing a chain entry. Returns `decision`, `policyName`, `policyVersion`. Optionally throws on non-`allow`. |
| Record Event | One-shot audit entry. "User said X", "model returned Y", "webhook fired". |
| Record Invocation | Pre-execution intent for a real side effect. Returns `id` (actionId), `policyDecision`, `approvalStatus`. |
| Record Result | Audit log linked to a prior Record Invocation via `parentActionId`. Carries `durationMs` and an optional hashed output digest. |

The **verdict is bound to the invocation record itself** (via `policyDecision` and `approvalStatus`). There is no separate "outcome" field, and result rows are pure audit logs - they never override the invocation's verdict.

## Install

In n8n: Settings -> Community Nodes -> Install -> `n8n-nodes-provedit`.

Self-hosted:

```bash
npm install n8n-nodes-provedit
```

## Credentials

Create an agent key in the Provedit console (Tenant -> Agent keys) and paste it into the **Provedit API** credential. The key determines the tenant and the bound policy. Set the API base to `https://api.provedit.ai` (default) or your self-hosted URL.

## Patterns

### Gate a side effect with `require_approval`

```
Webhook -> Record Invocation -> Switch on policyDecision
                                  allow            -> Side effect -> Respond
                                  require_approval -> Wait for Approval (HTTP)
                                                       -> IF approvalStatus == approved
                                                          true  -> Side effect -> Respond
                                                          false -> Respond Denied
                                  deny             -> Respond Denied
```

The "Wait for Approval" node is a plain HTTP Request node calling the long-poll endpoint:

```
GET https://api.provedit.ai/v1/actions/{{ $('Record Invocation').item.json.id }}/wait?timeoutMs=120000
```

Use the **Provedit API** credential on it (Authentication -> Predefined Credential Type). It returns `{ approvalStatus: 'approved' | 'denied' }` when an operator decides in the console, or HTTP `408` on timeout.

### Two-phase recording around a real call (no approval needed)

```
Trigger -> Record Invocation -> Stripe Refund -> Record Result
                | id out                              | parentActionId in
```

In the Record Result step's Parent Action ID field:

```
={{ $('Record Invocation').item.json.id }}
```

## Example workflow

See the [n8n recipe in the Provedit docs](https://provedit.ai/docs.html#recipe-n8n) for a complete refund-assistant workflow that demonstrates the `require_approval` long-poll pattern, including the Switch on `policyDecision` and the HTTP-based wait branch.

## License

MIT.
