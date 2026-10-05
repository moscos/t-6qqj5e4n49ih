// 오프라인에서도 게임이 열리게 하는 서비스 워커.
// 온라인이면 항상 최신 파일을 받아 캐시를 갱신하고, 연결이 안 될 때만 캐시에서 꺼낸다 —
// 게임을 고쳐서 다시 올리면 다음 실행 때 바로 반영되게 하기 위해서다.

const CACHE = "tetris";
const FILES = ["./", "index.html", "style.css", "logic.js", "song.js", "sound.js", "game.js", "manifest.webmanifest", "assets/icon-180.png", "assets/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request, { cache: "no-cache" }) // 브라우저 캐시의 옛 파일 대신 서버에 새 버전이 있는지 확인
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request, { ignoreSearch: true }))
  );
});
