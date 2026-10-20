---
name: Inactive-account cleanup
description: Safety rule for account deletion when historical login data is incomplete.
---

Accounts with a NULL `last_login_at` must be excluded from automatic inactivity deletion; do not substitute `created_at`.

**Why:** the user chose to retain accounts with unknown login history rather than risk deleting a returning user's account.

**How to apply:** require a known login timestamp for automatic deletion, record future successful logins durably, and leave legacy NULL rows for manual review.
