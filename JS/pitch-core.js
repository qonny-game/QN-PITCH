// ============================================================
// pitch-core.js
// QNPITCH共通：マイク入力・ピッチ検出アルゴリズム。DOM操作なし。
// TUNERMODE（pitch-mode-tuner.js）・PITCHMODE（pitch-mode-pitch.js）
// の両方から参照される、md/AI_ASSISTANT_PROJECT_CONTEXT.md §0-3で
// 決めた「ピッチ検出コアの1本化」の実体。
//
// 【移植元】旧QNTUNER(player.js)・旧QNPITCH(app.js)は、ほぼ同じ内容の
// autoCorrelate（自己相関法によるピッチ検出）・freqToMidi/freqToNote・
// midiToNoteName をそれぞれ個別に実装していた。このファイルはその
// 重複を解消し、1つの実装に統合したもの。フィルタ処理（rms早期return
// せず{freq, rms}を返し、呼び出し側にフィルタ判断を委ねる設計）は
// 旧QNPITCH側の方が柔軟だったため、それを踏襲している。
//
// 【将来のユースケースを見据えた設計】§0-2の追加方針の通り、いずれ
// 「PLAYER再生中にチューニング」「曲を流しながらの音程チェック」を
// 見据え、解析対象の入力を getUserMedia のマイクストリームに決め打ち
// せず、任意の AudioNode を解析できる形にしてある
// （startAnalysisFromStream / startAnalysisFromNode の2つの入口）。
// ============================================================

window.QNPitch = window.QNPitch || {};

(function () {

  // ==================== 音名・周波数ユーティリティ ====================
  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const A4 = 440;

  // frequency -> MIDIノート番号（小数、セント情報を含む）
  function freqToMidi(freq) {
    return 69 + 12 * Math.log2(freq / A4);
  }

  // frequency -> { noteName, octave, cents, midi(整数に丸めた値) }
  function freqToNote(freq) {
    const midi = freqToMidi(freq);
    const roundedMidi = Math.round(midi);
    const cents = Math.round((midi - roundedMidi) * 100);
    const noteName = NOTE_NAMES[((roundedMidi % 12) + 12) % 12];
    const octave = Math.floor(roundedMidi / 12) - 1;
    return { noteName, octave, cents, midi: roundedMidi };
  }

  // MIDIノート番号 -> frequency
  function noteToFreq(midi) {
    return A4 * Math.pow(2, (midi - 69) / 12);
  }

  // MIDIノート番号（整数）-> "C4"のような表示名
  function midiToNoteName(midi) {
    const name = NOTE_NAMES[((midi % 12) + 12) % 12];
    const oct = Math.floor(midi / 12) - 1;
    return `${name}${oct}`;
  }

  // ==================== ピッチ検出（自己相関法） ====================
  // buf: Float32Array（analyser.getFloatTimeDomainDataの出力）
  // sampleRate: audioCtx.sampleRate
  // 戻り値: { freq, rms }。freq === -1 は無音/検出不能。
  // 呼び出し側で freq の妥当範囲（例：30〜2000Hz）を判断すること
  // （用途によって許容範囲が異なるため、ここでは範囲チェックしない）。
  function autoCorrelate(buf, sampleRate) {
    const SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.01) return { freq: -1, rms };

    // 振幅の小さい両端をトリムする
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

    // 放物線補間で精度を上げる
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
  // マイク（またはAudioNode）からの継続的なピッチ解析を1つのセッション
  // として管理する。呼び出し側（TUNERMODE/PITCHMODE）はこれを使い、
  // 個別にAudioContext/AnalyserNodeを持たない。
  //
  // 使い方：
  //   const session = window.QNPitch.core.createAnalysisSession({
  //     fftSize: 2048,
  //     onFrame(result, ctx) {
  //       // result: { freq, rms } / ctx: { sampleRate }
  //     }
  //   });
  //   await session.startFromMic();   // マイク入力を解析
  //   session.stop();
  //
  // 将来、PLAYER再生音を解析したくなった場合は
  //   session.startFromNode(playerAudioContext, playerSourceNode)
  // のように、既存のAudioContext/AudioNodeを渡す経路を使う
  // （マイク経由と同じonFrameコールバックで結果を受け取れる）。
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
    let ownsAudioCtx = false; // マイク経由の場合、このセッションがAudioContextを所有し、stop()時にcloseする

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

    // マイク入力から解析を開始する（TUNERMODE/PITCHMODEの通常の入口）。
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

    // 既存のAudioContext/AudioNodeを解析対象にする（§0-2：将来、
    // PLAYER再生音を同じ検出関数で解析するための入口。現段階の
    // QNPITCH単体実装では未使用だが、大改造なしで拡張できるよう
    // 用意してある）。このセッションはAudioContextを所有しない
    // （stop()時にcloseしない＝呼び出し元のAudioContextを壊さない）。
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
