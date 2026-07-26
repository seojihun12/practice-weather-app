import logging
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware

from .weather import fetch_all_weather

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)
# httpx는 INFO 레벨에서 요청 URL을 그대로 로그로 남기는데, 여기엔 KMA_KEY가 쿼리스트링으로 들어있어서
# 서버 로그에 서비스키가 평문으로 노출되는 걸 막기 위해 WARNING 이상만 남기게 함
logging.getLogger("httpx").setLevel(logging.WARNING)

KMA_KEY = os.environ.get("KMA_KEY")

app = FastAPI(title="날씨 데이터 백엔드")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5500",
        "http://127.0.0.1:5500",
        "https://seojihun12.github.io",
    ],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.monotonic()
    response = await call_next(request)
    elapsed_ms = (time.monotonic() - start) * 1000
    logger.info("%s %s -> %s (%.1fms)", request.method, request.url.path, response.status_code, elapsed_ms)
    return response


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/api/weather")
async def get_weather(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    if not KMA_KEY:
        raise HTTPException(status_code=500, detail="KMA_KEY가 설정되지 않았습니다 (backend/.env 확인)")
    return await fetch_all_weather(lat, lon, KMA_KEY)
