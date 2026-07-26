import { weatherEmoji } from "./constants.js";
import { isFavorite } from "./storage.js";

// 소스 하나(Open-Meteo/기상청)의 현재 상태 카드 HTML
function renderProviderBlock(name, p) {
  if (!p) return "";
  if (p.error) {
    return `<div class="provider-block"><div class="provider-name">${name}</div><div class="provider-error">${p.error}</div></div>`;
  }
  const descLine = p.desc ? `<div class="provider-line">${weatherEmoji(p.desc)} ${p.desc}</div>` : "";
  return `
    <div class="provider-block">
      <div class="provider-name">${name}</div>
      <div class="provider-line">기온 ${p.temp}${p.feelsLike ? ` (체감 ${p.feelsLike})` : ""}</div>
      <div class="provider-line">습도 ${p.humidity} · 풍속 ${p.wind}</div>
      ${descLine}
    </div>`;
}

// Open-Meteo와 기상청의 현재 기온을 비교해 차이를 보여주는 한 줄 요약
function renderTempCompare(data) {
  const providers = [
    { name: "Open-Meteo", temp: data.openMeteo?.temp },
    { name: "기상청", temp: data.kma?.temp },
  ].filter(p => p.temp && p.temp !== "-");

  if (providers.length < 2) return "";

  const values = providers.map(p => parseFloat(p.temp));
  const maxDiff = (Math.max(...values) - Math.min(...values)).toFixed(1);
  const line = providers.map(p => `${p.name} ${p.temp}`).join(" · ");

  return `<div class="compare-line">기온 비교: ${line} (차이 ${maxDiff}°C)</div>`;
}

// 이번 주 예보 카드 하나(해당 날짜의 Open-Meteo + 기상청 데이터를 나란히 표시)
function renderForecastDay(day, kmaForecast) {
  const kmaDay = kmaForecast?.days?.find(d => d.dateKey === day.dateKey);
  const kmaPart = kmaDay
    ? `
      <div class="forecast-source kma">기상청</div>
      <div class="forecast-desc">${weatherEmoji(kmaDay.desc)} ${kmaDay.desc}</div>
      <div class="forecast-temps"><span class="max">${kmaDay.max}°</span> / <span class="min">${kmaDay.min}°</span></div>`
    : `<div class="forecast-source muted">기상청 자료 없음</div>`;

  return `
    <div class="forecast-day">
      <div class="forecast-label">${day.label}</div>
      <div class="forecast-source">Open-Meteo</div>
      <div class="forecast-desc">${weatherEmoji(day.desc)} ${day.desc}</div>
      <div class="forecast-temps"><span class="max">${day.max}°</span> / <span class="min">${day.min}°</span></div>
      ${kmaPart}
    </div>`;
}

// 오늘/내일 한눈에 보기: 새벽·오전·오후·저녁 4구간 카드 한 줄. 같은 구간의 기상청 데이터가
// 있으면(국내 도시) 구분선 아래에 기상청 줄을 덧붙여서 두 소스를 나란히 비교함.
function renderDayTimeline(timeline, kmaTimeline) {
  return `
    <div class="timeline-row">
      <div class="timeline-label">${timeline.label}</div>
      <div class="timeline-periods">
        ${timeline.periods.map((p, i) => {
          const kp = kmaTimeline?.periods?.[i];
          const kmaPart = kp
            ? `
              <div class="tp-source kma">기상청</div>
              <div class="tp-desc">${weatherEmoji(kp.desc)} ${kp.desc}</div>
              ${kp.max !== null ? `<div class="tp-temp">${kp.max}° / ${kp.min}°</div>` : ""}
              ${kp.pop > 0 ? `<div class="tp-pop">강수 ${kp.pop}%</div>` : ""}`
            : "";
          return `
          <div class="timeline-period${p.hasRain || kp?.hasRain ? " rain" : ""}">
            <div class="tp-label">${p.label}</div>
            <div class="tp-source">Open-Meteo</div>
            <div class="tp-desc">${weatherEmoji(p.desc)} ${p.desc}</div>
            ${p.max !== null ? `<div class="tp-temp">${p.max}° / ${p.min}°</div>` : ""}
            ${p.pop > 0 ? `<div class="tp-pop">강수 ${p.pop}%</div>` : ""}
            ${kmaPart}
          </div>`;
        }).join("")}
      </div>
    </div>`;
}

// 도시 하나의 전체 카드 HTML. 기본적으로 오늘/내일 요약만 보이고,
// 나머지(차트·시간대별·주간예보)는 .week-details 안에 숨겨뒀다가 버튼으로 펼침.
export function renderCityBlock(data, index) {
  if (!data.ok) {
    return `
      <div class="city-block error">
        <div class="place-name">${data.query}</div>
        <div class="error-msg">해당 도시를 찾을 수 없어요.</div>
      </div>`;
  }

  return `
    <div class="city-block">
      <div class="place-name">
        ${data.label}
        <button type="button" class="favorite-btn${isFavorite(data.query) ? " active" : ""}" data-city="${data.query}" title="즐겨찾기">${isFavorite(data.query) ? "★" : "☆"}</button>
      </div>

      <div class="section-label">오늘 · 내일 한눈에 보기 (Open-Meteo · 기상청 비교)</div>
      ${data.openMeteo.dayTimelines.map((t, i) => renderDayTimeline(t, data.kmaForecast?.dayTimelines?.[i])).join("")}

      <button type="button" class="toggle-week-btn" data-city-index="${index}">이번주 예보 자세히 보기 ▾</button>

      <div class="week-details hidden">
        <div class="chart-block">
          <div class="section-label">시간대별 기온 · 강수확률 (파랑 실선 Open-Meteo · 주황 점선 기상청 최대 6시간)</div>
          <canvas class="hourly-chart" data-city-index="${index}"></canvas>
        </div>

        ${renderTempCompare(data)}

        <div class="provider-row">
          ${renderProviderBlock("Open-Meteo", data.openMeteo)}
          ${renderProviderBlock("기상청", data.kma)}
        </div>

        <div class="section-label">시간대별 예보 (Open-Meteo)</div>
        <div class="hourly-row">
          ${data.openMeteo.hourlyForecast.map(h => `
            <div class="hourly-item">
              <div class="hourly-label">${h.label}</div>
              <div class="hourly-emoji">${weatherEmoji(h.desc)}</div>
              <div class="hourly-temp">${h.temp}°</div>
              <div class="hourly-desc">${h.desc}</div>
            </div>
          `).join("")}
        </div>

        <div class="chart-block">
          <div class="section-label">주간 기온 비교 (빨강 Open-Meteo 최고 · 파랑 Open-Meteo 최저 · 주황 점선 기상청 최고)</div>
          <canvas class="weekly-chart" data-city-index="${index}"></canvas>
        </div>

        <div class="section-label">이번 주 예보 비교 (Open-Meteo · 기상청 최대 3일)</div>
        <div class="forecast-row">
          ${data.openMeteo.forecast.map(day => renderForecastDay(day, data.kmaForecast)).join("")}
        </div>
      </div>
    </div>`;
}
