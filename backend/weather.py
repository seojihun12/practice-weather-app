import asyncio
import logging
import math
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx
from cachetools import TTLCache

logger = logging.getLogger(__name__)

# ---- 날씨 코드 -> 한글 설명 매핑 (src/constants.js와 동일) ----
WEATHER_CODES = {
    0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림",
    45: "안개", 48: "짙은 안개",
    51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
    61: "약한 비", 63: "비", 65: "강한 비",
    71: "약한 눈", 73: "눈", 75: "폭설",
    80: "약한 소나기", 81: "소나기", 82: "강한 소나기",
    95: "뇌우", 96: "우박 동반 뇌우", 99: "강한 우박 동반 뇌우",
}


def describe_weather_code(code):
    return WEATHER_CODES.get(code, "-")


KMA_PTY_CODES = {0: "강수 없음", 1: "비", 2: "비/눈", 3: "눈", 4: "소나기", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림"}


def describe_kma_pty(code):
    return KMA_PTY_CODES.get(code, "-")


KMA_SKY_CODES = {1: "맑음", 3: "구름 많음", 4: "흐림"}


def describe_kma_sky(code):
    return KMA_SKY_CODES.get(code, "-")


DAY_PERIODS = [
    {"key": "dawn", "label": "새벽", "from": 0, "to": 6},
    {"key": "morning", "label": "오전", "from": 6, "to": 12},
    {"key": "afternoon", "label": "오후", "from": 12, "to": 18},
    {"key": "evening", "label": "저녁", "from": 18, "to": 24},
]


def format_day_label(date_str, index):
    if index == 0:
        return "오늘"
    if index == 1:
        return "내일"
    days = ["일", "월", "화", "수", "목", "금", "토"]
    d = datetime.strptime(date_str, "%Y-%m-%d")
    js_day = (d.weekday() + 1) % 7  # Python: 월=0 -> JS 기준(일=0)으로 변환
    return f"{d.month}/{d.day} ({days[js_day]})"


def format_hour_label(time_str, index):
    if index == 0:
        return "지금"
    hour = int(time_str[11:13])
    return f"{hour}시"


def _pad(n):
    return f"{n:02d}"


# ---- 소스 1: Open-Meteo (키 불필요, 전세계 지원) ----
_open_meteo_cache = TTLCache(maxsize=256, ttl=600)  # 10분


def summarize_period(hours):
    if not hours:
        return None
    temps = [h["temp"] for h in hours]
    pop = max((h.get("pop") or 0) for h in hours)
    rain_codes = [h["code"] for h in hours if h["code"] >= 51]
    rep_code = max(rain_codes) if rain_codes else hours[len(hours) // 2]["code"]
    return {
        "desc": describe_weather_code(rep_code),
        "max": max(temps),
        "min": min(temps),
        "pop": round(pop),
        "hasRain": len(rain_codes) > 0,
    }


def build_day_timeline(hourly, date_str, label):
    buckets = {"dawn": [], "morning": [], "afternoon": [], "evening": []}
    for i, t in enumerate(hourly["time"]):
        if not t.startswith(date_str):
            continue
        hour = int(t[11:13])
        item = {
            "temp": hourly["temperature_2m"][i],
            "code": hourly["weather_code"][i],
            "pop": hourly["precipitation_probability"][i],
        }
        for p in DAY_PERIODS:
            if p["from"] <= hour < p["to"]:
                buckets[p["key"]].append(item)
                break

    periods = []
    for p in DAY_PERIODS:
        summary = summarize_period(buckets[p["key"]]) or {
            "desc": "-", "max": None, "min": None, "pop": 0, "hasRain": False,
        }
        periods.append({"label": p["label"], **summary})
    return {"label": label, "periods": periods}


async def fetch_open_meteo(client: httpx.AsyncClient, lat: float, lon: float) -> dict:
    key = (round(lat, 2), round(lon, 2))
    cached = _open_meteo_cache.get(key)
    if cached is not None:
        return cached

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m"
        "&hourly=temperature_2m,weather_code,precipitation_probability"
        "&daily=weather_code,temperature_2m_max,temperature_2m_min"
        "&timezone=auto&forecast_days=7"
    )
    res = await client.get(url)
    data = res.json()
    current = data["current"]
    daily = data["daily"]
    hourly = data["hourly"]

    forecast = [
        {
            "dateKey": date.replace("-", ""),
            "label": format_day_label(date, i),
            "desc": describe_weather_code(daily["weather_code"][i]),
            "max": daily["temperature_2m_max"][i],
            "min": daily["temperature_2m_min"][i],
        }
        for i, date in enumerate(daily["time"])
    ]

    # 현재 시각과 같은 "정시"부터 앞으로 12시간치를 뽑아옴
    current_hour_str = current["time"][:14] + "00"
    try:
        start_idx = hourly["time"].index(current_hour_str)
    except ValueError:
        start_idx = 0

    hourly_forecast = []
    for i, t in enumerate(hourly["time"][start_idx:start_idx + 12]):
        idx = start_idx + i
        hourly_forecast.append({
            "hour": int(t[11:13]),
            "label": format_hour_label(t, i),
            "temp": hourly["temperature_2m"][idx],
            "desc": describe_weather_code(hourly["weather_code"][idx]),
            "pop": hourly["precipitation_probability"][idx],
        })

    day_timelines = [
        build_day_timeline(hourly, daily["time"][0], "오늘"),
        build_day_timeline(hourly, daily["time"][1], "내일"),
    ]

    result = {
        "temp": f"{current['temperature_2m']}°C",
        "feelsLike": f"{current['apparent_temperature']}°C",
        "humidity": f"{current['relative_humidity_2m']}%",
        "wind": f"{current['wind_speed_10m']} km/h",
        "forecast": forecast,
        "hourlyForecast": hourly_forecast,
        "dayTimelines": day_timelines,
    }
    _open_meteo_cache[key] = result
    return result


# ---- 소스 2: 기상청 (위경도 -> 격자좌표 변환 필요) ----
# KMA 공식 변환식 (Lambert Conformal Conic). 위경도를 기상청 격자 nx, ny로 바꿔줌.
def lat_lon_to_kma_grid(lat: float, lon: float) -> tuple[int, int]:
    RE, GRID, SLAT1, SLAT2, OLON, OLAT, XO, YO = 6371.00877, 5.0, 30.0, 60.0, 126.0, 38.0, 43, 136
    DEGRAD = math.pi / 180.0
    re = RE / GRID
    slat1 = SLAT1 * DEGRAD
    slat2 = SLAT2 * DEGRAD
    olon = OLON * DEGRAD
    olat = OLAT * DEGRAD

    sn = math.tan(math.pi * 0.25 + slat2 * 0.5) / math.tan(math.pi * 0.25 + slat1 * 0.5)
    sn = math.log(math.cos(slat1) / math.cos(slat2)) / math.log(sn)
    sf = math.tan(math.pi * 0.25 + slat1 * 0.5)
    sf = (sf ** sn) * math.cos(slat1) / sn
    ro = math.tan(math.pi * 0.25 + olat * 0.5)
    ro = (re * sf) / (ro ** sn)

    ra = math.tan(math.pi * 0.25 + (lat * DEGRAD) * 0.5)
    ra = (re * sf) / (ra ** sn)
    theta = lon * DEGRAD - olon
    if theta > math.pi:
        theta -= 2.0 * math.pi
    if theta < -math.pi:
        theta += 2.0 * math.pi
    theta *= sn

    nx = math.floor(ra * math.sin(theta) + XO + 0.5)
    ny = math.floor(ro - ra * math.cos(theta) + YO + 0.5)
    return int(nx), int(ny)


# getUltraSrtNcst(초단기실황)는 매시 40분에 그 시각 관측값이 올라옴 -> 40분 이전이면 한 시간 전 값을 요청해야 함
def get_kma_base_date_time() -> tuple[str, str]:
    now = datetime.now()
    if now.minute < 40:
        now -= timedelta(hours=1)
    return f"{now.year}{_pad(now.month)}{_pad(now.day)}", f"{_pad(now.hour)}00"


# getUltraSrtFcst(초단기예보)는 매시 30분에 발표되고 10분 뒤(매시 40분)부터 조회 가능
def get_ultra_srt_fcst_base_date_time() -> tuple[str, str]:
    now = datetime.now()
    if now.minute < 40:
        now -= timedelta(hours=1)
    return f"{now.year}{_pad(now.month)}{_pad(now.day)}", f"{_pad(now.hour)}30"


# getVilageFcst(단기예보)는 하루 8번(02,05,08,11,14,17,20,23시) 발표되고, 발표 후 약 10분 뒤부터 조회 가능
def get_vilage_fcst_base_date_time() -> tuple[str, str]:
    issue_times = [2, 5, 8, 11, 14, 17, 20, 23]
    now = datetime.now() - timedelta(minutes=10)
    chosen = None
    for h in issue_times:
        if h <= now.hour:
            chosen = h
    if chosen is None:
        now -= timedelta(days=1)
        chosen = 23
    return f"{now.year}{_pad(now.month)}{_pad(now.day)}", f"{_pad(chosen)}00"


def _kma_error(data, fallback):
    header = (data.get("response") or {}).get("header")
    if not header or header.get("resultCode") != "00":
        return {"error": (header or {}).get("resultMsg", fallback)}
    return None


# 기상청 초단기실황(현재 관측값) 조회. base_time이 바뀌는 최대 1시간까지 캐시.
_kma_now_cache = TTLCache(maxsize=256, ttl=3600)


async def fetch_kma(client: httpx.AsyncClient, nx: int, ny: int, kma_key: str) -> dict:
    key = (nx, ny)
    cached = _kma_now_cache.get(key)
    if cached is not None:
        return cached

    base_date, base_time = get_kma_base_date_time()
    url = (
        "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst"
        f"?serviceKey={quote(kma_key, safe='')}&pageNo=1&numOfRows=20&dataType=JSON"
        f"&base_date={base_date}&base_time={base_time}&nx={nx}&ny={ny}"
    )
    res = await client.get(url)
    try:
        data = res.json()
    except ValueError:
        return {"error": "응답 형식 오류 (국내 지역이 아닐 수 있어요)"}

    err = _kma_error(data, "조회 실패")
    if err:
        return err

    items = data["response"]["body"]["items"]["item"]
    by_category = {it["category"]: it["obsrValue"] for it in items}

    # T1H: 기온(°C), REH: 습도(%), WSD: 풍속(m/s, km/h로 환산해서 사용), PTY: 강수형태 코드
    result = {
        "temp": f"{by_category['T1H']}°C" if "T1H" in by_category else "-",
        "humidity": f"{by_category['REH']}%" if "REH" in by_category else "-",
        "wind": f"{float(by_category['WSD']) * 3.6:.1f} km/h" if "WSD" in by_category else "-",
        "desc": describe_kma_pty(int(float(by_category.get("PTY", 0)))),
    }
    _kma_now_cache[key] = result
    return result


# 기상청 초단기예보: 1시간 간격 최대 6시간. 30분마다 새로 발표되므로 그만큼 캐시.
_kma_hourly_cache = TTLCache(maxsize=256, ttl=1800)


async def fetch_kma_hourly(client: httpx.AsyncClient, nx: int, ny: int, kma_key: str) -> dict:
    key = (nx, ny)
    cached = _kma_hourly_cache.get(key)
    if cached is not None:
        return cached

    base_date, base_time = get_ultra_srt_fcst_base_date_time()
    url = (
        "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtFcst"
        f"?serviceKey={quote(kma_key, safe='')}&pageNo=1&numOfRows=100&dataType=JSON"
        f"&base_date={base_date}&base_time={base_time}&nx={nx}&ny={ny}"
    )
    res = await client.get(url)
    try:
        data = res.json()
    except ValueError:
        return {"error": "응답 형식 오류"}

    err = _kma_error(data, "조회 실패")
    if err:
        return err

    items = data["response"]["body"]["items"]["item"]
    by_time: dict[str, dict] = {}
    for it in items:
        t = by_time.setdefault(it["fcstTime"], {})
        # T1H: 기온(°C), SKY: 하늘상태 코드, PTY: 강수형태 코드
        if it["category"] == "T1H":
            t["temp"] = float(it["fcstValue"])
        if it["category"] == "SKY":
            t["sky"] = int(float(it["fcstValue"]))
        if it["category"] == "PTY":
            t["pty"] = int(float(it["fcstValue"]))

    hours = []
    for fcst_time in sorted(by_time.keys()):
        t = by_time[fcst_time]
        pty = t.get("pty", 0)
        hours.append({
            "hour": int(fcst_time[:2]),
            "temp": t.get("temp"),
            "desc": describe_kma_pty(pty) if pty > 0 else describe_kma_sky(t.get("sky")),
        })

    result = {"hours": hours}
    _kma_hourly_cache[key] = result
    return result


# 기상청 단기예보(3시간 간격)를 Open-Meteo와 같은 4구간으로 요약. desc는 PTY(강수)가 있으면
# 그중 가장 강한 것으로, 없으면 그 구간에서 가장 흐린(SKY 값이 큰) 것으로 결정.
def summarize_kma_period(readings):
    readings = [r for r in readings if r.get("temp") is not None]
    if not readings:
        return None
    temps = [r["temp"] for r in readings]
    pop = max((r.get("pop") or 0) for r in readings)
    rain_readings = [r for r in readings if r.get("pty", 0) > 0]
    if rain_readings:
        best = max(rain_readings, key=lambda r: r["pty"])
        desc = describe_kma_pty(best["pty"])
    else:
        best = max(readings, key=lambda r: r.get("sky", 1))
        desc = describe_kma_sky(best.get("sky", 1))
    return {
        "desc": desc,
        "max": max(temps),
        "min": min(temps),
        "pop": round(pop),
        "hasRain": len(rain_readings) > 0,
    }


def build_kma_day_timeline(by_time, label):
    buckets = {"dawn": [], "morning": [], "afternoon": [], "evening": []}
    for fcst_time, reading in by_time.items():
        hour = int(fcst_time[:2])
        for p in DAY_PERIODS:
            if p["from"] <= hour < p["to"]:
                buckets[p["key"]].append(reading)
                break

    periods = []
    for p in DAY_PERIODS:
        summary = summarize_kma_period(buckets[p["key"]]) or {
            "desc": "-", "max": None, "min": None, "pop": 0, "hasRain": False,
        }
        periods.append({"label": p["label"], **summary})
    return {"label": label, "periods": periods}


# 기상청 단기예보: 최대 3일치, 3시간 간격. 하루 8번만 발표되므로 3시간 캐시.
_kma_forecast_cache = TTLCache(maxsize=256, ttl=10800)


async def fetch_kma_forecast(client: httpx.AsyncClient, nx: int, ny: int, kma_key: str) -> dict:
    key = (nx, ny)
    cached = _kma_forecast_cache.get(key)
    if cached is not None:
        return cached

    base_date, base_time = get_vilage_fcst_base_date_time()
    url = (
        "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getVilageFcst"
        f"?serviceKey={quote(kma_key, safe='')}&pageNo=1&numOfRows=1000&dataType=JSON"
        f"&base_date={base_date}&base_time={base_time}&nx={nx}&ny={ny}"
    )
    res = await client.get(url)
    try:
        data = res.json()
    except ValueError:
        return {"error": "응답 형식 오류"}

    err = _kma_error(data, "조회 실패")
    if err:
        return err

    items = data["response"]["body"]["items"]["item"]
    by_date: dict[str, dict] = {}
    for it in items:
        d = by_date.setdefault(
            it["fcstDate"],
            {"tmp": [], "sky": {}, "pty": {}, "tmn": None, "tmx": None, "by_time": {}},
        )
        t = d["by_time"].setdefault(it["fcstTime"], {})
        # TMP: 3시간 간격 기온, SKY: 하늘상태 코드, PTY: 강수형태 코드, POP: 강수확률(%), TMN/TMX: 그날의 최저/최고 기온
        if it["category"] == "TMP":
            d["tmp"].append(float(it["fcstValue"]))
            t["temp"] = float(it["fcstValue"])
        if it["category"] == "SKY":
            d["sky"][it["fcstTime"]] = it["fcstValue"]
            t["sky"] = int(float(it["fcstValue"]))
        if it["category"] == "PTY":
            d["pty"][it["fcstTime"]] = it["fcstValue"]
            t["pty"] = int(float(it["fcstValue"]))
        if it["category"] == "POP":
            t["pop"] = float(it["fcstValue"])
        if it["category"] == "TMN":
            d["tmn"] = float(it["fcstValue"])
        if it["category"] == "TMX":
            d["tmx"] = float(it["fcstValue"])

    sorted_dates = sorted(by_date.keys())
    days = []
    for date_key in sorted_dates:
        d = by_date[date_key]
        times = sorted(d["sky"].keys())
        mid_time = next((t for t in times if t >= "1200"), (times[-1] if times else None))
        sky_code = int(float(d["sky"].get(mid_time, 1))) if mid_time else 1
        pty_code = int(float(d["pty"].get(mid_time, 0))) if mid_time else 0
        desc = describe_kma_pty(pty_code) if pty_code > 0 else describe_kma_sky(sky_code)
        mx = d["tmx"] if d["tmx"] is not None else (max(d["tmp"]) if d["tmp"] else None)
        mn = d["tmn"] if d["tmn"] is not None else (min(d["tmp"]) if d["tmp"] else None)
        days.append({"dateKey": date_key, "desc": desc, "max": mx, "min": mn})

    # 오늘/내일에 해당하는 앞의 2개 날짜만 4구간(새벽/오전/오후/저녁) 타임라인으로 재구성
    day_timelines = [
        build_kma_day_timeline(by_date[date_key]["by_time"], label)
        for date_key, label in zip(sorted_dates[:2], ["오늘", "내일"])
    ]

    result = {"days": days, "dayTimelines": day_timelines}
    _kma_forecast_cache[key] = result
    return result


async def _safe(coro):
    try:
        return await coro
    except Exception as e:  # noqa: BLE001 - 프론트에서 기대하는 {"error": ...} 모양으로 변환
        logger.exception("날씨 소스 조회 실패")
        return {"error": str(e)}


# 위경도 하나에 대해 Open-Meteo + 기상청 3종을 동시에 조회
async def fetch_all_weather(lat: float, lon: float, kma_key: str) -> dict:
    nx, ny = lat_lon_to_kma_grid(lat, lon)
    async with httpx.AsyncClient(timeout=10.0) as client:
        open_meteo, kma, kma_forecast, kma_hourly = await asyncio.gather(
            _safe(fetch_open_meteo(client, lat, lon)),
            _safe(fetch_kma(client, nx, ny, kma_key)),
            _safe(fetch_kma_forecast(client, nx, ny, kma_key)),
            _safe(fetch_kma_hourly(client, nx, ny, kma_key)),
        )

    return {
        "openMeteo": open_meteo,
        "kma": kma,
        "kmaForecast": kma_forecast,
        "kmaHourly": kma_hourly,
    }
