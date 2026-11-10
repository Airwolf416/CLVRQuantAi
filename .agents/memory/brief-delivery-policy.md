---
name: Local-time morning brief policy
description: Product expectations for timezone selection, local delivery, and weekend-aware market summaries.
---
The user approved a daily brief scheduled around 6 AM in each subscriber’s selected time zone, selectable on signup and editable in Account. Briefs must account for weekends and market closures while recognizing that crypto remains open.

**Why:** The user found weekend briefs misleading and wants the morning summary to arrive in each recipient’s own morning rather than at a single global Eastern-time send.

**How to apply:** Use named IANA zones, not fixed UTC offsets, so daylight saving is handled. Existing subscribers retain the historical Eastern schedule until they choose otherwise. Adapt regional emphasis only from supported data; a timezone does not establish nationality or prove an exchange is open. Never invent trades to fill brief slots.

Recipient-level duplicate protection must survive batch retries and time-zone changes. Unknown provider outcomes must remain held rather than automatically resent.

**Why:** The user approved adding duplicate protection before release. A provider may accept an email before a transport timeout or a database-finalization failure, so blindly retrying can duplicate a successful delivery.

**How to apply:** Retry only explicit provider rejections. Retain pending/uncertain claims when acknowledgement is missing, including after a process crash. Protect both the recipient's local date and rapid date-line changes, while allowing ordinary next-morning delivery across daylight-saving changes. Describe this as conservative duplicate prevention, not guaranteed exactly-once email delivery.
