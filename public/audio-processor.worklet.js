/**
 * AudioWorklet processor for capturing raw PCM audio from microphone.
 * Converts Float32 samples to Int16 PCM at 16kHz for Gemini Live API.
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = [];
    this._bufferSize = 2048; // Send chunks of ~128ms at 16kHz
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const float32Samples = input[0];

    // Convert Float32 [-1, 1] to Int16 [-32768, 32767]
    const int16Samples = new Int16Array(float32Samples.length);
    for (let i = 0; i < float32Samples.length; i++) {
      const clamped = Math.max(-1, Math.min(1, float32Samples[i]));
      int16Samples[i] = clamped < 0
        ? Math.round(clamped * 32768)
        : Math.round(clamped * 32767);
    }

    // Post PCM data to main thread
    this.port.postMessage(int16Samples.buffer, [int16Samples.buffer]);
    return true;
  }
}

registerProcessor("audio-capture-processor", AudioCaptureProcessor);
