// 소리: 배경 음악(song.js의 악보를 연주)과 효과음. 소리 파일 없이 전부 Web Audio로 합성한다.
//
// 브라우저(특히 아이폰)는 사용자가 화면을 터치한 뒤에야 소리를 허용하므로, 버튼을 누르는 시점에
// unlock()을 불러 준다. 아이폰 옆면 무음 스위치가 켜져 있으면 소리는 나지 않는다.

const Sound = (() => {
  const LOOKAHEAD = 0.25; // 음악은 이만큼(초) 앞까지만 미리 예약해 둔다. 멈출 때 남는 소리를 줄이기 위해
  const TICK_MS = 50;
  const MUSIC_VOLUME = 0.11;
  const SFX_VOLUME = 0.22;

  let ctx = null;
  let musicBus = null;
  let sfxBus = null;
  let musicOn = true;
  let sfxOn = true;

  const song = Song.build();
  const secondsPerBeat = 60 / Song.BPM;
  let ticker = null;
  let loopStart = 0; // 지금 도는 반복이 시작된 시각 (ctx.currentTime 기준)
  let nextIndex = 0; // 다음에 예약할 음
  let pausedAtBeat = null; // 일시정지한 위치. null이면 처음부터
  let scheduledNotes = 0;

  function unlock() {
    if (!ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      musicBus = ctx.createGain();
      sfxBus = ctx.createGain();
      musicBus.gain.value = MUSIC_VOLUME;
      sfxBus.gain.value = SFX_VOLUME;
      musicBus.connect(ctx.destination);
      sfxBus.connect(ctx.destination);
    }
    if (ctx.state !== "running") ctx.resume().catch(() => {});
  }

  // 음 하나: 짧게 올라갔다가 끝에서 사라지게 해서 뚝뚝 끊기는 잡음을 없앤다
  function tone(bus, type, freq, start, dur, volume = 1, slideTo = null) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, start + dur);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.006);
    gain.gain.setValueAtTime(volume, start + Math.max(0.006, dur - 0.02));
    gain.gain.linearRampToValueAtTime(0, start + dur);
    osc.connect(gain);
    gain.connect(bus);
    osc.start(start);
    osc.stop(start + dur + 0.02);
  }

  // ---- 배경 음악 ----

  function schedule() {
    const until = ctx.currentTime + LOOKAHEAD;
    for (;;) {
      if (nextIndex >= song.events.length) {
        nextIndex = 0;
        loopStart += song.beats * secondsPerBeat;
      }
      const ev = song.events[nextIndex];
      const start = loopStart + ev.t * secondsPerBeat;
      if (start > until) break;
      const dur = ev.dur * secondsPerBeat * 0.92; // 음 사이를 살짝 띄운다
      if (start >= ctx.currentTime - 0.05) {
        if (ev.voice === "melody") tone(musicBus, "square", ev.freq, start, dur, 0.55);
        else tone(musicBus, "triangle", ev.freq, start, dur, 1);
        scheduledNotes++;
      }
      nextIndex++;
    }
  }

  function startMusic(fromBeginning) {
    stopTicker();
    if (!ctx || !musicOn) {
      if (fromBeginning) pausedAtBeat = null;
      return;
    }
    const beat = fromBeginning || pausedAtBeat === null ? 0 : pausedAtBeat;
    loopStart = ctx.currentTime + 0.06 - beat * secondsPerBeat;
    nextIndex = song.events.findIndex((ev) => ev.t >= beat);
    if (nextIndex < 0) nextIndex = song.events.length;
    pausedAtBeat = null;
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(MUSIC_VOLUME, ctx.currentTime);
    schedule();
    ticker = setInterval(schedule, TICK_MS);
  }

  function stopTicker() {
    if (ticker) clearInterval(ticker);
    ticker = null;
  }

  // 음악을 멈춘다. remember가 참이면 그 자리를 기억해 두었다가 이어서 연주한다
  function stopMusic(remember) {
    const wasPlaying = ticker !== null;
    stopTicker();
    if (!ctx) return;
    if (wasPlaying) {
      const beat = ((ctx.currentTime - loopStart) / secondsPerBeat) % song.beats;
      pausedAtBeat = remember ? Math.max(0, beat) : null;
      // 이미 예약된 음이 잠깐 더 울리지 않도록 음악 전체 음량을 바로 내린다
      musicBus.gain.cancelScheduledValues(ctx.currentTime);
      musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
      musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.04);
    } else if (!remember) {
      pausedAtBeat = null;
    }
  }

  // ---- 효과음 ----

  const SFX = {
    move: (t) => tone(sfxBus, "square", 320, t, 0.035, 0.35),
    rotate: (t) => tone(sfxBus, "square", 520, t, 0.05, 0.4, 700),
    soft: (t) => tone(sfxBus, "square", 200, t, 0.025, 0.2),
    lock: (t) => tone(sfxBus, "triangle", 150, t, 0.09, 1, 70),
    drop: (t) => {
      tone(sfxBus, "triangle", 220, t, 0.12, 1, 55);
      tone(sfxBus, "square", 110, t, 0.05, 0.3, 60);
    },
    clear: (t) => [523, 659, 784].forEach((f, i) => tone(sfxBus, "square", f, t + i * 0.06, 0.09, 0.5)),
    tetris: (t) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => tone(sfxBus, "square", f, t + i * 0.075, 0.11, 0.55)),
    levelUp: (t) => [659, 880, 1319].forEach((f, i) => tone(sfxBus, "triangle", f, t + 0.25 + i * 0.09, 0.14, 1)),
    gameOver: (t) => [392, 330, 262, 196, 131].forEach((f, i) => tone(sfxBus, "square", f, t + i * 0.16, 0.2, 0.5)),
  };

  function play(name) {
    if (!ctx || !sfxOn || ctx.state !== "running") return;
    SFX[name](ctx.currentTime + 0.005);
  }

  return {
    unlock,
    play,
    startMusic,
    stopMusic,
    setMusic(on) {
      musicOn = on;
      if (!on) stopMusic(true);
    },
    setSfx(on) {
      sfxOn = on;
    },
    get musicPlaying() { return ticker !== null; },
    get scheduledNotes() { return scheduledNotes; },
    get state() { return ctx ? ctx.state : "none"; },
  };
})();
