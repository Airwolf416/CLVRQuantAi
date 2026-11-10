---
name: AI request Unicode boundary failures
description: Why valid-looking JSON.stringify output can still be rejected by Anthropic after text is truncated.
---
AI request strings must contain complete Unicode characters. UTF-16 substring limits can split an emoji and leave a lone surrogate; normalize before truncation/transport and preserve valid pairs at the boundary.

**Why:** A production Trade Ideas screenshot showed Anthropic rejecting the request as “unexpected end of hex escape.” A direct minimal request reproduced the same HTTP 400 with a lone high surrogate; the repaired request returned HTTP 200. Node's JSON.stringify escapes lone surrogates and JSON.parse accepts them, so a successful local JSON round-trip alone does not prove the provider accepts the body.

**How to apply:** Keep existing text-size budgets but truncate without splitting pairs and sanitize all outgoing string values, including generated context and tool follow-ups. Test strict Unicode validity, not only JSON.parse. An upstream encoding or credential failure must render a generation error, not “no setups” or an expired app session. Do not weaken trade safety gates to fix a request-transport failure.
