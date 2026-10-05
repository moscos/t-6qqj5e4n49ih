// 배경 음악 악보. 오리지널 테트리스 음악으로 알려진 러시아 민요 "코로베이니키"(1861년, 저작권 만료)의
// 가락을 직접 옮겨 적은 것이다. 소리 파일 없이 sound.js가 이 악보를 전자음으로 연주한다.
//
// 마디마다 [음이름, 길이(박)] 목록으로 적는다. 음이름이 null이면 쉼표. 한 마디는 4박.

const Song = (() => {
  const BPM = 144;

  const PART_A = [
    [["E5", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["C5", 0.5], ["B4", 0.5]],
    [["A4", 1], ["A4", 0.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5]],
    [["B4", 1.5], ["C5", 0.5], ["D5", 1], ["E5", 1]],
    [["C5", 1], ["A4", 1], ["A4", 2]],
    [[null, 0.5], ["D5", 1], ["F5", 0.5], ["A5", 1], ["G5", 0.5], ["F5", 0.5]],
    [["E5", 1.5], ["C5", 0.5], ["E5", 1], ["D5", 0.5], ["C5", 0.5]],
    [["B4", 1], ["B4", 0.5], ["C5", 0.5], ["D5", 1], ["E5", 1]],
    [["C5", 1], ["A4", 1], ["A4", 1], [null, 1]],
  ];
  const PART_B = [
    [["E5", 2], ["C5", 2]],
    [["D5", 2], ["B4", 2]],
    [["C5", 2], ["A4", 2]],
    [["G#4", 2], ["B4", 1], [null, 1]],
    [["E5", 2], ["C5", 2]],
    [["D5", 2], ["B4", 2]],
    [["C5", 1], ["E5", 1], ["A5", 2]],
    [["G#5", 4]],
  ];
  // 마디별 베이스 근음. 근음과 한 옥타브 위를 8분음표로 번갈아 친다
  const BASS_A = ["E2", "A2", "G#2", "A2", "D2", "C2", "E2", "A2"];
  const BASS_B = ["A2", "E2", "A2", "E2", "A2", "E2", "A2", "E2"];

  const SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function freq(name) {
    const sharp = name[1] === "#";
    const midi = 12 * (parseInt(name.slice(sharp ? 2 : 1), 10) + 1) + SEMITONES[name[0]] + (sharp ? 1 : 0);
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  // 전체 곡(A-A-B)을 시간순 음 목록으로 펼친다: {t: 시작 박, dur: 길이(박), freq, voice}
  function build() {
    const events = [];
    let measureStart = 0;
    for (const [melody, bass] of [[PART_A, BASS_A], [PART_A, BASS_A], [PART_B, BASS_B]]) {
      melody.forEach((measure, m) => {
        let t = measureStart;
        for (const [name, dur] of measure) {
          if (name) events.push({ t, dur, freq: freq(name), voice: "melody" });
          t += dur;
        }
        for (let i = 0; i < 8; i++) {
          events.push({ t: measureStart + i * 0.5, dur: 0.5, freq: freq(bass[m]) * (i % 2 ? 2 : 1), voice: "bass" });
        }
        measureStart += 4;
      });
    }
    events.sort((a, b) => a.t - b.t);
    return { beats: measureStart, events };
  }

  return { BPM, PART_A, PART_B, freq, build };
})();

if (typeof module !== "undefined") module.exports = Song;
