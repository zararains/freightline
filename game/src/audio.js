// audio.js — 100% procedural WebAudio. No audio files.
// Design decision: every sound is synthesized from oscillators and filtered
// noise bursts so the build stays fully self-contained and offline.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 1;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  noise(dur, freq, gain, type = 'lowpass', when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const src = this.ctx.createBufferSource(); src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.05);
  }
  tone(freq, dur, gain, type = 'square', slideTo = null, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }
  shot(kind) {
    // Distinct voice per weapon class: pistol cracks, SMG chatters,
    // rifle booms lower, sniper is a single heavy crack with a tail.
    if (kind === 'pistol') { this.noise(0.12, 3200, 0.5, 'highpass'); this.tone(210, 0.08, 0.25, 'square', 70); }
    else if (kind === 'smg') { this.noise(0.09, 2600, 0.42, 'bandpass'); this.tone(180, 0.06, 0.2, 'square', 80); }
    else if (kind === 'rifle') { this.noise(0.18, 1500, 0.6); this.tone(130, 0.12, 0.3, 'sawtooth', 55); }
    else if (kind === 'sniper') { this.noise(0.4, 1100, 0.75); this.tone(90, 0.3, 0.35, 'sawtooth', 40); this.noise(0.25, 500, 0.3, 'lowpass', 0.05); }
    else { this.noise(0.1, 2000, 0.4); }
  }
  dryFire() { this.tone(1200, 0.03, 0.08, 'square'); }
  reload() { this.tone(500, 0.05, 0.12, 'square'); this.tone(340, 0.05, 0.12, 'square', null, 0.14); this.tone(700, 0.05, 0.14, 'square', null, 0.3); }
  hitTick() { this.tone(1500, 0.05, 0.16, 'sine'); }
  headshotTick() { this.tone(2100, 0.07, 0.2, 'sine'); this.tone(2600, 0.05, 0.12, 'sine', null, 0.04); }
  hurt() { this.tone(160, 0.12, 0.2, 'sawtooth', 90); }
  footstep(run) { this.noise(0.06, run ? 700 : 500, run ? 0.1 : 0.06); }
  jump() { this.noise(0.08, 900, 0.08, 'bandpass'); }
  plantBeep(final) { this.tone(final ? 1560 : 1040, final ? 0.22 : 0.09, 0.2, 'sine'); }
  plantDone() { this.tone(880, 0.1, 0.2, 'sine'); this.tone(1320, 0.16, 0.2, 'sine', null, 0.1); }
  defuseTick() { this.tone(1180, 0.05, 0.12, 'sine'); }
  explosion() {
    this.noise(1.4, 220, 1.0);
    this.tone(60, 1.1, 0.7, 'sine', 28);
    this.noise(0.5, 3000, 0.4, 'highpass');
  }
  grenadeBoom() { this.noise(0.7, 300, 0.8); this.tone(75, 0.6, 0.5, 'sine', 35); }
  flashPop() { this.noise(0.25, 4000, 0.5, 'highpass'); this.tone(2400, 0.3, 0.15, 'sine', 1800); }
  buy() { this.tone(990, 0.06, 0.14, 'sine'); this.tone(1480, 0.09, 0.14, 'sine', null, 0.06); }
  deny() { this.tone(220, 0.12, 0.14, 'square', 160); }
  roundWin() { [523, 659, 784].forEach((f, i) => this.tone(f, 0.22, 0.18, 'triangle', null, i * 0.13)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this.tone(f, 0.24, 0.18, 'triangle', null, i * 0.14)); }
  matchWin() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.3, 0.2, 'triangle', null, i * 0.16)); }
}
