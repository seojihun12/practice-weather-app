function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function isIos() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

export function initInstallApp() {
  const installBtn = document.getElementById("installAppBtn");
  const installHint = document.getElementById("installHint");

  if (isStandalone()) return; // 이미 앱으로 설치되어 실행 중이면 버튼 필요 없음

  let deferredPrompt = null;

  // Chrome/Edge(안드로이드·PC)는 설치 가능해지면 이 이벤트를 쏴줌. 기본 배너 대신 우리 버튼으로 유도.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.classList.remove("hidden");
  });

  window.addEventListener("appinstalled", () => {
    installBtn.classList.add("hidden");
    installHint.classList.add("hidden");
    deferredPrompt = null;
  });

  // iOS Safari는 beforeinstallprompt 자체가 없어서, 설치 안내를 직접 보여줌
  if (isIos()) {
    installBtn.classList.remove("hidden");
  }

  installBtn.addEventListener("click", async () => {
    if (deferredPrompt) {
      installBtn.classList.add("hidden");
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
      deferredPrompt = null;
      return;
    }
    installHint.classList.toggle("hidden");
  });
}
