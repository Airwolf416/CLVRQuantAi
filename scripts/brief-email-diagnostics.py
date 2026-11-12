"""Read-only Railway diagnostics. Never print raw logs, addresses, or credentials."""
import collections
import datetime
import json
import os
import re
import subprocess
import sys

RULES = {
    "scheduler_started": r"Scheduler started",
    "scheduler_heartbeat": r"local scheduler heartbeat",
    "scheduler_failed": r"Local-time scheduler failed",
    "ledger_read_failed": r"Could not check brief slot",
    "ledger_claim_failed": r"claimBriefSlot failed",
    "slot_won": r"claim .* WON",
    "slot_already_claimed": r"already claimed|lost \(already claimed\)",
    "generation_started": r"Generating brief \(attempt",
    "generation_succeeded": r"Brief generated on attempt|Condensed fallback brief generated",
    "generation_all_failed": r"All AI generation failed",
    "generation_encoding_error": r"unexpected end of hex escape|request body is not valid JSON",
    "integrity_blocked_send": r"CRITICAL DATA INTEGRITY FAILURE",
    "no_subscribers": r"No active subscribers",
    "batch_started": r"Sending to \d+ subscribers",
    "recipient_sent": r"\[daily-brief\] Sent to ",
    "recipient_send_failed": r"Failed for .* at send stage",
    "recipient_render_failed": r"Failed for .* at render stage",
    "batch_completed": r"Done .+ emails sent across",
    "batch_released_for_retry": r"releasing group slot",
    "pre_send_exception": r"Pre-send exception",
    "email_client_failed": r"Resend client / loop error",
    "missing_email_credentials": r"RESEND_API_KEY not set|REPLIT_CONNECTORS_HOSTNAME not set",
    "database_missing_column": r"column .+ does not exist",
    "database_missing_table": r"relation .+ does not exist",
    "database_value_too_long": r"value too long for type",
    "provider_rate_limit": r"rate_limit_exceeded|too many requests",
    "provider_daily_quota": r"daily.{0,30}quota|daily.{0,30}limit",
    "provider_monthly_quota": r"monthly.{0,30}quota|monthly.{0,30}limit",
    "provider_auth_error": r"invalid_api_key|invalid_api_Key|invalid_access|API key is invalid",
    "provider_domain_error": r"domain.{0,60}not verified|invalid_from_address",
    "provider_timeout": r"timed? out|ETIMEDOUT",
    "queue_failed": r"daily.brief.{0,80}failed|Daily brief batch needs retry",
}


def summarize(raw):
    counts = collections.Counter()
    days = collections.defaultdict(collections.Counter)
    http = collections.Counter()
    rows = 0
    for line in raw.splitlines():
        try:
            obj = json.loads(line)
        except ValueError:
            continue
        if not isinstance(obj, dict):
            continue
        message = str(obj.get("message", ""))
        if not re.search(r"daily-brief|notifications", message, re.I):
            continue
        rows += 1
        timestamp = str(obj.get("timestamp", ""))
        day = timestamp[:10] if re.match(r"^\d{4}-\d{2}-\d{2}T", timestamp) else "unknown"
        for label, pattern in RULES.items():
            if re.search(pattern, message, re.I):
                counts[label] += 1
                days[day][label] += 1
        for code in re.findall(r"\bHTTP\s+(400|401|403|429|500|502|503|529)\b", message):
            http[code] += 1
    return {"matched_rows": rows, "events": dict(counts),
            "days": {day: dict(value) for day, value in days.items()},
            "provider_http_statuses": dict(http)}


def cli(args):
    # Capture both streams: a CLI error must not leak raw logs or environment.
    try:
        p = subprocess.run(["railway", *args], capture_output=True, text=True, timeout=90)
    except subprocess.TimeoutExpired:
        return None, "cli_timeout"
    if p.returncode:
        error = p.stderr + p.stdout
        if re.search(r"unauthorized|not authorized|invalid token", error, re.I):
            return None, "railway_authorization_failed"
        if re.search(r"unexpected argument|unrecognized|invalid value", error, re.I):
            return None, "cli_argument_error"
        return None, "cli_failed"
    return p.stdout, None


def main():
    service = os.environ.get("RAILWAY_SERVICE_ID", "")
    if not service or not os.environ.get("RAILWAY_TOKEN"):
        raise SystemExit("Required Railway connection is not configured")
    raw, error = cli(["deployment", "list", "--service", service, "--limit", "12", "--json"])
    if error:
        print(json.dumps({"deployment_list_error": error}))
        return 1
    try:
        deployments = json.loads(raw)
    except ValueError:
        print('{"deployment_list_error":"invalid_json"}')
        return 1
    if not isinstance(deployments, list):
        print('{"deployment_list_error":"unexpected_shape"}')
        return 1
    cutoff = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=8)
    inspected = 0
    for d in deployments:
        deployment = str(d.get("id", ""))
        if not re.fullmatch(r"[a-fA-F0-9-]{36}", deployment):
            continue
        created = str(d.get("createdAt", ""))
        try:
            if datetime.datetime.fromisoformat(created.replace("Z", "+00:00")) < cutoff:
                continue
        except ValueError:
            pass
        raw, error = cli(["logs", deployment, "--service", service, "--since", "8d",
                          "--lines", "1500", "--filter", '"daily-brief" OR "notifications"', "--json"])
        report = {"deployment": deployment, "created_date": created[:10] if re.match(r"^\d{4}-\d{2}-\d{2}", created) else "unknown"}
        report.update({"log_error": error} if error else summarize(raw))
        print(json.dumps(report), flush=True)
        inspected += 1
    print(json.dumps({"deployments_inspected": inspected, "read_only": True}))
    return 0 if inspected else 1


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        fixture = "\n".join(json.dumps({"timestamp": "2026-11-12T11:00:00Z", "message": m}) for m in [
            "[daily-brief] Failed for private@example.com at send stage — Error: daily quota exceeded secret-value",
            "[daily-brief] Sent to other@example.com — id: private-id",
            "[daily-brief] Local-time scheduler failed: column time_zone does not exist",
        ])
        result = summarize(fixture)
        assert result["events"]["recipient_send_failed"] == 1
        assert result["events"]["provider_daily_quota"] == 1
        assert result["events"]["database_missing_column"] == 1
        assert result["events"]["recipient_sent"] == 1
        assert "@" not in json.dumps(result) and "secret-value" not in json.dumps(result)
        print("Diagnostic summarizer passed privacy and classification checks")
    else:
        sys.exit(main())
