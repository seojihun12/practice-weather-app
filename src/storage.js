const RECENTS_KEY = "weatherapp:recents";
const FAVORITES_KEY = "weatherapp:favorites";
const MAX_RECENTS = 5;

function readList(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeList(key, list) {
  localStorage.setItem(key, JSON.stringify(list));
}

export function getRecents() {
  return readList(RECENTS_KEY);
}

// 검색한 도시명을 최근 검색어 맨 앞에 추가 (중복 제거, 최대 5개까지만 보관)
export function addRecent(city) {
  const trimmed = city.trim();
  if (!trimmed) return;
  const list = readList(RECENTS_KEY).filter(c => c.toLowerCase() !== trimmed.toLowerCase());
  list.unshift(trimmed);
  writeList(RECENTS_KEY, list.slice(0, MAX_RECENTS));
}

export function getFavorites() {
  return readList(FAVORITES_KEY);
}

export function isFavorite(city) {
  return getFavorites().some(c => c.toLowerCase() === city.trim().toLowerCase());
}

// 즐겨찾기 토글. 이미 있으면 제거하고, 없으면 추가
export function toggleFavorite(city) {
  const trimmed = city.trim();
  if (!trimmed) return getFavorites();
  const list = readList(FAVORITES_KEY);
  const idx = list.findIndex(c => c.toLowerCase() === trimmed.toLowerCase());
  if (idx === -1) list.push(trimmed); else list.splice(idx, 1);
  writeList(FAVORITES_KEY, list);
  return list;
}
