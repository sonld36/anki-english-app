/**
 * The app's pure audio maths: WAV encoding, peak measurement, silence trimming.
 *
 * Azure's pronunciation assessment REST endpoint accepts raw PCM in a WAV
 * container ("audio/wav; codecs=audio/pcm; samplerate=16000"). MediaRecorder
 * gives us webm/opus instead, so we capture Int16 PCM through the existing
 * audio worklet (`public/audio-processor.worklet.js`) and wrap it here.
 *
 * Everything in this module is a pure function over `Int16Array[]` — the exact
 * shape the worklet's chunks arrive in — precisely so it stays reachable from
 * `vitest`, which runs in `environment: "node"` with no DOM and no
 * `AudioContext`. The browser wrapper (`hooks/useTurnRecorder.ts`) is thin for
 * the same reason.
 */

/** Capture rate. The worklet emits whatever its `AudioContext` runs at, and
 *  `new AudioContext({ sampleRate: 16000 })` is what makes that 16 kHz — there
 *  is no resampling code anywhere, the browser does it. */
export const SAMPLE_RATE = 16000;

/** Full scale for signed 16-bit PCM. */
const FULL_SCALE = 32768;

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** How many samples these chunks hold in total. */
export function totalSamples(chunks: readonly Int16Array[]): number {
  return chunks.reduce((sum, c) => sum + c.length, 0);
}

/** How long these chunks last, in milliseconds. */
export function durationMs(
  chunks: readonly Int16Array[],
  sampleRate = SAMPLE_RATE
): number {
  return (totalSamples(chunks) / sampleRate) * 1000;
}

function concatSamples(chunks: readonly Int16Array[]): Int16Array {
  const samples = new Int16Array(totalSamples(chunks));
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }
  return samples;
}

/** Concatenate captured PCM chunks into a mono 16-bit WAV blob. */
export function encodeWav(
  chunks: readonly Int16Array[],
  sampleRate = SAMPLE_RATE
): Blob {
  const samples = concatSamples(chunks);

  const dataBytes = samples.byteLength;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  new Int16Array(buffer, 44).set(samples);

  return new Blob([buffer], { type: "audio/wav" });
}

/** Peak amplitude (0..1) — a quick sanity check that the mic actually captured something. */
export function peakLevel(chunks: readonly Int16Array[]): number {
  let peak = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const v = Math.abs(chunk[i]);
      if (v > peak) peak = v;
    }
  }
  return peak / FULL_SCALE;
}

// ---------------------------------------------------------------------------
// The low-peak policy
// ---------------------------------------------------------------------------

/**
 * Below this peak the take is almost certainly not the microphone the user
 * thinks it is (a muted headset, the wrong default input).
 *
 * A named constant with a predicate beside it, rather than a bare `0.05`
 * inlined in a JSX string as it was in `app/lab/pronunciation/page.tsx`: this
 * threshold is a *product* rule, it will be tuned, and Story 2.3 will read it
 * too. It is a **signal diagnostic only** — never an excuse offered for a poor
 * result, which EXPERIENCE.md rules out explicitly.
 */
export const LOW_PEAK_THRESHOLD = 0.05;

export function isPeakTooLow(peak: number): boolean {
  return peak < LOW_PEAK_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Trimming
// ---------------------------------------------------------------------------

/**
 * Anything under this amplitude counts as silence. Deliberately well below
 * `LOW_PEAK_THRESHOLD`: this is "no signal at all", not "a weak signal", and
 * trimming must never eat the quiet start of a real word.
 */
export const SILENCE_THRESHOLD = 0.02;

/**
 * Kept either side of the speech. Cutting exactly at the first sample above
 * the threshold clips the onset of a stop consonant (`/p/`, `/t/`, `/k/`) —
 * which is precisely what Story 2.3 will be scoring — so a little air is left
 * in on purpose.
 */
export const TRIM_PADDING_MS = 80;

export interface TrimOptions {
  /** Amplitude (0..1) below which a sample is silence. */
  threshold?: number;
  /** Milliseconds of silence kept either side of the speech. */
  paddingMs?: number;
  sampleRate?: number;
}

/**
 * Drop the leading and trailing silence, keep everything between.
 *
 * Two reasons this exists, and only the first is about tidiness: the
 * pronunciation service bills per second of audio, and a take that is *only*
 * silence must be recognisable as such — an empty result is the signal for
 * "nothing was said", which the caller turns into a worded notice rather than
 * a stored file.
 *
 * Returns the same `Int16Array[]` shape it takes, so it drops into the
 * `encodeWav` / `peakLevel` pipeline without a conversion; an **empty array**
 * means the take had no speech in it at all.
 */
export function trimSilence(
  chunks: readonly Int16Array[],
  options: TrimOptions = {}
): Int16Array[] {
  const sampleRate = options.sampleRate ?? SAMPLE_RATE;
  const threshold = options.threshold ?? SILENCE_THRESHOLD;
  const paddingMs = options.paddingMs ?? TRIM_PADDING_MS;

  // `max(1, …)` so a threshold of 0 still treats digital silence as silence
  // rather than keeping every sample of a dead microphone.
  const cutoff = Math.max(1, Math.round(threshold * FULL_SCALE));
  const samples = concatSamples(chunks);

  let first = -1;
  let last = -1;
  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= cutoff) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return [];

  const pad = Math.max(0, Math.round((paddingMs / 1000) * sampleRate));
  const start = Math.max(0, first - pad);
  const end = Math.min(samples.length, last + 1 + pad);
  return [samples.slice(start, end)];
}
