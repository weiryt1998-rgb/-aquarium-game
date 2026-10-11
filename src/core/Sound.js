/**
 * เสียงเอฟเฟกต์สังเคราะห์ด้วย Web Audio (ไม่ต้องใช้ไฟล์เสียง)
 * ถ้าต้องการใช้ไฟล์เสียงจริงภายหลัง ให้แก้ที่ play() ได้เลย
 */
export class Sound {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.ambient = null;
    this.bubbleTimer = 2;
  }

  /** ต้องเรียกจาก user gesture (คลิก/แตะ) ครั้งแรก เพราะเบราว์เซอร์บล็อกเสียงอัตโนมัติ */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    this.ctx = new AudioCtx();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    const length = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;

    this.updateAmbient();
  }

  tone({ freq, to, duration = 0.15, type = 'sine', gain = 0.25, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(env).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  noise({ duration = 0.2, freq = 1200, q = 1, type = 'bandpass', gain = 0.2, delay = 0 }) {
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(gain, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(env).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  play(name) {
    if (!this.ctx || !this.settings.sound) return;
    switch (name) {
      case 'click':
        this.tone({ freq: 660, to: 520, duration: 0.06, type: 'triangle', gain: 0.12 });
        break;
      case 'coin':
        this.tone({ freq: 988, duration: 0.08, type: 'square', gain: 0.07 });
        this.tone({ freq: 1319, duration: 0.22, type: 'square', gain: 0.07, delay: 0.07 });
        break;
      case 'bubble':
        this.tone({ freq: 280 + Math.random() * 200, to: 900 + Math.random() * 400, duration: 0.09, gain: 0.08 });
        break;
      case 'splash':
        this.noise({ duration: 0.35, freq: 900, q: 0.7, gain: 0.25 });
        this.tone({ freq: 400, to: 1200, duration: 0.08, gain: 0.05, delay: 0.05 });
        break;
      case 'buy':
        [523, 659, 784, 1047].forEach((f, i) => this.tone({ freq: f, duration: 0.14, type: 'triangle', gain: 0.12, delay: i * 0.07 }));
        break;
      case 'error':
        this.tone({ freq: 180, to: 140, duration: 0.2, type: 'sawtooth', gain: 0.06 });
        break;
      case 'place':
        this.tone({ freq: 160, to: 70, duration: 0.18, gain: 0.25 });
        this.noise({ duration: 0.15, freq: 500, gain: 0.08 });
        break;
      case 'born':
        [784, 988, 1175, 1568].forEach((f, i) => this.tone({ freq: f, duration: 0.2, type: 'sine', gain: 0.1, delay: i * 0.09 }));
        break;
      case 'clean':
        this.noise({ duration: 0.8, freq: 3000, q: 0.5, type: 'highpass', gain: 0.08 });
        [600, 800, 1000].forEach((f, i) => this.tone({ freq: f, to: f * 1.6, duration: 0.1, gain: 0.05, delay: 0.1 + i * 0.12 }));
        break;
      case 'camera':
        this.noise({ duration: 0.06, freq: 4000, q: 1, gain: 0.25 });
        this.noise({ duration: 0.08, freq: 2500, q: 1, gain: 0.2, delay: 0.09 });
        break;
      case 'sad':
        this.tone({ freq: 440, to: 330, duration: 0.4, type: 'triangle', gain: 0.1 });
        this.tone({ freq: 330, to: 247, duration: 0.5, type: 'triangle', gain: 0.1, delay: 0.35 });
        break;
      case 'mission':
        [659, 784, 988, 1319].forEach((f, i) => this.tone({ freq: f, duration: 0.18, type: 'square', gain: 0.05, delay: i * 0.08 }));
        break;
      default:
        break;
    }
  }

  /** เสียงน้ำไหลเบา ๆ เป็นพื้นหลัง */
  updateAmbient() {
    if (!this.ctx) return;
    const want = this.settings.ambient;
    if (want && !this.ambient) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      src.loop = true;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 420;
      const lfo = this.ctx.createOscillator();
      const lfoGain = this.ctx.createGain();
      lfo.frequency.value = 0.12;
      lfoGain.gain.value = 160;
      lfo.connect(lfoGain).connect(filter.frequency);
      const gain = this.ctx.createGain();
      gain.gain.value = 0.05;
      src.connect(filter).connect(gain).connect(this.master);
      src.start();
      lfo.start();
      this.ambient = { src, lfo, gain };
    } else if (!want && this.ambient) {
      this.ambient.src.stop();
      this.ambient.lfo.stop();
      this.ambient.gain.disconnect();
      this.ambient = null;
    }
  }

  update(dt) {
    if (!this.ambient || !this.settings.sound) return;
    this.bubbleTimer -= dt;
    if (this.bubbleTimer <= 0) {
      this.bubbleTimer = 1.5 + Math.random() * 4;
      this.tone({ freq: 300 + Math.random() * 300, to: 800 + Math.random() * 600, duration: 0.07, gain: 0.025 });
    }
  }
}
