#!/usr/bin/env python3
"""Dry-run-first cleanup for accounts with a recorded login older than 90 days.

Use CLEANUP_DATABASE_URL, never DATABASE_URL, so local tests cannot silently
target production. Deletion requires --execute and a confirmation phrase.
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
import asyncpg
import httpx

CONFIRM_PHRASE = "DELETE-INACTIVE-90-DAY-ACCOUNTS"
USER_REFERENCE_COLUMNS = (
    "user_id",
    "owner_user_id",
    "created_by_user_id",
    "referrer_user_id",
    "referred_user_id",
    "target_user_id",
)
DEFAULT_FROM = "CLVRQuant <hello@clvrquantai.com>"


def quote_identifier(value: str) -> str:
    """Quote an identifier returned by PostgreSQL catalog metadata."""
    return '"' + value.replace('"', '""') + '"'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--days", type=int, default=90)
    parser.add_argument("--limit", type=int, help="Limit the batch for a cautious first run.")
    parser.add_argument("--execute", action="store_true", help="Actually email and delete eligible accounts.")
    parser.add_argument("--confirm", help=f"Required with --execute: {CONFIRM_PHRASE}")
    args = parser.parse_args()
    if args.days < 1:
        parser.error("--days must be positive")
    if args.limit is not None and args.limit < 1:
        parser.error("--limit must be positive")
    if args.execute and args.confirm != CONFIRM_PHRASE:
        parser.error(f"--execute requires --confirm {CONFIRM_PHRASE}")
    return args


async def send_removal_notice(
    client: httpx.AsyncClient, email: str, name: str, days: int
) -> None:
    api_key = os.environ["RESEND_API_KEY"]
    from_email = os.environ.get("RESEND_FROM_EMAIL", DEFAULT_FROM)
    response = await client.post(
        "https://api.resend.com/emails",
        headers={"Authorization": f"Bearer {api_key}"},
        json={
            "from": from_email,
            "to": [email],
            "subject": "Your CLVRQuant account has been removed",
            "text": (
                f"Hello {name or 'there'},\n\n"
                "Your CLVRQuant account has been removed because it had no recorded "
                f"login for at least {days} days. Associated account data has also been "
                "removed, subject to records we must retain by law.\n\n"
                "If you believe this was a mistake, contact Support@CLVRQuantAI.com.\n\n"
                "CLVRQuant Support"
            ),
        },
        timeout=20,
    )
    response.raise_for_status()


async def eligible_users(
    conn: asyncpg.Connection, days: int, limit: int | None
) -> list[asyncpg.Record]:
    query = """
        SELECT u.id, u.email, u.name, u.last_login_at
          FROM users u
         WHERE u.last_login_at IS NOT NULL
           AND u.last_login_at <= NOW() - ($1::int * INTERVAL '1 day')
           AND COALESCE(u.is_admin, false) = false
           AND LOWER(COALESCE(u.tier, 'free')) = 'free'
           AND u.stripe_subscription_id IS NULL
           AND NOT EXISTS (
               SELECT 1 FROM concierge_bookings b
                WHERE b.user_id = u.id AND b.price_usd > 0
           )
         ORDER BY u.last_login_at ASC
    """
    if limit is not None:
        query += " LIMIT $2"
        return await conn.fetch(query, days, limit)
    return await conn.fetch(query, days)


async def delete_user_data(
    conn: asyncpg.Connection,
    client: httpx.AsyncClient,
    user: asyncpg.Record,
    days: int,
) -> bool:
    """Lock, re-check, notify, and delete an account and its soft-linked rows."""
    user_id = user["id"]
    async with conn.transaction():
        locked = await conn.fetchrow(
            """
            SELECT u.id, u.email, u.name
              FROM users u
             WHERE u.id = $1
               AND u.last_login_at IS NOT NULL
               AND u.last_login_at <= NOW() - ($2::int * INTERVAL '1 day')
               AND COALESCE(u.is_admin, false) = false
               AND LOWER(COALESCE(u.tier, 'free')) = 'free'
               AND u.stripe_subscription_id IS NULL
               AND NOT EXISTS (
                   SELECT 1 FROM concierge_bookings b
                    WHERE b.user_id = u.id AND b.price_usd > 0
               )
             FOR UPDATE
            """,
            user_id,
            days,
        )
        if not locked:
            return False

        # Hold the user row lock through notification and deletion so a
        # concurrent login cannot make a selected account ineligible mid-run.
        await send_removal_notice(client, locked["email"], locked["name"] or "", days)

        # Support messages have no direct user_id; remove them through the
        # account's support threads before deleting those threads.
        await conn.execute(
            """DELETE FROM support_messages
                WHERE thread_id IN (SELECT id FROM support_threads WHERE user_id = $1)""",
            user_id,
        )

        # Session JSON and account-adjacent records use non-FK references.
        await conn.execute("DELETE FROM user_sessions WHERE sess ->> 'userId' = $1", user_id)
        await conn.execute("DELETE FROM subscribers WHERE LOWER(email) = LOWER($1)", locked["email"])
        await conn.execute(
            "UPDATE access_codes SET used_by = NULL, used_at = NULL WHERE used_by = $1",
            user_id,
        )
        await conn.execute(
            """UPDATE users
                  SET referred_by = NULL
                WHERE referred_by = (SELECT referral_code FROM users WHERE id = $1)""",
            user_id,
        )

        references = await conn.fetch(
            """
            SELECT c.table_name, c.column_name
              FROM information_schema.columns c
              JOIN information_schema.tables t
                ON t.table_schema = c.table_schema AND t.table_name = c.table_name
             WHERE c.table_schema = current_schema()
               AND c.table_name <> 'users'
               AND t.table_type = 'BASE TABLE'
               AND c.column_name = ANY($1::text[])
             ORDER BY c.table_name, c.column_name
            """,
            list(USER_REFERENCE_COLUMNS),
        )
        for ref in references:
            table = quote_identifier(ref["table_name"])
            column = quote_identifier(ref["column_name"])
            await conn.execute(f"DELETE FROM {table} WHERE {column} = $1", user_id)

        deleted = await conn.execute("DELETE FROM users WHERE id = $1", user_id)
        return deleted.endswith("1")


async def main() -> int:
    args = parse_args()
    database_url = os.environ.get("CLEANUP_DATABASE_URL")
    if not database_url:
        print("Missing CLEANUP_DATABASE_URL; refusing to use DATABASE_URL implicitly.", file=sys.stderr)
        return 2
    if args.execute and not os.environ.get("RESEND_API_KEY"):
        print("Missing RESEND_API_KEY; no accounts were changed.", file=sys.stderr)
        return 2

    conn = await asyncpg.connect(database_url, command_timeout=60)
    try:
        unknown = await conn.fetchval("SELECT COUNT(*) FROM users WHERE last_login_at IS NULL")
        candidates = await eligible_users(conn, args.days, args.limit)
        print(f"Eligible accounts: {len(candidates)}; accounts with unknown login history retained: {unknown}.")
        for user in candidates:
            print(f"{user['id']} | {user['email']} | last login {user['last_login_at'].isoformat()}")
        if not args.execute:
            print("DRY RUN: no email sent and no data deleted. Add --execute and the confirmation phrase to proceed.")
            return 0

        sent = removed = skipped = 0
        async with httpx.AsyncClient() as client:
            for user in candidates:
                try:
                    # A failed notice raises before any database deletion.
                    if await delete_user_data(conn, client, user, args.days):
                        sent += 1
                        removed += 1
                    else:
                        skipped += 1
                        print(f"Skipped {user['id']}: eligibility changed before deletion.")
                    await asyncio.sleep(0.6)
                except Exception as exc:
                    skipped += 1
                    print(f"Skipped {user['id']}: email/deletion error: {exc}", file=sys.stderr)
        print(f"Finished: notices sent={sent}, accounts removed={removed}, skipped={skipped}.")
        return 0 if skipped == 0 else 1
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
