# Sending FormCraft responses to n8n (F-49)

FormCraft sends each response to an n8n workflow as a signed HTTPS
request. No n8n credentials are stored in FormCraft, and n8n needs none of
FormCraft's: the link between the two is the workflow's webhook URL and a
signing secret only you hold.

## Set it up

1. **In n8n**, import the sample workflow:
   `https://<your FormCraft address>/n8n/formcraft-sample-workflow.json`
   (Workflows → Import from URL, or download it and Import from File).
   It has three steps: a **Webhook** trigger (POST, path `formcraft`),
   **Work out the signature** (a Crypto node) and **Check it came from
   FormCraft** (a Code node), then a placeholder for your own steps.
2. Open the Webhook step and copy its **Production URL**.
3. **In FormCraft**, open the form → Integrations → Webhooks → **n8n
   workflow**, paste the URL and choose Add. Copy the **signing secret**
   shown once.
4. **In n8n**, paste the secret into the **Work out the signature** step
   (Secret), then **activate** the workflow. Inactive workflows only
   listen on the Test URL, which FormCraft doesn't use.
5. Back in FormCraft, press **Test**. The execution appears in n8n.

## What arrives

A JSON body (see `docs/api.md` → Webhooks), with headers:

- `X-FormCraft-Event`: `response.completed` by default; also
  `response.partial_saved`, `response.abandoned` or `response.resumed` if
  you tick them under Events (F-53).
- `X-FormCraft-Timestamp` and `X-FormCraft-Signature`
  (`t=<timestamp>,v1=<hex HMAC-SHA256 of "<timestamp>.<body>">`).

The `eventId` in the body is the same on every retry of one event: use it
to skip duplicates (an n8n "Remove Duplicates" step on `eventId`, or a
lookup in your own store).

## Retries, failures and turning it off

- A failed delivery (n8n down, workflow inactive, a 5xx) is retried with
  backoff for about a day; each attempt shows under the endpoint's
  deliveries. The response itself is never affected.
- n8n's webhook redirects aren't followed: use the final Production URL.
- **Pause** stops sending at once; **Delete** removes the endpoint and its
  secret. A new secret (the rotate button) stops the old one working
  immediately: update the n8n step before or right after.

## Self-hosted n8n

The URL must be HTTPS on port 443 and reach the public internet: private
and internal addresses are refused (SSRF protection), so an n8n on a home
network or a VPN-only host can't receive deliveries. Put it behind a
public HTTPS reverse proxy, or use n8n Cloud.

## Not yet

A published n8n community node ("FormCraft Trigger") is a separate, later
milestone. Until then the Webhook trigger above is the supported way.
The sample workflow was built against n8n's documented node formats; it
hasn't been run against a live n8n instance from here.
