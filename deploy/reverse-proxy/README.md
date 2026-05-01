# Reverse-proxy reference configs

mTLS edge-termination configs for nginx, Caddy, and Traefik. Pick one, copy it, replace placeholders, deploy.

These are reference configs — the sovereign tier requires mTLS at the edge, but the chart and Dockerfile do not assume any particular proxy.

## Why mTLS for the sovereign tier

The sovereign tier guarantees that every call into the agent control plane is attributable to a holder of a customer-issued certificate. Bearer tokens leak; certificates rotate, and a private key staying inside an HSM/TPM is a much stronger boundary than a bearer string in `Authorization`. The proxy:

1. Terminates TLS 1.3 with the server cert.
2. Verifies the client cert against the customer's CA bundle (`<ca_bundle_path>`).
3. Forwards client identity (CN, serial, issuer) as headers to the agent-api-server, which records them on every audit event.

## Cert authority — pick one

| Authority                    | When                                                                       |
| ---------------------------- | -------------------------------------------------------------------------- |
| Customer's existing PKI / AD | Customer already has an enterprise CA. Issue a sub-CA for agent clients.   |
| HashiCorp Vault PKI          | Customer wants short-lived certs (hours/days) with on-demand revocation.   |
| cert-manager + private CA    | Kubernetes-native; pair with `cert-manager.io/v1.Issuer` of type `CA`.     |

Do **not** use a public CA (Let's Encrypt, ZeroSSL, etc.) for the *client* leg. Public CAs are appropriate for the **server** cert only.

## Rotation cadence

| Cert       | Cadence  | Notes                                                          |
| ---------- | -------- | -------------------------------------------------------------- |
| Server     | 90 days  | Public CA + ACME automation is fine.                           |
| Client     | 7-30 d   | Short rotation is the point. Use Vault PKI or SPIFFE/SPIRE.    |
| Customer CA| 1-3 yrs  | Long-lived; protect the root key in HSM.                       |
| OCSP cache | hourly   | Stapling refresh handled by the proxy.                         |

## Monitoring tips

- Alert on a non-zero rate of `ssl_client_verify != "SUCCESS"` (nginx variable; analogous fields exist for Caddy/Traefik). A spike usually means a CA mis-config or an expired client cert in the field.
- Watch certificate `notAfter` from the proxy logs — the configs above forward `notBefore`/`notAfter` so your SIEM can drive renewal reminders ahead of expiry.
- Track edge rate-limit hits separately from upstream 429s. Edge limits indicate scraping; upstream limits indicate hot tenants.
- For Caddy, the rate-limit module is a separate plugin — bake it into the binary (`xcaddy build` with `caddy-ratelimit`) before deploying with the provided Caddyfile.

## Placeholders to replace

Common across all three configs:

- `<api_upstream>` — `agent-api-server:3000` for the in-cluster Service, or a remote DNS name.
- `<server_name>` — public hostname.
- `<ca_bundle_path>` — file path to the customer-trusted client CA bundle (PEM).
- `<server_cert_path>`, `<server_key_path>` — server cert + key.
- `<ocsp_resolver>` — nginx only; resolver IPs for OCSP fetches.
