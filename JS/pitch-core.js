// ============================================================
// pitch-core.js
// QNPITCH共通：マイク入力・ピッチ検出アルゴリズム。DOM操作なし。
// TUNERMODE（pitch-mode-tuner.js）・PITCHMODE（pitch-mode-pitch.js）
// の両方から参照される。
//
// 【由来】旧QNTUNER(player.js)・旧QNPITCH(app.js)がそれぞれ個別に
// 実装していた、ほぼ同じ内容のautoCorrelate（自己相関法によるピッチ
// 検出）・freqToMidi/freqToNote・midiToNoteNameを統合したもの。
//
// 【将来のユースケースを見据えた設計】いずれ「PLAYER再生中に
// チューニング」「曲を流しながらの音程チェック」を見据え、解析対象の
// 入力をgetUserMediaのマイクストリームに決め打ちせず、任意の
// AudioNodeを解析できる形にしてある（startFromMic / startFromNodeの
// 2つの入口）。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {

  // ==================== 音名・周波数ユーティリティ ====================
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;

  function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / A4);
  }

  function freqToNote(freq) {
    const midi = freqToMidi(freq);
    const roundedMidi = Math.round(midi);
    const cents = Math.round((midi - roundedMidi) * 100);
    const noteName = NOTE_NAMES[((roundedMidi % 12) + 12) % 12];
    const octave = Math.floor(roundedMidi / 12) - 1;
    return { noteName, octave, cents, midi: roundedMidi };
  }

  function noteToFreq(midi) {
    return A4 * Math.pow(2, (midi - 69) / 12);
  }

  function midiToNoteName(midi) {
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${name}${oct}`;
  }

  // ==================== ピッチ検出（自己相関法） ====================
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { freq: -1, rms };

    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) {
      if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    }
    for (let i = 1; i < SIZE / 2; i++) {
      if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    }
    const trimmed = buf.slice(r1, r2);
    const newSize = trimmed.length;

    const c = new Array(newSize).fill(0);
    for (let i = 0; i < newSize; i++) {
      for (let j = 0; j < newSize - i; j++) {
        c[i] += trimmed[j] * trimmed[j + i];
      }
    }

    let d = 0;
    while (d < newSize - 1 && c[d] > c[d + 1]) d++;

    let maxVal = -1, maxPos = -1;
    for (let i = d; i < newSize; i++) {
      if (c[i] > maxVal) { maxVal = c[i]; maxPos = i; }
    }
    let T0 = maxPos;
    if (T0 <= 0) return { freq: -1, rms };

    const x1 = c[T0 - 1] || c[T0];
    const x2 = c[T0];
    const x3 = c[T0 + 1] || c[T0];
    const a = (x1 + x3 - 2 * x2) / 2;
    const b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);

    const freq = sampleRate / T0;
    return { freq, rms };
  }

  // ==================== 解析セッション ====================
  function createAnalysisSession(options) {
    const opts = options || {};
    const fftSize = opts.fftSize || 2048;
    const onFrame = typeof opts.onFrame === "function" ? opts.onFrame : function () {};

    let audioCtx = null;
    let mediaStream = null;
    let sourceNode = null;
    let analyser = null;
    let dataBuf = null;
    let rafId = null;
    let ownsAudioCtx = false;

    function tick() {
      if (!analyser || !audioCtx) return;
      analyser.getFloatTimeDomainData(dataBuf);
      const result = autoCorrelate(dataBuf, audioCtx.sampleRate);
      onFrame(result, { sampleRate: audioCtx.sampleRate });
      rafId = requestAnimationFrame(tick);
    }

    function attachAnalyser(ctx, srcNode) {
      audioCtx = ctx;
      sourceNode = srcNode;
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = fftSize;
      sourceNode.connect(analyser);
      dataBuf = new Float32Array(analyser.fftSize);
      rafId = requestAnimationFrame(tick);
    }

    async function startFromMic(constraints) {
      ownsAudioCtx = true;
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      mediaStream = await navigator.mediaDevices.getUserMedia(
        constraints || {
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false
          }
        }
      );
      const srcNode = audioCtx.createMediaStreamSource(mediaStream);
      attachAnalyser(audioCtx, srcNode);
    }

    // 将来、PLAYER再生音を同じ検出関数で解析するための入口。
    function startFromNode(existingAudioCtx, existingSourceNode) {
      ownsAudioCtx = false;
      attachAnalyser(existingAudioCtx, existingSourceNode);
    }

    function stop() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      if (mediaStream) {
        mediaStream.getTracks().forEach(t => t.stop());
        mediaStream = null;
      }
      if (ownsAudioCtx && audioCtx) {
        audioCtx.close();
      }
      audioCtx = null;
      sourceNode = null;
      analyser = null;
      dataBuf = null;
    }

    return { startFromMic, startFromNode, stop };
  }

  // ==================== 公開 ====================
  window.QNPitch.core = {
    NOTE_NAMES,
    A4,
    freqToMidi,
    freqToNote,
    noteToFreq,
    midiToNoteName,
    autoCorrelate,
    createAnalysisSession
  };
})();
