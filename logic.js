// 테트리스 규칙(조각 모양, 회전, 줄 지우기, 점수). 화면과 무관한 순수 계산만 둔다.
//
// 표준 규칙을 따른다: 10x20 판, 7종 조각을 한 묶음씩 섞어 내는 7-bag, SRS 회전(벽 차기 포함),
// 다음 조각 미리보기. 홀드는 고전 테트리스에 없던 기능이라 넣지 않았다.
// 판 위쪽에는 화면에 안 보이는 숨은 줄(HIDDEN)이 있어서 맨 위에서도 조각을 돌릴 수 있다.
// 좌표는 x가 오른쪽, y가 아래쪽으로 커진다.

const Logic = (() => {
  const COLS = 10;
  const VISIBLE_ROWS = 20;
  const HIDDEN = 2;
  const ROWS = VISIBLE_ROWS + HIDDEN;
  const TYPES = ["I", "O", "T", "S", "Z", "J", "L"];
  const LINE_SCORES = [0, 100, 300, 500, 800]; // 한 번에 지운 줄 수별 기본 점수 (레벨을 곱한다)
  const LINES_PER_LEVEL = 10;
  const MAX_SPEED_LEVEL = 20;

  // 각 조각의 기본 모양(회전 상태 0). 정사각형 틀 안에 그리고, 틀째로 돌려서 나머지 상태를 만든다
  const BASE = {
    I: ["....", "####", "....", "...."],
    T: [".#.", "###", "..."],
    S: [".##", "##.", "..."],
    Z: ["##.", ".##", "..."],
    J: ["#..", "###", "..."],
    L: ["..#", "###", "..."],
  };

  function rotateCW(matrix) {
    const n = matrix.length;
    return matrix.map((_, r) => matrix.map((_, c) => matrix[n - 1 - c][r]));
  }

  // SHAPES[type][rot] = 그 상태에서 칸들이 차지하는 [x, y] 목록
  const SHAPES = {};
  for (const type in BASE) {
    let m = BASE[type].map((row) => [...row].map((ch) => ch === "#"));
    SHAPES[type] = [];
    for (let rot = 0; rot < 4; rot++) {
      const cells = [];
      m.forEach((row, y) => row.forEach((on, x) => on && cells.push([x, y])));
      SHAPES[type].push(cells);
      m = rotateCW(m);
    }
  }
  SHAPES.O = Array(4).fill([[1, 0], [2, 0], [1, 1], [2, 1]]); // O는 돌려도 그대로

  // SRS 벽 차기 표. 키는 "돌기 전 상태>돌린 뒤 상태", 값은 순서대로 시도할 [dx, dy] (여기서는 y가 위쪽 양수인
  // 표준 표기 그대로 적고, 쓸 때 부호를 뒤집는다)
  const KICKS_JLSTZ = {
    "0>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "1>0": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "1>2": [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
    "2>1": [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
    "2>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
    "3>2": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "3>0": [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
    "0>3": [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  };
  const KICKS_I = {
    "0>1": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "1>0": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "1>2": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
    "2>1": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "2>3": [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
    "3>2": [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
    "3>0": [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
    "0>3": [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  };

  const cells = (piece) => SHAPES[piece.type][piece.rot].map(([x, y]) => [piece.x + x, piece.y + y]);

  function collides(board, piece) {
    return cells(piece).some(([x, y]) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && board[y][x] !== null));
  }

  function shuffledBag(rand) {
    const bag = TYPES.slice();
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    return bag;
  }

  function createState(rand = Math.random) {
    const state = {
      board: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
      piece: null,
      queue: [],
      score: 0,
      lines: 0,
      level: 1,
      over: false,
      rand,
    };
    spawn(state);
    return state;
  }

  // 다음 조각을 판 맨 위 가운데에 놓는다. 놓을 자리가 이미 막혀 있으면 게임 오버
  function spawn(state) {
    while (state.queue.length < TYPES.length) state.queue.push(...shuffledBag(state.rand));
    const t = state.queue.shift();
    state.piece = { type: t, rot: 0, x: 3, y: t === "I" ? HIDDEN - 1 : HIDDEN };
    if (collides(state.board, state.piece)) state.over = true;
  }

  function move(state, dx, dy) {
    const moved = { ...state.piece, x: state.piece.x + dx, y: state.piece.y + dy };
    if (collides(state.board, moved)) return false;
    state.piece = moved;
    return true;
  }

  // dir: 1 = 시계 방향, -1 = 반시계 방향. 그 자리에서 못 돌면 벽 차기 후보를 차례로 시도한다
  function rotate(state, dir) {
    const p = state.piece;
    if (p.type === "O") return false;
    const rot = (p.rot + dir + 4) % 4;
    const kicks = (p.type === "I" ? KICKS_I : KICKS_JLSTZ)[p.rot + ">" + rot];
    for (const [dx, dy] of kicks) {
      const turned = { ...p, rot, x: p.x + dx, y: p.y - dy };
      if (!collides(state.board, turned)) {
        state.piece = turned;
        return true;
      }
    }
    return false;
  }

  const grounded = (state) => collides(state.board, { ...state.piece, y: state.piece.y + 1 });

  // 지금 조각을 그대로 떨어뜨렸을 때 멈추는 y (바닥 미리보기용)
  function ghostY(state) {
    const p = { ...state.piece };
    while (!collides(state.board, { ...p, y: p.y + 1 })) p.y++;
    return p.y;
  }

  // 조각을 판에 굳히고, 꽉 찬 줄을 지우고, 다음 조각을 낸다. 지워진 줄 번호들을 돌려준다
  function lockPiece(state) {
    for (const [x, y] of cells(state.piece)) {
      if (y >= 0) state.board[y][x] = state.piece.type;
    }
    const cleared = [];
    state.board.forEach((row, y) => {
      if (row.every((v) => v !== null)) cleared.push(y);
    });
    if (cleared.length) {
      state.board = state.board.filter((_, y) => !cleared.includes(y));
      while (state.board.length < ROWS) state.board.unshift(Array(COLS).fill(null));
      state.score += LINE_SCORES[cleared.length] * state.level;
      state.lines += cleared.length;
      state.level = Math.floor(state.lines / LINES_PER_LEVEL) + 1;
    }
    spawn(state);
    return cleared;
  }

  // 바닥까지 한 번에 내리고 굳힌다. 내려간 칸당 2점
  function hardDrop(state) {
    const y = ghostY(state);
    state.score += (y - state.piece.y) * 2;
    state.piece.y = y;
    return lockPiece(state);
  }

  // 레벨별로 한 칸 떨어지는 데 걸리는 시간(초). 표준 가이드라인 공식
  function gravityInterval(level) {
    const l = Math.min(level, MAX_SPEED_LEVEL) - 1;
    return Math.pow(0.8 - l * 0.007, l);
  }

  return {
    COLS, ROWS, VISIBLE_ROWS, HIDDEN, TYPES, SHAPES,
    cells, collides, createState, move, rotate, grounded, ghostY, lockPiece, hardDrop, gravityInterval,
  };
})();

if (typeof module !== "undefined") module.exports = Logic;
