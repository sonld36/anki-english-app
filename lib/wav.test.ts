import { describe, expect, it } from "vitest";
import {
  LOW_PEAK_THRESHOLD,
  SAMPLE_RATE,
  SILENCE_THRESHOLD,
  TRIM_PADDING_MS,
  durationMs,
  encodeWav,
  isPeakTooLow,
  peakLevel,
  totalSamples,
  trimSilence,
} from "./wav";

/**
 * The whole audio pipeline is pure by design (see the module header), so this
 * is the one place the byte-level claims can actually be held: Azure rejects a
 * malformed header with a 400 that says nothing useful, and a trimming bug
 * that eats the first phoneme would show up in Story 2.3 as "the learner keeps
 * dropping initial consonants".
 */

const FULL_SCALE = 32768;

/** `n` samples of digital silence. */
const silence = (n: number) => new Int16Array(n);

/** `n` samples at `amplitude` (0..1), alternating sign so it looks like audio. */
function tone(n: number, amplitude = 0.5): Int16Array {
  const out = new Int16Array(n);
  const value = Math.round(amplitude * FULL_SCALE);
  for (let i = 0; i < n; i++) out[i] = i % 2 === 0 ? value : -value;
  return out;
}

async function headerOf(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

const ascii = (view: DataView, offset: number, length: number) =>
  Array.from({ length }, (_, i) =>
    String.fromCharCode(view.getUint8(offset + i))
  ).join("");

describe("encodeWav", () => {
  it("writes the canonical 44-byte header at the documented offsets", async () => {
    const view = await headerOf(encodeWav([tone(100)]));

    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(36 + 200); // 100 samples × 2 bytes
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16); // PCM fmt chunk size
    expect(view.getUint16(20, true)).toBe(1); // format = PCM
    expect(view.getUint16(22, true)).toBe(1); // mono — Azure requires it
    expect(view.getUint32(24, true)).toBe(SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(SAMPLE_RATE * 2); // byte rate
    expect(view.getUint16(32, true)).toBe(2); // block align
    expect(view.getUint16(34, true)).toBe(16); // bits per sample
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(200);
  });

  it("honours a non-default sample rate in both rate fields", async () => {
    const view = await headerOf(encodeWav([tone(10)], 8000));
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint32(28, true)).toBe(16000);
  });

  it("concatenates every chunk in order, losing no sample", async () => {
    const a = new Int16Array([1, 2, 3]);
    const b = new Int16Array([4, 5]);
    const c = new Int16Array([6]);
    const blob = encodeWav([a, b, c]);
    const buffer = await blob.arrayBuffer();

    expect(blob.size).toBe(44 + 12);
    expect([...new Int16Array(buffer, 44)]).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("produces a valid, empty WAV rather than throwing on no chunks", async () => {
    const blob = encodeWav([]);
    const view = await headerOf(blob);
    expect(blob.size).toBe(44);
    expect(view.getUint32(40, true)).toBe(0);
    expect(blob.type).toBe("audio/wav");
  });
});

describe("peakLevel", () => {
  it("normalises against full scale", () => {
    expect(peakLevel([tone(10, 0.5)])).toBeCloseTo(0.5, 3);
    expect(peakLevel([new Int16Array([32767])])).toBeCloseTo(1, 3);
    expect(peakLevel([new Int16Array([-32768])])).toBe(1);
  });

  it("reports the loudest sample across every chunk, not the last one", () => {
    expect(peakLevel([tone(4, 0.1), tone(4, 0.9), tone(4, 0.2)])).toBeCloseTo(
      0.9,
      2
    );
  });

  it("is zero for digital silence and for no chunks at all", () => {
    expect(peakLevel([silence(64)])).toBe(0);
    expect(peakLevel([])).toBe(0);
  });
});

describe("the low-peak policy", () => {
  it("flags a take quieter than the threshold and passes one at it", () => {
    expect(isPeakTooLow(LOW_PEAK_THRESHOLD - 0.001)).toBe(true);
    expect(isPeakTooLow(LOW_PEAK_THRESHOLD)).toBe(false);
    expect(isPeakTooLow(0)).toBe(true);
  });

  it("sits well above the silence threshold — 'weak' is not 'absent'", () => {
    // If these ever cross, a take could be trimmed to nothing *and* reported
    // as merely quiet, which are two different messages to the user.
    expect(SILENCE_THRESHOLD).toBeLessThan(LOW_PEAK_THRESHOLD);
  });
});

describe("totalSamples / durationMs", () => {
  it("counts across chunks", () => {
    expect(totalSamples([silence(10), silence(6)])).toBe(16);
    expect(totalSamples([])).toBe(0);
  });

  it("converts sample count to milliseconds at the capture rate", () => {
    expect(durationMs([silence(SAMPLE_RATE)])).toBe(1000);
    expect(durationMs([silence(SAMPLE_RATE / 2)])).toBe(500);
    expect(durationMs([])).toBe(0);
  });
});

describe("trimSilence", () => {
  const PAD = Math.round((TRIM_PADDING_MS / 1000) * SAMPLE_RATE);

  it("returns nothing at all for a silence-only take", () => {
    // This is the signal for "you did not say anything": the caller must be
    // able to tell it apart from a short but real take.
    expect(trimSilence([silence(SAMPLE_RATE)])).toEqual([]);
    expect(trimSilence([silence(100), silence(100)])).toEqual([]);
    expect(trimSilence([])).toEqual([]);
  });

  it("treats a sample below the threshold as silence, not as speech", () => {
    const whisper = new Int16Array(200).fill(
      Math.round(SILENCE_THRESHOLD * FULL_SCALE) - 1
    );
    expect(trimSilence([whisper])).toEqual([]);
  });

  it("cuts silence from both ends and keeps the speech plus padding", () => {
    const speech = tone(1_000);
    const trimmed = trimSilence([silence(8_000), speech, silence(8_000)]);

    expect(trimmed).toHaveLength(1);
    expect(totalSamples(trimmed)).toBe(1_000 + 2 * PAD);
    // The speech itself survives untouched in the middle.
    expect([...trimmed[0].slice(PAD, PAD + 1_000)]).toEqual([...speech]);
  });

  it("keeps interior silence — a pause mid-sentence is part of the take", () => {
    const trimmed = trimSilence([
      silence(4_000),
      tone(100),
      silence(3_000),
      tone(100),
      silence(4_000),
    ]);
    expect(totalSamples(trimmed)).toBe(100 + 3_000 + 100 + 2 * PAD);
  });

  it("leaves a take with no silence at either end alone", () => {
    const speech = tone(500);
    const trimmed = trimSilence([speech]);
    expect(totalSamples(trimmed)).toBe(500);
    expect([...trimmed[0]]).toEqual([...speech]);
  });

  it("clamps the padding to what the take actually holds", () => {
    // A take shorter than the padding window: the maths must not read past
    // either end or produce a negative length.
    const trimmed = trimSilence([silence(5), tone(3), silence(5)]);
    expect(totalSamples(trimmed)).toBe(13);
    expect([...trimmed[0]]).toEqual([0, 0, 0, 0, 0, ...tone(3), 0, 0, 0, 0, 0]);
  });

  it("handles a single loud sample at the very first index", () => {
    const trimmed = trimSilence([tone(1), silence(8_000)]);
    expect(totalSamples(trimmed)).toBe(1 + PAD);
  });

  it("respects an explicit threshold and padding", () => {
    const quiet = new Int16Array(10).fill(Math.round(0.01 * FULL_SCALE));
    expect(trimSilence([silence(50), quiet, silence(50)], { threshold: 0.005, paddingMs: 0 }))
      .toEqual([quiet]);
    expect(trimSilence([silence(50), quiet, silence(50)], { threshold: 0.05 })).toEqual([]);
  });

  it("feeds encodeWav directly — the shape is unchanged", async () => {
    const trimmed = trimSilence([silence(2_000), tone(400), silence(2_000)]);
    const blob = encodeWav(trimmed);
    expect(blob.size).toBe(44 + totalSamples(trimmed) * 2);
    expect(peakLevel(trimmed)).toBeCloseTo(0.5, 2);
  });
});
