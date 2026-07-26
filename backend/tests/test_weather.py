import httpx
import pytest

import backend.history as history
from backend.weather import (
    _kma_forecast_cache,
    _kma_now_cache,
    _open_meteo_cache,
    build_kma_day_timeline,
    describe_kma_pty,
    describe_kma_sky,
    describe_weather_code,
    fetch_kma,
    fetch_kma_forecast,
    fetch_open_meteo,
    format_day_label,
    lat_lon_to_kma_grid,
    record_observation,
    summarize_kma_period,
    summarize_observed_period,
    summarize_period,
)


@pytest.fixture(autouse=True)
def clear_caches(tmp_path, monkeypatch):
    # observations.db도 테스트마다 임시 경로로 격리해서 실제 운영 데이터를 건드리지 않게 함
    monkeypatch.setattr(history, "DB_PATH", tmp_path / "test_observations.db")
    _kma_now_cache.clear()
    _open_meteo_cache.clear()
    _kma_forecast_cache.clear()
    yield
    _kma_now_cache.clear()
    _open_meteo_cache.clear()
    _kma_forecast_cache.clear()


def test_lat_lon_to_kma_grid_seoul():
    # 서울시청 좌표 -> 기상청 공식 격자값(nx=60, ny=127)
    assert lat_lon_to_kma_grid(37.5665, 126.9780) == (60, 127)


def test_lat_lon_to_kma_grid_busan():
    assert lat_lon_to_kma_grid(35.1796, 129.0756) == (98, 76)


def test_describe_weather_code_known_and_unknown():
    assert describe_weather_code(0) == "맑음"
    assert describe_weather_code(9999) == "-"


def test_describe_kma_pty_known_and_unknown():
    assert describe_kma_pty(1) == "비"
    assert describe_kma_pty(4) == "소나기"  # 실제 응답에서 자주 나오는 코드라 누락되면 desc가 "-"로 깨짐
    assert describe_kma_pty(999) == "-"


def test_describe_kma_sky_known_and_unknown():
    assert describe_kma_sky(4) == "흐림"
    assert describe_kma_sky(999) == "-"


def test_format_day_label_today_and_tomorrow():
    assert format_day_label("2026-07-26", 0) == "오늘"
    assert format_day_label("2026-07-27", 1) == "내일"


def test_format_day_label_weekday_matches_js_convention():
    # 2026-07-26은 일요일, 2026-07-28은 화요일
    assert format_day_label("2026-07-26", 5) == "7/26 (일)"
    assert format_day_label("2026-07-28", 5) == "7/28 (화)"


def test_summarize_period_picks_strongest_rain_code():
    hours = [
        {"temp": 20.0, "code": 1, "pop": 10},
        {"temp": 25.0, "code": 61, "pop": 40},
        {"temp": 22.0, "code": 65, "pop": 80},
    ]
    result = summarize_period(hours)
    assert result["max"] == 25.0
    assert result["min"] == 20.0
    assert result["pop"] == 80
    assert result["hasRain"] is True
    assert result["desc"] == describe_weather_code(65)


def test_summarize_period_empty_returns_none():
    assert summarize_period([]) is None


def test_summarize_kma_period_picks_rain_over_sky():
    readings = [
        {"temp": 20.0, "sky": 1, "pty": 0, "pop": 10},
        {"temp": 25.0, "sky": 4, "pty": 1, "pop": 60},
    ]
    result = summarize_kma_period(readings)
    assert result["max"] == 25.0
    assert result["min"] == 20.0
    assert result["pop"] == 60
    assert result["hasRain"] is True
    assert result["desc"] == describe_kma_pty(1)


def test_summarize_kma_period_no_rain_picks_cloudiest_sky():
    readings = [
        {"temp": 18.0, "sky": 1, "pty": 0, "pop": 5},
        {"temp": 20.0, "sky": 3, "pty": 0, "pop": 5},
    ]
    result = summarize_kma_period(readings)
    assert result["hasRain"] is False
    assert result["desc"] == describe_kma_sky(3)


