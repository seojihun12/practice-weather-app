import sqlite3
from pathlib import Path

# 검색할 때마다 그 순간의 기상청 실황을 기록해둠 -> 오늘 지나간 시간대를 조회할 때
# 예보 API엔 없는 그 시점의 실제 관측값을 대신 보여줄 수 있음. 스케줄러 없이 검색 시점에만
# 기록하므로 Render 무료 티어처럼 유휴 시 슬립되는 환경에서도 그대로 동작함.
DB_PATH = Path(__file__).parent / "observations.db"


def _get_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS observations (
            nx INTEGER NOT NULL,
            ny INTEGER NOT NULL,
            date TEXT NOT NULL,
            hour INTEGER NOT NULL,
            temp REAL,
            pty INTEGER,
            PRIMARY KEY (nx, ny, date, hour)
        )
        """
    )
    return conn


def record_observation(nx: int, ny: int, date: str, hour: int, temp: float, pty: int) -> None:
    conn = _get_conn()
    with conn:
        conn.execute(
            """
            INSERT INTO observations (nx, ny, date, hour, temp, pty) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(nx, ny, date, hour) DO UPDATE SET temp = excluded.temp, pty = excluded.pty
            """,
            (nx, ny, date, hour, temp, pty),
        )
    conn.close()


def get_observations(nx: int, ny: int, date: str, hours) -> list:
    hours = list(hours)
    if not hours:
        return []
    conn = _get_conn()
    placeholders = ",".join("?" * len(hours))
    rows = conn.execute(
        f"SELECT hour, temp, pty FROM observations WHERE nx = ? AND ny = ? AND date = ? AND hour IN ({placeholders})",
        (nx, ny, date, *hours),
    ).fetchall()
    conn.close()
    return [{"hour": h, "temp": t, "pty": p} for h, t, p in rows]
