// ---- API 키 ----

// 기상청 API 인증키. 코드에만 존재하며 화면(입력창 등)에는 절대 노출하지 않음.
export const KMA_KEY = "60d0f885d832f29ab3ca30908375c57db9c3d27dcf2d61cc6f9d32da02022f66";

// 카카오 JavaScript 키. 도메인 화이트리스트로 보호되는 공개용 키라 코드에 있어도 됨.
export const KAKAO_JS_KEY = "a748c6007515dc9de3e8ed0e03284441";

// ---- 날씨 코드 -> 한글 설명 매핑 ----
// Open-Meteo가 WMO 표준 코드로 날씨를 알려주기 때문에 한글 설명으로 바꿔주는 테이블.
const WEATHER_CODES = {
  0: "맑음", 1: "대체로 맑음", 2: "구름 조금", 3: "흐림",
  45: "안개", 48: "짙은 안개",
  51: "약한 이슬비", 53: "이슬비", 55: "강한 이슬비",
  61: "약한 비", 63: "비", 65: "강한 비",
  71: "약한 눈", 73: "눈", 75: "폭설",
  80: "약한 소나기", 81: "소나기", 82: "강한 소나기",
  95: "뇌우", 96: "우박 동반 뇌우", 99: "강한 우박 동반 뇌우",
};
export function describeWeatherCode(code) {
  return WEATHER_CODES[code] || "-";
}

// 기상청 PTY(강수형태) 코드 매핑
const KMA_PTY_CODES = {
  0: "강수 없음", 1: "비", 2: "비/눈", 3: "눈", 5: "빗방울", 6: "빗방울눈날림", 7: "눈날림",
};
export function describeKmaPty(code) {
  return KMA_PTY_CODES[code] ?? "-";
}

// 기상청 SKY(하늘상태) 코드 매핑
const KMA_SKY_CODES = { 1: "맑음", 3: "구름 많음", 4: "흐림" };
export function describeKmaSky(code) {
  return KMA_SKY_CODES[code] ?? "-";
}

// 오늘/내일을 새벽·오전·오후·저녁 4구간으로 나누는 기준
export const DAY_PERIODS = [
  { key: "dawn", label: "새벽", from: 0, to: 6 },
  { key: "morning", label: "오전", from: 6, to: 12 },
  { key: "afternoon", label: "오후", from: 12, to: 18 },
  { key: "evening", label: "저녁", from: 18, to: 24 },
];

// 일간 예보 카드 라벨: 0번째는 "오늘", 1번째는 "내일", 그 외엔 "M/D (요일)"
export function formatDayLabel(dateStr, index) {
  if (index === 0) return "오늘";
  if (index === 1) return "내일";
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()} (${days[d.getDay()]})`;
}

// 시간대별 예보 카드 라벨: 0번째(현재 시각)는 "지금", 그 외엔 "H시"
export function formatHourLabel(timeStr, index) {
  if (index === 0) return "지금";
  const hour = Number(timeStr.slice(11, 13));
  return `${hour}시`;
}

// 날씨 설명 텍스트에 어울리는 이모지 (카드에 시각적 포인트를 주기 위함)
export function weatherEmoji(desc) {
  if (!desc) return "";
  if (desc.includes("뇌우")) return "⛈️";
  if (desc.includes("눈")) return "❄️";
  if (desc.includes("소나기") || desc.includes("비") || desc.includes("이슬비")) return "🌧️";
  if (desc.includes("짙은 안개") || desc.includes("안개")) return "🌫️";
  if (desc.includes("흐림")) return "☁️";
  if (desc.includes("구름")) return "⛅";
  if (desc.includes("맑음")) return "☀️";
  return "";
}