def test_summarize_kma_period_empty_returns_none():
    assert summarize_kma_period([]) is None


def test_build_kma_day_timeline_buckets_by_hour():
    by_time = {
        "0000": {"temp": 10.0, "sky": 1, "pty": 0, "pop": 0},
        "0900": {"temp": 20.0, "sky": 1, "pty": 0, "pop": 0},
        "1500": {"temp": 28.0, "sky": 4, "pty": 1, "pop": 70},
        "2100": {"temp": 18.0, "sky": 3, "pty": 0, "pop": 10},
    }
    timeline = build_kma_day_timeline(by_time, "오늘", 60, 127, "20260726")
    assert timeline["label"] == "오늘"

    periods = {p["label"]: p for p in timeline["periods"]}
    assert periods["새벽"]["max"] == 10.0
    assert periods["오전"]["max"] == 20.0
    assert periods["오후"]["desc"] == describe_kma_pty(1)
    assert periods["저녁"]["max"] == 18.0


def test_summarize_observed_period_uses_strongest_pty():
    observed = [
        {"hour": 8, "temp": 19.0, "pty": 0},
        {"hour": 9, "temp": 21.0, "pty": 4},
    ]
    result = summarize_observed_period(observed)
    assert result["max"] == 21.0
    assert result["min"] == 19.0
    assert result["pop"] == 0  # 실황엔 강수확률 개념이 없어서 항상 0
    assert result["hasRain"] is True
    assert result["desc"] == describe_kma_pty(4)


def test_summarize_observed_period_empty_returns_none():
    assert summarize_observed_period([]) is None


def test_build_kma_day_timeline_falls_back_to_recorded_observation():
    # 예보 데이터가 전혀 없는 날 -> 오전 구간은 미리 기록해둔 실황으로 채워지고,
    # 기록이 없는 새벽 구간은 그대로 "-" 이어야 함
    record_observation(60, 127, "20260726", 8, 19.5, 0)

    timeline = build_kma_day_timeline({}, "오늘", 60, 127, "20260726")
    periods = {p["label"]: p for p in timeline["periods"]}

    assert periods["오전"]["max"] == 19.5
    assert periods["오전"]["min"] == 19.5
    assert periods["오전"]["desc"] == describe_kma_pty(0)
    assert periods["오전"]["pop"] == 0
    assert periods["새벽"]["desc"] == "-"


KMA_NCST_RESPONSE = {
    "response": {
        "header": {"resultCode": "00", "resultMsg": "OK"},
        "body": {
            "items": {
                "item": [
                    {"category": "T1H", "obsrValue": "23.4"},
                    {"category": "REH", "obsrValue": "55"},
                    {"category": "WSD", "obsrValue": "2.1"},
                    {"category": "PTY", "obsrValue": "0"},
                ]
            }
        },
    }
}


@pytest.mark.asyncio
async def test_fetch_kma_parses_response_and_caches(respx_mock):
    route = respx_mock.get(
        url__regex=r"https://apis\.data\.go\.kr/1360000/VilageFcstInfoService_2\.0/getUltraSrtNcst.*"
    ).mock(return_value=httpx.Response(200, json=KMA_NCST_RESPONSE))

    async with httpx.AsyncClient() as client:
        result = await fetch_kma(client, 60, 127, "dummy-key")
        assert result == {
            "temp": "23.4°C",
            "humidity": "55%",
            "wind": "7.6 km/h",
            "desc": "강수 없음",
        }

        # 같은 좌표로 다시 조회하면 캐시 히트라서 목 서버는 한 번만 호출돼야 함
        await fetch_kma(client, 60, 127, "dummy-key")
        assert route.call_count == 1


