// 테트리스 화면: 입력(버튼, 터치 제스처, 키보드), 낙하 타이밍, 그리기. 규칙 계산은 logic.js, 소리는 sound.js가 맡는다.

(() => {
  // 아이폰 사파리는 viewport의 확대 금지 설정을 무시한다. 두 번 탭 확대는 style.css의 touch-action으로,
  // 두 손가락 확대는 여기서 직접 막는다 (gesture* 이벤트는 사파리 전용)
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, (e) => e.preventDefault());
  }
  document.addEventListener("touchmove", (e) => {
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  const { COLS, ROWS, VISIBLE_ROWS, HIDDEN } = Logic;

  // 캔버스 내부 좌표: 왼쪽이 판(10x20칸), 오른쪽은 다음 조각 칸
  const CELL = 30;
  const SIDE = 50;
  const BOARD_W = COLS * CELL;
  const W = BOARD_W + SIDE;
  const H = VISIBLE_ROWS * CELL;
  const MINI = 10; // 다음 조각을 작게 그릴 때의 칸 크기
  const NEXT_COUNT = 3;

  const LOCK_DELAY = 0.5; // 바닥에 닿은 뒤 굳기까지의 여유(초)
  const MAX_LOCK_RESETS = 15; // 움직여서 여유를 되돌릴 수 있는 횟수 (무한정 버티기 방지)
  const REPEAT_DELAY = 170; // 버튼을 누르고 있을 때 반복이 시작되기까지(ms)
  const REPEAT_EVERY = 45;
  const SAVE_KEY = "tetris-v1";
  const COLORS = { I: "#22d3ee", O: "#facc15", T: "#a855f7", S: "#22c55e", Z: "#ef4444", J: "#3b82f6", L: "#f97316" };

  // 이 기기에 남기는 것: 최고 점수와 소리 설정
  const saved = { best: 0, music: true, sfx: true };
  try {
    Object.assign(saved, JSON.parse(localStorage.getItem(SAVE_KEY)) || {});
  } catch (e) {
    // 저장소를 못 쓰는 환경이면 저장 없이 플레이
  }
  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(saved));
    } catch (e) {}
  }
  Sound.setMusic(saved.music);
  Sound.setSfx(saved.sfx);

  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  let scale = 1;

  let state = null;
  let paused = false;
  let gravityAcc = 0; // 다음 한 칸 낙하까지 쌓인 시간
  let lockTimer = 0;
  let lockResets = 0;
  let levelBefore = 1; // 레벨이 오른 순간을 알아채기 위한 직전 레벨
  let flashes = []; // 줄이 지워질 때 잠깐 번쩍이는 효과 {rows, t}

  // ---- 화면 전환 ----

  function showMenu() {
    state = null;
    Sound.stopMusic(false);
    $("play").hidden = true;
    $("menu").hidden = false;
    $("menu-best").textContent = saved.best ? `최고 점수 ${saved.best}` : "";
  }

  function startGame() {
    state = Logic.createState();
    paused = false;
    flashes = [];
    levelBefore = 1;
    resetPieceTimers();
    Sound.unlock();
    Sound.startMusic(true);
    $("overlay").hidden = true;
    $("menu").hidden = true;
    $("play").hidden = false;
    resize();
    updateHud();
  }

  function showOverlay(title, detail, mainLabel, onMain, showRestart) {
    $("overlay-title").textContent = title;
    $("overlay-detail").textContent = detail;
    $("btn-overlay-main").textContent = mainLabel;
    $("btn-overlay-main").onclick = onMain;
    $("btn-overlay-restart").hidden = !showRestart;
    $("overlay").hidden = false;
  }

  function pause() {
    if (!state || state.over || paused) return;
    paused = true;
    Sound.stopMusic(true);
    showOverlay("일시정지", "", "계속하기", resume, true);
  }

  function resume() {
    paused = false;
    $("overlay").hidden = true;
    Sound.unlock();
    Sound.startMusic(false);
  }

  function gameOver() {
    Sound.stopMusic(false);
    Sound.play("gameOver");
    const isBest = state.score > saved.best;
    if (isBest) {
      saved.best = state.score;
      persist();
    }
    showOverlay("게임 오버", `${state.score}점 · ${state.lines}줄\n${isBest ? "최고 점수 갱신!" : `최고 점수 ${saved.best}`}`, "다시 하기", startGame, false);
  }

  function updateHud() {
    $("hud-score").textContent = state.score;
    $("hud-level").textContent = state.level;
    $("hud-lines").textContent = state.lines;
  }

  // ---- 조작 ----

  function resetPieceTimers() {
    gravityAcc = 0;
    lockTimer = 0;
    lockResets = 0;
  }

  // 바닥에 닿은 조각을 움직이면 굳는 시간을 되돌려 준다 (횟수 제한 있음)
  function nudged() {
    if (lockResets < MAX_LOCK_RESETS) {
      lockTimer = 0;
      lockResets++;
    }
  }

  // hard: 바로 내리기로 굳은 것인지 (소리가 다르다)
  function afterLock(cleared, hard) {
    if (cleared.length) flashes.push({ rows: cleared, t: 0 });
    if (cleared.length === 4) Sound.play("tetris");
    else if (cleared.length) Sound.play("clear");
    else Sound.play(hard ? "drop" : "lock");
    if (state.level > levelBefore) Sound.play("levelUp");
    levelBefore = state.level;
    resetPieceTimers();
    if (state.over) gameOver();
  }

  function act(action) {
    if (!state || paused || state.over) return;
    Sound.unlock(); // 조작은 항상 사용자의 터치에서 오므로, 여기서 소리가 막혀 있으면 풀어 준다
    if (action === "left" || action === "right") {
      if (Logic.move(state, action === "left" ? -1 : 1, 0)) {
        nudged();
        Sound.play("move");
      }
    } else if (action === "down") {
      if (Logic.move(state, 0, 1)) {
        state.score += 1; // 직접 내린 칸당 1점
        gravityAcc = 0;
        Sound.play("soft");
      }
    } else if (action === "rotate" || action === "rotateCCW") {
      if (Logic.rotate(state, action === "rotate" ? 1 : -1)) {
        nudged();
        Sound.play("rotate");
      }
    } else if (action === "drop") {
      afterLock(Logic.hardDrop(state), true);
    }
    updateHud();
  }

  // 아래 버튼들: 누르는 즉시 한 번, 방향 버튼은 누르고 있으면 반복
  for (const button of document.querySelectorAll("#controls button")) {
    let delayTimer = null;
    let repeatTimer = null;
    const stop = () => {
      clearTimeout(delayTimer);
      clearInterval(repeatTimer);
    };
    button.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      stop();
      act(button.dataset.action);
      if ("repeat" in button.dataset) {
        delayTimer = setTimeout(() => {
          repeatTimer = setInterval(() => act(button.dataset.action), REPEAT_EVERY);
        }, REPEAT_DELAY);
      }
    });
    for (const type of ["pointerup", "pointercancel", "pointerleave"]) button.addEventListener(type, stop);
  }

  // 판 위 터치: 좌우로 끌면 이동, 아래로 끌면 내리기, 짧게 톡 치면 회전, 아래로 빠르게 튕기면 바로 내리기
  let gesture = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    gesture = { x0: e.clientX, y0: e.clientY, ax: e.clientX, ay: e.clientY, t0: performance.now(), moved: false };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!gesture) return;
    const step = CELL * scale;
    while (e.clientX - gesture.ax >= step) {
      act("right");
      gesture.ax += step;
      gesture.moved = true;
    }
    while (gesture.ax - e.clientX >= step) {
      act("left");
      gesture.ax -= step;
      gesture.moved = true;
    }
    while (e.clientY - gesture.ay >= step) {
      act("down");
      gesture.ay += step;
      gesture.moved = true;
    }
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!gesture) return;
    const dx = e.clientX - gesture.x0;
    const dy = e.clientY - gesture.y0;
    const elapsed = performance.now() - gesture.t0;
    const step = CELL * scale;
    if (elapsed < 250 && dy > step * 1.5 && dy > Math.abs(dx) * 2) act("drop");
    else if (!gesture.moved && elapsed < 300 && Math.hypot(dx, dy) < 12) act("rotate");
    gesture = null;
  });
  canvas.addEventListener("pointercancel", () => {
    gesture = null;
  });

  // 맥에서 해볼 때용 키보드
  const KEYS = {
    ArrowLeft: "left", ArrowRight: "right", ArrowDown: "down", ArrowUp: "rotate",
    x: "rotate", z: "rotateCCW", " ": "drop",
  };
  window.addEventListener("keydown", (e) => {
    if (e.key === "p" || e.key === "Escape") {
      if (paused) resume();
      else pause();
    } else if (KEYS[e.key]) {
      e.preventDefault();
      act(KEYS[e.key]);
    }
  });

  // 음악/효과음 켜고 끄기 (메뉴와 일시정지 화면에 같은 버튼이 있다)
  const TOGGLE_LABELS = { music: "음악", sfx: "효과음" };
  function refreshToggles() {
    for (const button of document.querySelectorAll("[data-toggle]")) {
      const key = button.dataset.toggle;
      button.textContent = `${TOGGLE_LABELS[key]} ${saved[key] ? "켜짐" : "꺼짐"}`;
      button.classList.toggle("on", saved[key]);
    }
  }
  for (const button of document.querySelectorAll("[data-toggle]")) {
    button.addEventListener("click", () => {
      const key = button.dataset.toggle;
      saved[key] = !saved[key];
      persist();
      Sound.setMusic(saved.music);
      Sound.setSfx(saved.sfx);
      refreshToggles();
    });
  }
  refreshToggles();

  $("btn-start").addEventListener("click", startGame);
  $("btn-pause").addEventListener("click", pause);
  $("btn-overlay-restart").addEventListener("click", startGame);
  $("btn-overlay-menu").addEventListener("click", showMenu);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) pause(); // 다른 앱으로 나가면 자동으로 멈춘다
  });

  // ---- 진행 ----

  function update(dt) {
    const interval = Logic.gravityInterval(state.level);
    gravityAcc += dt;
    while (gravityAcc >= interval) {
      gravityAcc -= interval;
      if (!Logic.move(state, 0, 1)) {
        gravityAcc = 0;
        break;
      }
    }
    if (Logic.grounded(state)) {
      lockTimer += dt;
      if (lockTimer >= LOCK_DELAY) {
        afterLock(Logic.lockPiece(state), false);
        updateHud();
      }
    } else {
      lockTimer = 0;
    }
  }

  // ---- 그리기 ----

  function resize() {
    const field = $("field");
    if (!field.clientWidth || !field.clientHeight) return;
    scale = Math.min(field.clientWidth / W, field.clientHeight / H);
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${W * scale}px`;
    canvas.style.height = `${H * scale}px`;
    canvas.width = Math.round(W * scale * dpr);
    canvas.height = Math.round(H * scale * dpr);
    ctx.setTransform(scale * dpr, 0, 0, scale * dpr, 0, 0);
  }
  window.addEventListener("resize", resize);

  function drawCell(x, y, size, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, size, size);
    const edge = Math.max(1, size * 0.12);
    ctx.fillStyle = "rgba(255,255,255,0.28)"; // 위/왼쪽은 밝게, 아래/오른쪽은 어둡게 해서 블록처럼 보이게
    ctx.fillRect(x, y, size, edge);
    ctx.fillRect(x, y, edge, size);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fillRect(x, y + size - edge, size, edge);
    ctx.fillRect(x + size - edge, y, edge, size);
  }

  // 다음 조각을 작게, 칸 가운데에 맞춰 그린다
  function drawMini(type, centerX, centerY) {
    const cells = Logic.SHAPES[type][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const width = (Math.max(...xs) - Math.min(...xs) + 1) * MINI;
    const height = (Math.max(...ys) - Math.min(...ys) + 1) * MINI;
    for (const [x, y] of cells) {
      drawCell(centerX - width / 2 + (x - Math.min(...xs)) * MINI, centerY - height / 2 + (y - Math.min(...ys)) * MINI, MINI, COLORS[type]);
    }
  }

  function draw() {
    ctx.fillStyle = "#0d1021";
    ctx.fillRect(0, 0, W, H);

    // 판
    ctx.fillStyle = "#151a35";
    ctx.fillRect(0, 0, BOARD_W, H);
    ctx.strokeStyle = "rgba(255,255,255,0.05)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let c = 1; c < COLS; c++) {
      ctx.moveTo(c * CELL + 0.5, 0);
      ctx.lineTo(c * CELL + 0.5, H);
    }
    for (let r = 1; r < VISIBLE_ROWS; r++) {
      ctx.moveTo(0, r * CELL + 0.5);
      ctx.lineTo(BOARD_W, r * CELL + 0.5);
    }
    ctx.stroke();

    const px = (x) => x * CELL;
    const py = (y) => (y - HIDDEN) * CELL;

    for (let y = HIDDEN; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (state.board[y][x]) drawCell(px(x), py(y), CELL, COLORS[state.board[y][x]]);
      }
    }

    if (!state.over) {
      // 떨어질 자리 미리보기
      const ghost = { ...state.piece, y: Logic.ghostY(state) };
      ctx.strokeStyle = COLORS[state.piece.type];
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.55;
      for (const [x, y] of Logic.cells(ghost)) {
        if (y >= HIDDEN) ctx.strokeRect(px(x) + 2, py(y) + 2, CELL - 4, CELL - 4);
      }
      ctx.globalAlpha = 1;
      for (const [x, y] of Logic.cells(state.piece)) {
        if (y >= HIDDEN) drawCell(px(x), py(y), CELL, COLORS[state.piece.type]);
      }
    }

    for (const flash of flashes) {
      ctx.fillStyle = `rgba(255,255,255,${0.7 * (1 - flash.t / 0.25)})`;
      for (const row of flash.rows) ctx.fillRect(0, py(row), BOARD_W, CELL);
    }

    // 오른쪽 칸: 다음에 나올 조각들
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.font = "12px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("다음", W - SIDE / 2, 18);
    state.queue.slice(0, NEXT_COUNT).forEach((type, i) => drawMini(type, W - SIDE / 2, 50 + i * 46));
  }

  let lastTime = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000 || 0);
    lastTime = now;
    if (state) {
      if (!paused && !state.over) update(dt);
      for (const flash of flashes) flash.t += dt;
      flashes = flashes.filter((flash) => flash.t < 0.25);
      draw();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // 설치한 뒤에는 오프라인에서도 열리도록 서비스 워커 등록 (https 또는 localhost에서만 동작)
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }

  showMenu();
  if (new URLSearchParams(location.search).has("play")) startGame(); // 주소에 ?play 를 붙이면 바로 시작 (확인용)

  window.__tetris = { get state() { return state; }, act, startGame, update, Logic, Sound };
})();
