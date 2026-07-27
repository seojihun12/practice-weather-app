import { fetchCityWeather } from "./weather.js";
import { renderCityBlock } from "./render.js";
import { drawHourlyChart, drawWeeklyChart } from "./charts.js";
import { getFavorites, getRecents, addRecent, toggleFavorite } from "./storage.js";
import { initWindMap } from "./windMap.js";
import { initMyWindMap } from "./myWindMap.js";
import { initCloudMap } from "./cloudMap.js";
import { initInstallApp } from "./installApp.js";

const form = document.getElementById("searchForm");
const cityInput = document.getElementById("cityInput");
const statusMsg = document.getElementById("statusMsg");
const resultsContainer = document.getElementById("resultsContainer");
const chipArea = document.getElementById("chipArea");
const favoriteChips = document.getElementById("favoriteChips");
const recentChips = document.getElementById("recentChips");

// 마지막 검색 결과. 토글 버튼 클릭 시 차트를 그리려면 원본 데이터가 필요해서 보관해둠.
let cityDataStore = [];

function renderChipRow(container, label, cities) {
  if (cities.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = `
    <span class="chip-row-label">${label}</span>
    ${cities.map(c => `<button type="button" class="chip" data-city="${c}">${c}</button>`).join("")}
  `;
}

function renderChips() {
  renderChipRow(favoriteChips, "즐겨찾기", getFavorites());
  renderChipRow(recentChips, "최근 검색", getRecents());
}

// 쉼표로 구분된 여러 도시를 한 번에 조회해서 렌더링
async function searchCities(rawInput) {
  const cities = rawInput
    .split(",")
    .map(c => c.trim())
    .filter(c => c.length > 0);

  if (cities.length === 0) return;

  resultsContainer.innerHTML = '<div class="spinner-wrap"><div class="spinner"></div></div>';
  statusMsg.textContent = `${cities.length}개 도시 검색 중...`;

  try {
    const results = await Promise.all(cities.map(fetchCityWeather));
    cityDataStore = results;
    resultsContainer.innerHTML = results.map((r, i) => renderCityBlock(r, i)).join("");
    statusMsg.textContent = "";
    cities.forEach(addRecent);
    renderChips();
  } catch (err) {
    resultsContainer.innerHTML = "";
    statusMsg.textContent = "데이터를 가져오는 중 오류가 발생했어요. 인터넷 연결을 확인해주세요.";
    console.error(err);
  }
}

chipArea.addEventListener("click", (e) => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  cityInput.value = chip.dataset.city;
  searchCities(chip.dataset.city);
});

resultsContainer.addEventListener("click", (e) => {
  const favBtn = e.target.closest(".favorite-btn");
  if (favBtn) {
    toggleFavorite(favBtn.dataset.city);
    const nowActive = favBtn.classList.toggle("active");
    favBtn.textContent = nowActive ? "★" : "☆";
    renderChips();
    return;
  }

  // 펼치기 버튼을 누를 때만 차트를 그림 (숨겨진 상태에서는 캔버스 너비가 0이라 미리 그릴 수 없음)
  const btn = e.target.closest(".toggle-week-btn");
  if (!btn) return;

  const details = btn.nextElementSibling;
  const nowHidden = details.classList.toggle("hidden");
  btn.textContent = nowHidden ? "이번주 예보 자세히 보기 ▾" : "이번주 예보 접기 ▴";

  if (!nowHidden && !details.dataset.drawn) {
    const index = Number(btn.dataset.cityIndex);
    const cityData = cityDataStore[index];
    const hourlyCanvas = details.querySelector(".hourly-chart");
    const weeklyCanvas = details.querySelector(".weekly-chart");
    drawHourlyChart(hourlyCanvas, cityData.openMeteo.hourlyForecast, cityData.kmaHourly);
    drawWeeklyChart(weeklyCanvas, cityData.openMeteo.forecast, cityData.kmaForecast);
    details.dataset.drawn = "1";
  }
});

form.addEventListener("submit", (e) => {
  e.preventDefault();
  searchCities(cityInput.value);
});

renderChips();
searchCities(cityInput.value);
initWindMap();
initMyWindMap();
initCloudMap();
initInstallApp();

if ("serviceWorker" in navigator) {
  // 상대경로로 등록해야 GitHub Pages처럼 하위 경로(username.github.io/repo/)에 배포돼도 스코프가 깨지지 않음
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
