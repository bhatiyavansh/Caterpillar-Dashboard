/**
 * Alert sound.
 *
 * Anything that raises an alert on screen also makes a noise, so an operator
 * looking at the bucket and not the display still knows something changed.
 *
 * The chime is a struck bell in the car-dashboard idiom, synthesised with
 * WebAudio rather than shipped as an asset: no network round trip on the one
 * event that must not be late, and no binary in the repo. Pitch, spacing and
 * strike count are picked at random — the point is that a sound happened, not
 * which one.
 *
 * Browsers refuse to start audio before the page has been interacted with, so
 * `unlockAlertSound()` arms the context on the first gesture and every call
 * before that is a silent no-op rather than an error.
 */

/** The least an alert has to look like for this module to speak for it. */
export interface SoundableAlert {
  id: string;
  severity?: string;
  acknowledged?: boolean;
}

type Ctor = typeof AudioContext;

const STORAGE_KEY = "cat.alert-sound.muted";
/**
 * Two alerts landing close together are one chime, not a burst. Long enough
 * that a chime finishes ringing before the next one can start on top of it.
 */
const MIN_GAP_MS = 900;

let ctx: AudioContext | null = null;
let armed = false;
/** `null` until the stored preference is read on first use. */
let muted: boolean | null = null;
let lastPlayedAt = 0;

/**
 * Open alert ids per reporting source. A source's first report primes it
 * instead of playing, and an id that leaves every source is forgotten — so an
 * advisory that clears and comes back is heard again.
 */
const seenBySource = new Map<string, Set<string>>();

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function readMuted(): boolean {
  if (!isBrowser()) return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Lazily built, and resumed if the browser parked it. */
function context(): AudioContext | null {
  if (!isBrowser()) return null;
  if (!ctx) {
    const Ctor: Ctor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      ctx = new Ctor();
      // Any master chain belonged to the previous context.
      bus = null;
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

/**
 * Arm audio on the first user gesture. Safe to call as often as you like; only
 * the first call does anything.
 */
export function unlockAlertSound(): void {
  if (armed || !isBrowser()) return;
  armed = true;

  const open = () => {
    context();
    for (const event of ["pointerdown", "keydown", "touchstart"] as const) {
      window.removeEventListener(event, open);
    }
  };
  for (const event of ["pointerdown", "keydown", "touchstart"] as const) {
    window.addEventListener(event, open, { passive: true });
  }
}

/** Notified whenever the mute preference changes, for UI that shows it. */
const muteListeners = new Set<() => void>();

export function subscribeAlertSound(listener: () => void): () => void {
  muteListeners.add(listener);
  return () => muteListeners.delete(listener);
}

export function isAlertSoundMuted(): boolean {
  if (muted === null) muted = readMuted();
  return muted;
}

export function setAlertSoundMuted(next: boolean): void {
  muted = next;
  for (const listener of muteListeners) listener();
  if (!isBrowser()) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* private mode; the in-memory flag still holds for this session */
  }
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(Math.random() * list.length)]!;
}

/**
 * Partials of a struck bell, as [frequency ratio, level, decay scale].
 *
 * The ratios are deliberately inharmonic — that is what separates a bell from
 * an organ note, and it is why the chime cuts through engine noise instead of
 * blending into it. Higher partials decay fastest, which is the metallic
 * "ting" at the front of the strike.
 */
const PARTIALS: readonly (readonly [number, number, number])[] = [
  [1, 1, 1],
  [2.0, 0.55, 0.75],
  [2.76, 0.45, 0.5],
  [4.07, 0.3, 0.3],
  [5.43, 0.22, 0.2],
  [6.8, 0.14, 0.12],
];

/**
 * Master chain, built once per context: everything goes through a compressor so
 * the chime can be driven hard without clipping into distortion.
 */
let bus: GainNode | null = null;

function master(audio: AudioContext): GainNode {
  if (bus) return bus;

  const gain = audio.createGain();
  gain.gain.value = 1;

  const limiter = audio.createDynamicsCompressor();
  limiter.threshold.setValueAtTime(-8, audio.currentTime);
  limiter.knee.setValueAtTime(0, audio.currentTime);
  limiter.ratio.setValueAtTime(20, audio.currentTime);
  limiter.attack.setValueAtTime(0.001, audio.currentTime);
  limiter.release.setValueAtTime(0.12, audio.currentTime);

  gain.connect(limiter).connect(audio.destination);
  bus = gain;
  return bus;
}

/**
 * The hammer hitting the bell: a couple of milliseconds of filtered noise.
 *
 * Without it the partials fade up and the chime sounds synthetic; with it the
 * onset is a hard edge, which is most of what reads as "sharp".
 */
function strike(audio: AudioContext, at: number, freq: number, gain: number) {
  const frames = Math.floor(audio.sampleRate * 0.006);
  const buffer = audio.createBuffer(1, frames, audio.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) {
    // Noise under a steep decay, so it is a click and not a hiss.
    data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  }

  const src = audio.createBufferSource();
  src.buffer = buffer;

  // Keep only the bright end; the low noise would just muddy the strike.
  const band = audio.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.setValueAtTime(freq * 3, at);
  band.Q.setValueAtTime(1.2, at);

  const amp = audio.createGain();
  amp.gain.setValueAtTime(gain * 0.9, at);

  src.connect(band).connect(amp).connect(master(audio));
  src.start(at);
  src.stop(at + 0.02);
}

/** One strike of the bell: the transient, then the partials ringing out under it. */
function ding(audio: AudioContext, at: number, freq: number, decay: number, gain: number) {
  strike(audio, at, freq, gain);

  for (const [ratio, level, decayScale] of PARTIALS) {
    const osc = audio.createOscillator();
    const amp = audio.createGain();
    const length = decay * decayScale;

    // Bell partials are pure tones; the character is in the ratios, not the wave.
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * ratio, at);

    amp.gain.setValueAtTime(0.0001, at);
    amp.gain.exponentialRampToValueAtTime(gain * level, at + 0.0015);
    amp.gain.exponentialRampToValueAtTime(0.0001, at + length);

    osc.connect(amp).connect(master(audio));
    osc.start(at);
    osc.stop(at + length + 0.02);
  }
}

