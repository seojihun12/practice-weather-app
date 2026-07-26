import pytest

import backend.history as history


@pytest.fixture(autouse=True)
def isolated_db(tmp_path, monkeypatch):
    monkeypatch.setattr(history, "DB_PATH", tmp_path / "test_observations.db")


def test_record_and_get_observations_roundtrip():
    history.record_observation(60, 127, "20260726", 9, 22.5, 0)
    history.record_observation(60, 127, "20260726", 10, 23.0, 1)

    rows = history.get_observations(60, 127, "20260726", [9, 10, 11])
    by_hour = {r["hour"]: r for r in rows}

    assert set(by_hour.keys()) == {9, 10}
    assert by_hour[9]["temp"] == 22.5
    assert by_hour[9]["pty"] == 0
    assert by_hour[10]["temp"] == 23.0
    assert by_hour[10]["pty"] == 1


def test_record_observation_upserts_same_hour():
    history.record_observation(60, 127, "20260726", 9, 20.0, 0)
    history.record_observation(60, 127, "20260726", 9, 21.5, 1)  # 같은 시간 재기록 -> 덮어써야 함

    rows = history.get_observations(60, 127, "20260726", [9])
    assert len(rows) == 1
    assert rows[0]["temp"] == 21.5
    assert rows[0]["pty"] == 1


def test_get_observations_scoped_by_grid_and_date():
    history.record_observation(60, 127, "20260726", 9, 22.0, 0)
    history.record_observation(98, 76, "20260726", 9, 30.0, 0)  # 다른 지역
    history.record_observation(60, 127, "20260727", 9, 15.0, 0)  # 다른 날짜

    rows = history.get_observations(60, 127, "20260726", [9])
    assert len(rows) == 1
    assert rows[0]["temp"] == 22.0


def test_get_observations_empty_hours_returns_empty_list():
    assert history.get_observations(60, 127, "20260726", []) == []
