/**
 * WAV encoding for the pronunciation lab.
 *
 * Azure's pronunciation assessment REST endpoint accepts raw PCM in a WAV
 * container ("audio/wav; codecs=audio/pcm; samplerate=16000"). MediaRecorder
 * gives us webm/opus instead, so we capture Int16 PCM through the existing
 * audio worklet and wrap it here.
 */

const SAMPLE_RATE = 16000;

function writeAscii(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/** Concatenate captured PCM chunks into a mono 16-bit WAV blob. */
export function encodeWav(chunks: Int16Array[], sampleRate = SAMPLE_RATE): Blob {
  const totalSamples = chunks.reduce((sum, c) => sum + c.length, 0);
  const samples = new Int16Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    samples.set(chunk, offset);
    offset += chunk.length;
  }

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
export function peakLevel(chunks: Int16Array[]): number {
  let peak = 0;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const v = Math.abs(chunk[i]);
      if (v > peak) peak = v;
    }
  }
  return peak / 32768;
}