/**
 * Play an alert noise right now: a car-cabin chime — a struck bell, repeated.
 *
 * `severity` only decides how many strikes and how insistent the spacing is;
 * the pitch and the interval between strikes are chosen at random per call.
 */
export function playAlertSound(severity?: string): void {
  if (!armed) unlockAlertSound();
  if (isAlertSoundMuted()) return;

  const audio = context();
  if (!audio || audio.state !== "running") return;

  const now = Date.now();
  if (now - lastPlayedAt < MIN_GAP_MS) return;
  lastPlayedAt = now;

  const critical = severity === "critical";
  const strikes = critical ? pick([4, 5]) : pick([2, 3]);
  // Dashboard-chime territory: high enough to carry, low enough not to shriek.
  const root = pick(critical ? [1046, 1174, 1318] : [784, 880, 932]);
  const decay = critical ? 0.42 : 0.6;
  const gain = critical ? 0.9 : 0.7;
  // Urgent chimes are fast and even; an advisory gets the lazier two-tone.
  const step = critical ? pick([0.16, 0.19]) : pick([0.26, 0.31]);
  // The classic seatbelt ding alternates a whole tone; which way is random.
  const second = pick([1.122, 0.891, 1.26]);

  const start = audio.currentTime + 0.01;
  for (let i = 0; i < strikes; i += 1) {
    ding(audio, start + i * step, i % 2 === 0 ? root : root * second, decay, gain);
  }
}

/** Is this id already open somewhere else on screen? */
function known(id: string, exceptSource: string): boolean {
  for (const [source, ids] of seenBySource) {
    if (source !== exceptSource && ids.has(id)) return true;
  }
  return false;
}

/**
 * Report the alerts a screen is currently showing; anything not heard before
 * makes a noise.
 *
 * The first report from a given `source` primes the module instead of playing,
 * so opening a page with alerts already standing is silent and only genuinely
 * new alerts are audible. An id open in another source stays quiet too, so the
 * same alert shown in three places is still one beep.
 */
export function announceAlerts(alerts: readonly SoundableAlert[], source = "default"): void {
  if (!isBrowser()) return;
  if (!armed) unlockAlertSound();

  const previous = seenBySource.get(source);
  const fresh = previous
    ? alerts.filter((a) => a && !a.acknowledged && !previous.has(a.id) && !known(a.id, source))
    : [];

  seenBySource.set(source, new Set(alerts.filter((a) => a && !a.acknowledged).map((a) => a.id)));

  if (!previous) return;
  if (!fresh.length) return;

  playAlertSound(fresh.some((a) => a.severity === "critical") ? "critical" : fresh[0]!.severity);
}

/**
 * Drop a source's record, for when the screen reporting it unmounts. Alerts it
 * was the only one holding become audible again if they are raised afresh.
 */
export function forgetAlertSource(source: string): void {
  seenBySource.delete(source);
}

/** Forget every announced alert. Used by tests and by the director's reset. */
export function resetAlertSound(): void {
  seenBySource.clear();
  lastPlayedAt = 0;
}
