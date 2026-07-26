// ---- API 키 / 설정 ----

// 카카오 JavaScript 키. 도메인 화이트리스트로 보호되는 공개용 키라 코드에 있어도 됨.
export const KAKAO_JS_KEY = "a748c6007515dc9de3e8ed0e03284441";

// 날씨 데이터 백엔드(FastAPI) 주소. 배포 시 실제 백엔드 도메인으로 바꿔줄 것.
export const BACKEND_URL = "http://localhost:8000";

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
