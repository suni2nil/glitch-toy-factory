let context, master, ambientTimer, muted = localStorage.getItem('toy-audio-muted') === '1';
const scale = [0, 3, 7, 10, 12, 10, 7, 5];
function ensureAudio() {
  if (!context) {
    context = new (window.AudioContext || window.webkitAudioContext)();
    master = context.createGain(); master.gain.value = muted ? 0 : .42; master.connect(context.destination);
  }
  if (context.state === 'suspended') context.resume();
  if (!ambientTimer) {
    let beat = 0;
    ambientTimer = window.setInterval(() => {
      if (muted || !context) return;
      const now = context.currentTime;
      const note = scale[beat++ % scale.length];
      tone(164.81 * Math.pow(2, note / 12), now, 1.25, .012, 'sine');
      if (beat % 4 === 0) tone(246.94 * Math.pow(2, note / 12), now + .07, 1.05, .007, 'triangle');
    }, 1600);
  }
}
function tone(frequency, start, duration, volume, type = 'sine') {
  if (!context || muted) return;
  const oscillator = context.createOscillator(), gain = context.createGain();
  oscillator.type = type; oscillator.frequency.setValueAtTime(frequency, start);
  gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .04);
  gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
  oscillator.connect(gain); gain.connect(master); oscillator.start(start); oscillator.stop(start + duration + .03);
}
export function startAudio() { try { ensureAudio(); } catch {} }
export function getMuted() { return muted; }
export function toggleMute() {
  muted = !muted; localStorage.setItem('toy-audio-muted', muted ? '1' : '0');
  if (context && master) master.gain.setTargetAtTime(muted ? 0 : .42, context.currentTime, .08);
  if (!muted) startAudio();
  return muted;
}
export function playSfx(name = 'click') {
  try {
    ensureAudio(); if (muted) return;
    const now = context.currentTime;
    const patterns = {
      click: [[660, .09, .035]], join: [[523, .1, .05],[784, .18, .04]], task: [[523,.12,.05],[659,.12,.05],[784,.24,.045]],
      kill: [[220,.12,.06],[145,.32,.055]], report: [[660,.1,.055],[880,.18,.055],[660,.25,.06]],
      sabotage: [[196,.12,.055],[147,.18,.05],[110,.34,.04]], win: [[523,.12,.06],[659,.12,.06],[784,.12,.06],[1047,.44,.055]],
      vote: [[440,.12,.045],[392,.2,.045]], emote: [[660,.1,.035],[880,.15,.035]]
    };
    (patterns[name] || patterns.click).forEach(([f,d,v],i)=>tone(f,now+i*.095,d,v,'triangle'));
  } catch {}
}
