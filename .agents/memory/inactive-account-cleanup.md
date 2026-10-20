---
name: Inactive-account cleanup
description: Safety rule for account deletion when historical login data is incomplete.
---

Accounts with a NULL `last_login_at` must be excluded from automatic inactivity deletion; do not substitute `created_at`.

Run the cleanup once per month, on the first calendar day.

**Why:** the user chose to retain accounts with unknown login history rather than risk deleting a returning user's account.

**How to apply:** schedule the cleanup monthly on day 1, require a known login timestamp for automatic deletion, record future successful logins durably, and leave legacy NULL rows for manual review.
