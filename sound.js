const sfx = (function () {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem("muted") === "1"; } catch (e) { /* private window, ignore */ }

  // ---- background music: a looping track, kept really quiet ----
  const MUSIC_FILE = "assets/CapyHapySoundtrack.mp3";   
  const MUSIC_VOLUME = 0.07;                            // 0 to 1.
  const music = new Audio(MUSIC_FILE);
  music.loop = true;
  music.volume = 0;
  let fadeTimer = null;

  function startMusic() {
    if (muted) return;
    music.play().catch(() => { /* browser said no (or file missing), no big deal */ });
    clearInterval(fadeTimer);
    fadeTimer = setInterval(() => {         // fade in over a few seconds so it sneaks up on you
      music.volume = Math.min(MUSIC_VOLUME, music.volume + MUSIC_VOLUME / 30);
      if (music.volume >= MUSIC_VOLUME) clearInterval(fadeTimer);
    }, 100);
  }

  // don't keep playing in a tab
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) music.pause();
    else if (!muted && music.currentTime > 0) music.play().catch(() => {});
  });

  function wake() {
    if (!ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      ctx = new AudioCtx();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  }

  // one beep. freq can slide to freqEnd. delay is in seconds from now
  function tone(freq, length, opts) {
    const c = wake();
    if (!c || muted) return;
    opts = opts || {};
    const start = c.currentTime + (opts.delay || 0);
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = opts.type || "sine";
    osc.frequency.setValueAtTime(freq, start);
    if (opts.freqEnd) osc.frequency.exponentialRampToValueAtTime(opts.freqEnd, start + length);
    const vol = opts.vol === undefined ? 0.2 : opts.vol;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(vol, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  // a burst of static-thumps, splats and crunches
  function noise(length, opts) {
    const c = wake();
    if (!c || muted) return;
    opts = opts || {};
    const start = c.currentTime + (opts.delay || 0);
    const buffer = c.createBuffer(1, Math.ceil(c.sampleRate * length), c.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    const src = c.createBufferSource();
    const filter = c.createBiquadFilter();
    const gain = c.createGain();
    src.buffer = buffer;
    filter.type = opts.filter || "lowpass";
    filter.frequency.value = opts.freq || 800;
    gain.gain.setValueAtTime(opts.vol === undefined ? 0.3 : opts.vol, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    src.connect(filter).connect(gain).connect(c.destination);
    src.start(start);
  }

  //just semitones above A3 (220Hz)
  const note = n => 220 * Math.pow(2, n / 12);

  const sounds = {
    select() { tone(660, 0.07, { type: "triangle", vol: 0.12 }); },
    ui() { tone(440, 0.06, { type: "square", vol: 0.06 }); tone(660, 0.08, { type: "square", vol: 0.06, delay: 0.05 }); },

    // the piece slamming down. bad move = deeper and louder
    stomp(tier) {
      const power = [1, 0.8, 0.6, 0.4, 0.25, 0][tier] || 0;
      if (!power) return;
      tone(150 * (1.4 - power * 0.4), 0.25, { freqEnd: 40, vol: 0.5 * power + 0.1 });
      noise(0.15 + power * 0.2, { freq: 600 + power * 600, vol: 0.4 * power });
    },

    // little ticks while the points count up. k goes 0..1, sign = gaining or losing
    tick(k, sign) {
      const f = sign >= 0 ? 400 + k * 600 : 500 - k * 300;
      tone(f, 0.04, { type: "square", vol: 0.05 });
    },

    // the verdict jingle for each tier
    sting(tier) {
      if (tier === 0) {            // gold: happy fanfare
        [0, 4, 7, 12].forEach((n, i) => tone(note(n + 12), 0.25, { type: "triangle", vol: 0.18, delay: i * 0.09 }));
        tone(note(24), 0.6, { type: "triangle", vol: 0.18, delay: 0.4 });
      } else if (tier === 1) {
        [0, 4, 7].forEach((n, i) => tone(note(n + 12), 0.22, { type: "triangle", vol: 0.15, delay: i * 0.09 }));
      } else if (tier === 2) {
        tone(note(7), 0.15, { type: "triangle", vol: 0.15 });
        tone(note(4), 0.25, { type: "triangle", vol: 0.15, delay: 0.14 });
      } else if (tier === 3) {
        tone(note(5), 0.2, { type: "sine", vol: 0.15 });
        tone(note(3), 0.3, { type: "sine", vol: 0.15, delay: 0.18 });
      } else if (tier === 4) {     // sad trombone
        [[7, 0], [6, 0.28], [5, 0.56]].forEach(p => tone(note(p[0]), 0.3, { type: "sawtooth", vol: 0.1, delay: p[1] }));
        tone(note(4), 0.8, { type: "sawtooth", vol: 0.1, freqEnd: note(2), delay: 0.84 });
      } else {                     // too slow: buzzer
        tone(110, 0.5, { type: "sawtooth", vol: 0.15 });
        tone(117, 0.5, { type: "sawtooth", vol: 0.15 });
      }
    },

    clock(secondsLeft) {
      tone(secondsLeft <= 2 ? 1100 : 800, 0.06, { type: "square", vol: 0.08 });
    },

    munch() {
      noise(0.09, { filter: "bandpass", freq: 900, vol: 0.5 });
      tone(180 + Math.random() * 60, 0.1, { type: "square", vol: 0.1, freqEnd: 90 });
    },
    splat() {
      noise(0.25, { filter: "lowpass", freq: 500, vol: 0.5 });
      tone(200, 0.3, { type: "sawtooth", vol: 0.12, freqEnd: 50 });
    },
    boing() { tone(300, 0.2, { freqEnd: 700, vol: 0.12 }); },

    jingle() {
      [0, 4, 7, 12].forEach((n, i) => tone(note(n + 7), 0.3, { type: "triangle", vol: 0.14, delay: i * 0.12 }));
    },
    gold() {
      [0, 4, 7, 12, 16, 19, 24].forEach((n, i) => tone(note(n + 12), 0.3, { type: "triangle", vol: 0.16, delay: i * 0.08 }));
      tone(note(24), 1.2, { type: "triangle", vol: 0.16, delay: 0.7 });
      tone(note(28), 1.2, { type: "triangle", vol: 0.12, delay: 0.7 });
    },
    gloom() {
      noise(1.2, { freq: 300, vol: 0.6 });
      tone(70, 1.4, { type: "sawtooth", vol: 0.2, freqEnd: 30 });
      [3, 2, 0].forEach((n, i) => tone(note(n - 12), 0.7, { type: "sine", vol: 0.15, delay: 0.5 + i * 0.5 }));
    }
  };

  function play(name, arg, arg2) {
    try {
      if (sounds[name]) sounds[name](arg, arg2);
    } catch (e) {
      console.warn("sound failed:", name, e);
    }
  }

  function toggle() {
    muted = !muted;
    try { localStorage.setItem("muted", muted ? "1" : "0"); } catch (e) { /* fine */ }
    if (muted) music.pause();
    else {
      startMusic();
      play("ui");
    }
    return muted;
  }

  // audio is locked until the first real click or key press
  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, function () {
    wake();
    startMusic();
  }, { once: true }));

  return { play: play, wake: wake, toggle: toggle, isMuted: () => muted, musicPlaying: () => !music.paused };
})();