OPEN_METEO_RESPONSE = {
    "current": {
        "time": "2026-07-26T10:00",
        "temperature_2m": 28.5,
        "apparent_temperature": 30.1,
        "relative_humidity_2m": 60,
        "wind_speed_10m": 10.2,
    },
    "daily": {
        "time": ["2026-07-26", "2026-07-27"],
        "weather_code": [1, 61],
        "temperature_2m_max": [31.0, 29.0],
        "temperature_2m_min": [24.0, 23.0],
    },
    "hourly": {
        "time": ["2026-07-26T09:00", "2026-07-26T10:00", "2026-07-26T11:00", "2026-07-27T09:00"],
        "temperature_2m": [27.0, 28.5, 29.0, 26.0],
        "weather_code": [1, 1, 2, 61],
        "precipitation_probability": [10, 15, 20, 50],
    },
}


@pytest.mark.asyncio
async def test_fetch_open_meteo_parses_response_and_caches(respx_mock):
    route = respx_mock.get(url__regex=r"https://api\.open-meteo\.com/v1/forecast.*").mock(
        return_value=httpx.Response(200, json=OPEN_METEO_RESPONSE)
    )

    async with httpx.AsyncClient() as client:
        result = await fetch_open_meteo(client, 37.5665, 126.9780)
        assert result["temp"] == "28.5°C"
        assert result["feelsLike"] == "30.1°C"
        assert result["humidity"] == "60%"
        assert result["wind"] == "10.2 km/h"
        assert result["forecast"][0]["max"] == 31.0
        assert result["forecast"][0]["desc"] == describe_weather_code(1)

        # 같은 좌표(반올림 기준)로 다시 조회하면 캐시 히트
        await fetch_open_meteo(client, 37.5665, 126.9780)
        assert route.call_count == 1


def _vilage_fcst_items(date, readings, tmn, tmx):
    items = []
    for time_, values in readings.items():
        for category, value in values.items():
            items.append({"fcstDate": date, "fcstTime": time_, "category": category, "fcstValue": str(value)})
    items.append({"fcstDate": date, "fcstTime": "0600", "category": "TMN", "fcstValue": str(tmn)})
    items.append({"fcstDate": date, "fcstTime": "1500", "category": "TMX", "fcstValue": str(tmx)})
    return items


VILAGE_FCST_RESPONSE = {
    "response": {
        "header": {"resultCode": "00", "resultMsg": "OK"},
        "body": {
            "items": {
                "item": (
                    _vilage_fcst_items(
                        "20260726",
                        {
                            "0900": {"TMP": 22, "SKY": 1, "PTY": 0, "POP": 20},
                            "1500": {"TMP": 27, "SKY": 4, "PTY": 1, "POP": 60},
                        },
                        tmn=17,
                        tmx=27,
                    )
                    + _vilage_fcst_items(
                        "20260727",
                        {"0900": {"TMP": 20, "SKY": 1, "PTY": 0, "POP": 10}},
                        tmn=15,
                        tmx=24,
                    )
                )
            }
        },
    }
}


@pytest.mark.asyncio
async def test_fetch_kma_forecast_builds_day_timelines_and_caches(respx_mock):
    route = respx_mock.get(
        url__regex=r"https://apis\.data\.go\.kr/1360000/VilageFcstInfoService_2\.0/getVilageFcst.*"
    ).mock(return_value=httpx.Response(200, json=VILAGE_FCST_RESPONSE))

    async with httpx.AsyncClient() as client:
        result = await fetch_kma_forecast(client, 60, 127, "dummy-key")

        assert [d["dateKey"] for d in result["days"]] == ["20260726", "20260727"]

        today_periods = {p["label"]: p for p in result["dayTimelines"][0]["periods"]}
        assert result["dayTimelines"][0]["label"] == "오늘"
        assert today_periods["새벽"]["desc"] == "-"  # 이 구간엔 데이터가 없음
        assert today_periods["오전"]["max"] == 22.0
        assert today_periods["오후"]["desc"] == describe_kma_pty(1)
        assert today_periods["오후"]["pop"] == 60

        # 같은 좌표로 다시 조회하면 캐시 히트라서 목 서버는 한 번만 호출돼야 함
        await fetch_kma_forecast(client, 60, 127, "dummy-key")
        assert route.call_count == 1
