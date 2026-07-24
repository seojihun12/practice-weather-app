// 시간대별 기온(선 그래프) + 강수확률(막대 그래프)을 하나의 캔버스에 그림
export function drawHourlyChart(canvas, hourlyForecast) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 280;
  const cssH = 162;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 26, padR = 8, padT = 14;
  const tempH = 88;
  const barH = 26;
  const chartW = cssW - padL - padR;
  const n = hourlyForecast.length;
  const xStep = chartW / (n - 1);
  const temps = hourlyForecast.map(h => h.temp);
  const minT = Math.min(...temps), maxT = Math.max(...temps);
  const range = (maxT - minT) || 1;

  const xAt = i => padL + i * xStep;
  const yAt = t => padT + tempH - ((t - minT) / range) * (tempH - 20) - 10;

  ctx.strokeStyle = "#e6ebf1";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padL, padT + tempH);
  ctx.lineTo(padL + chartW, padT + tempH);
  ctx.stroke();

  ctx.beginPath();
  hourlyForecast.forEach((h, i) => {
    const x = xAt(i), y = yAt(h.temp);
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = "#0f5b8c";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = "#0f5b8c";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  hourlyForecast.forEach((h, i) => {
    const x = xAt(i), y = yAt(h.temp);
    ctx.beginPath();
    ctx.arc(x, y, 2.5, 0, Math.PI * 2);
    ctx.fill();
    if (i % 2 === 0) ctx.fillText(`${Math.round(h.temp)}°`, x, y - 6);
  });

  const barBaseY = padT + tempH + 18;
  hourlyForecast.forEach((h, i) => {
    const x = xAt(i);
    const pop = h.pop || 0;
    const bh = (pop / 100) * barH;
    ctx.fillStyle = pop >= 50 ? "#2563eb" : "#93c5fd";
    ctx.fillRect(x - 6, barBaseY + (barH - bh), 12, bh);
  });

  // 라벨이 촘촘해서 겹치지 않도록 한 칸씩 위/아래로 지그재그 배치
  ctx.fillStyle = "#94a3b8";
  ctx.font = "8px sans-serif";
  ctx.textAlign = "center";
  hourlyForecast.forEach((h, i) => {
    const y = i % 2 === 0 ? cssH - 12 : cssH - 2;
    ctx.fillText(h.label.replace("시", ""), xAt(i), y);
  });
}

// 이번 주 최고/최저 기온 추이(Open-Meteo 실선 2개 + 기상청 최고 점선)를 그림
export function drawWeeklyChart(canvas, forecast, kmaForecast) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 280;
  const cssH = 140;
  canvas.width = cssW * dpr;
  canvas.height = cssH * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 28, padR = 8, padT = 12, padB = 20;
  const chartW = cssW - padL - padR;
  const chartH = cssH - padT - padB;
  const n = forecast.length;
  const xStep = chartW / (n - 1);

  const kmaByDate = forecast.map(d => kmaForecast?.days?.find(k => k.dateKey === d.dateKey) || null);
  const values = forecast.flatMap(d => [d.max, d.min]);
  kmaByDate.forEach(k => { if (k) values.push(k.max); });
  const minT = Math.min(...values), maxT = Math.max(...values);
  const range = (maxT - minT) || 1;

  const xAt = i => padL + i * xStep;
  const yAt = v => padT + chartH - ((v - minT) / range) * chartH;

  ctx.strokeStyle = "#e6ebf1";
  ctx.lineWidth = 1;
  [0, 0.5, 1].forEach(f => {
    const y = padT + chartH * f;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + chartW, y);
    ctx.stroke();
  });

  // 값이 null인 구간(기상청 데이터가 없는 4일차 이후 등)은 선을 끊어서 이어 그리지 않음
  function drawLine(vals, color, dashed) {
    ctx.beginPath();
    ctx.setLineDash(dashed ? [4, 3] : []);
    let started = false;
    vals.forEach((v, i) => {
      if (v === null || v === undefined) { started = false; return; }
      const x = xAt(i), y = yAt(v);
      if (!started) { ctx.moveTo(x, y); started = true; } else { ctx.lineTo(x, y); }
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  drawLine(forecast.map(d => d.max), "#dc2626", false);
  drawLine(forecast.map(d => d.min), "#2563eb", false);
  drawLine(kmaByDate.map(k => (k ? k.max : null)), "#f97316", true);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "9px sans-serif";
  ctx.textAlign = "center";
  forecast.forEach((d, i) => {
    ctx.fillText(d.label.replace(/\s*\(.+\)/, ""), xAt(i), cssH - 4);
  });
}
