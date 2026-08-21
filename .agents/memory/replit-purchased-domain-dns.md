---
name: Replit-purchased domain DNS access
description: How to handle DNS for a Replit-purchased domain when the app is actually hosted on Railway.
---

Do not infer that the user has a direct account with the registrar shown by public
WHOIS or authoritative nameservers. A domain purchased through Replit can expose a
third-party registrar backend while DNS remains managed through Replit's UI.

**Why:** Replit's domain-management control can be disabled until the project has a
successful Replit publish. If that publish is blocked before a build starts (for
example by an integration configuration screen), changing deployment commands or
application code does not unlock DNS and only adds risk to a Railway-hosted app.

**How to apply:** First verify the Railway-provided domain independently. Then query
public DNS to separate a healthy Railway app from a broken custom-domain route. If
the Replit DNS control is inaccessible and there are no deployment logs, stop
changing the project, preserve the Railway setup, and route the account-level domain
issue to Replit Support with the exact old and required DNS records.

For a Railway-hosted apex domain, Replit Support can manually replace the Replit A
record with an ANAME pointing to Railway. Verify Railway ownership at
`_railway-verify.<domain>` (not at the apex). After both records propagate, Railway
can temporarily serve its generic `*.up.railway.app` certificate while issuing the
custom certificate; do not churn the domain or records during that window.