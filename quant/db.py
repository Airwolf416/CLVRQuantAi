import asyncpg
import json
from .config import DATABASE_URL

_pool = None


async def pool():
    global _pool
    if _pool is None and DATABASE_URL:
        _pool = await asyncpg.create_pool(DATABASE_URL, min_size=1, max_size=4)
    return _pool


async def log_quant_score(row: dict):
    p = await pool()
    if p is None:
        return
    try:
        async with p.acquire() as c:
            await c.execute("""
                insert into quant_scores
                (symbol, composite_z, side, regime, passes, gates_failed, factors, ts)
                values ($1,$2,$3,$4,$5,$6,$7, now())
            """, row["symbol"], row["composite_z"], row["side"], row["regime"],
                 row["passes"], row["gates_failed"], json.dumps(row["factors"]))
    except Exception:
        pass


async def log_microstructure(row: dict):
    p = await pool()
    if p is None:
        return
    try:
        async with p.acquire() as c:
            await c.execute("""
                insert into microstructure_snapshots
                (symbol, mid, obi, wobi, cvd, cvd_z, ofi_1m, ofi_z, funding, oi, ts)
                values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
            """, row["symbol"], row["mid"], row["obi"], row["wobi"],
                 row["cvd"], row["cvd_z"], row["ofi_1m"], row["ofi_z"],
                 row["funding"], row["oi"])
    except Exception:
        pass
