"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { encodeWav, isPeakTooLow, peakLevel } from "@/lib/wav";

/**
 * Pronunciation assessment lab — a throwaway harness for validating three
 * assumptions before committing to the scripted-practice pivot:
 *
 *   1. Does phoneme scoring behave sensibly on Vietnamese-accented English?
 *   2. Is the score stable? (same recording, scored twice -> same number)
 *   3. Does the browser's noise suppression damage the fricatives we measure?
 *
 * Nothing here is wired into the real practice flow.
 */

// Each sentence isolates one error pattern Vietnamese speakers make systematically.
const TEST_SENTENCES = [
  {
    label: "Phụ âm cuối + đuôi -ed",
    text: "I walked to the shop and asked for a cold drink.",
    watch: "walked, asked, cold — nghe có mất /t/, /d/ cuối không",
  },
  {
    label: "Đuôi -s (số nhiều, ngôi 3)",
    text: "She books three tickets and packs six bags.",
    watch: "books, tickets, packs, bags — đuôi -s có phát ra không",
  },
  {
    label: "Âm /θ/ và /ð/",
    text: "I think this thing is worth three thousand.",
    watch: "think, this, worth — có bị thành /t/, /d/ không",
  },
  {
    label: "Nguyên âm dài/ngắn, /s/ vs /ʃ/",
    text: "The cheap ship left the sheep on the beach.",
    watch: "ship vs sheep, cheap vs beach — phân biệt được không",
  },
  {
    label: "Cụm phụ âm",
    text: "The strong students struggled with the strange text.",
    watch: "strong, struggled, strange, text — cụm /str/, /kst/",
  },
  {
    label: "Ngữ điệu câu hỏi",
    text: "Are you sure you want to leave already?",
    watch: "cao độ cuối câu — Azure có bắt được Monotone không",
  },
];

// The REST API for short audio returns assessment scores FLAT on NBest[0] and on
// each word/phoneme — not nested under a PronunciationAssessment object the way the
// Speech SDK does. Verified against a live response 2026-08-20.
interface AzureWord {
  Word: string;
  AccuracyScore?: number;
  ErrorType?: string;
  Phonemes?: { Phoneme: string; AccuracyScore?: number }[];
}

interface AzureNBest {
  PronScore?: number;
  AccuracyScore?: number;
  FluencyScore?: number;
  CompletenessScore?: number;
  ProsodyScore?: number;
  Words?: AzureWord[];
}

interface RunResult {
  id: number;
  recordingId: number;
  provider: string;
  latencyMs: number;
  noiseSuppression: boolean;
  referenceText: string;
  readingStyle: string;
  raw: Record<string, unknown>;
}

// Reading styles for calibration: the point of the exercise is to see where
// "normal" speech falls relative to deliberate-best and deliberate-sloppy.
const READING_STYLES = ["chuẩn", "nuốt âm cuối", "bình thường"] as const;

const RUNS_KEY = "pronunciation_lab_runs";

function scoreColor(score: number): string {
  if (score >= 80) return "#22c55e";
  if (score >= 60) return "#f59e0b";
  return "#f43f5e";
}

function ScoreChip({ label, value }: { label: string; value?: number }) {
  if (value === undefined || value === null) return null;
  return (
    <div
      style={{
        padding: "10px 14px",
        borderRadius: "10px",
        background: "var(--surface-2, rgba(255,255,255,0.04))",
        border: `1px solid ${scoreColor(value)}40`,
        minWidth: "104px",
      }}
    >
      <div style={{ fontSize: "0.7rem", opacity: 0.65, marginBottom: "2px" }}>
        {label}
      </div>
      <div
        style={{
          fontSize: "1.5rem",
          fontWeight: 700,
          color: scoreColor(value),
          lineHeight: 1.1,
        }}
      >
        {Math.round(value)}
      </div>
    </div>
  );
}

export default function PronunciationLabPage() {
  const [sentenceIdx, setSentenceIdx] = useState(0);
  const [referenceText, setReferenceText] = useState(TEST_SENTENCES[0].text);
  const [noiseSuppression, setNoiseSuppression] = useState(true);

  const [recording, setRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioInfo, setAudioInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunResult[]>([]);
  const [readingStyle, setReadingStyle] = useState<string>(READING_STYLES[0]);

  const chunksRef = useRef<Int16Array[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const runIdRef = useRef(0);
  const recordingIdRef = useRef(0);

  // Restore any previous session's runs, and persist on every change — losing a
  // calibration session to a page reload is not acceptable.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(RUNS_KEY);
      if (saved) {
        const parsed: RunResult[] = JSON.parse(saved);
        // localStorage is exactly the "external system" effects exist to sync
        // with; this runs once on mount, so there is no cascading-render risk.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setRuns(parsed);
        runIdRef.current = parsed.reduce((m, r) => Math.max(m, r.id), 0);
        recordingIdRef.current = parsed.reduce((m, r) => Math.max(m, r.recordingId), 0);
      }
    } catch {
      /* corrupt or oversized storage — start clean rather than blocking the lab */
    }
  }, []);

  useEffect(() => {
    if (!runs.length) return;
    try {
      localStorage.setItem(RUNS_KEY, JSON.stringify(runs));
    } catch {
      /* quota exceeded — the in-memory runs and the export button still work */
    }
  }, [runs]);

  const startRecording = useCallback(async () => {
    setError(null);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: noiseSuppression,
          noiseSuppression,
          autoGainControl: noiseSuppression,
        },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      await ctx.audioWorklet.addModule("/audio-processor.worklet.js");

      const node = new AudioWorkletNode(ctx, "audio-capture-processor");
      node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => {
        if (e.data?.byteLength) chunksRef.current.push(new Int16Array(e.data));
      };

      // Route through a silent gain node so the graph is guaranteed to be
      // pulled — a worklet with no path to the destination is not required
      // by spec to run.
      const silent = new GainNode(ctx, { gain: 0 });
      node.connect(silent);
      silent.connect(ctx.destination);

      ctx.createMediaStreamSource(stream).connect(node);
      setRecording(true);
    } catch (err) {
      setError(
        "Không truy cập được microphone: " +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }, [noiseSuppression]);

  const stopRecording = useCallback(() => {
    setRecording(false);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    ctxRef.current?.close();
    ctxRef.current = null;

    const chunks = chunksRef.current;
    const samples = chunks.reduce((s, c) => s + c.length, 0);
    if (!samples) {
      setError("Không thu được mẫu âm thanh nào.");
      return;
    }

    const blob = encodeWav(chunks);
    blobRef.current = blob;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(blob));

    const seconds = samples / 16000;
    const peak = peakLevel(chunks);
    setAudioInfo(
      `${seconds.toFixed(2)}s · ${(blob.size / 1024).toFixed(0)} KB · ` +
        `đỉnh ${(peak * 100).toFixed(0)}%` +
        (isPeakTooLow(peak) ? " ⚠️ quá nhỏ, có thể sai mic" : "")
    );
    recordingIdRef.current += 1;
  }, [audioUrl]);

  const assess = useCallback(
    async (provider: "azure" | "gemini") => {
      if (!blobRef.current) {
        setError("Chưa có bản ghi âm nào.");
        return;
      }
      setBusy(true);
      setError(null);

      try {
        const form = new FormData();
        form.append("audio", blobRef.current, "speech.wav");
        form.append("referenceText", referenceText);
        form.append("provider", provider);

        const res = await fetch("/api/pronunciation", {
          method: "POST",
          body: form,
        });
        const data = await res.json();

        if (!res.ok) {
          setError(data.error ?? `Lỗi ${res.status}`);
          return;
        }

        setRuns((prev) => [
          ...prev,
          {
            id: ++runIdRef.current,
            recordingId: recordingIdRef.current,
            provider: data.provider,
            latencyMs: data.latencyMs,
            noiseSuppression,
            referenceText,
            readingStyle,
            raw: data.raw,
          },
        ]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [referenceText, noiseSuppression, readingStyle]
  );

  const azureRuns = runs.filter((r) => r.provider === "azure");

  function exportRuns() {
    const blob = new Blob([JSON.stringify(runs, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "pronunciation-calibration.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function clearRuns() {
    if (!confirm(`Xoá toàn bộ ${runs.length} lần chấm đã lưu?`)) return;
    setRuns([]);
    localStorage.removeItem(RUNS_KEY);
  }

  return (
    <div style={{ maxWidth: "980px", margin: "0 auto", padding: "32px 20px 80px" }}>
      <h1 className="heading-gradient" style={{ fontSize: "1.75rem", fontWeight: 800 }}>
        🔬 Lab chấm phát âm
      </h1>
      <p style={{ color: "var(--text-muted)", fontSize: "0.875rem", marginTop: "6px" }}>
        Bộ kiểm chứng độc lập — không ảnh hưởng tới luồng luyện tập hiện tại.
      </p>

      {/* Câu thử */}
      <section className="card" style={{ marginTop: "24px", padding: "20px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "12px" }}>
          1 · Chọn câu thử
        </h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "14px" }}>
          {TEST_SENTENCES.map((s, i) => (
            <button
              key={s.label}
              onClick={() => {
                setSentenceIdx(i);
                setReferenceText(s.text);
              }}
              className={i === sentenceIdx ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: "0.78rem", padding: "6px 12px" }}
            >
              {s.label}
            </button>
          ))}
        </div>
        <textarea
          className="input"
          value={referenceText}
          onChange={(e) => setReferenceText(e.target.value)}
          rows={2}
          style={{ width: "100%", fontSize: "1.05rem", fontFamily: "inherit" }}
        />
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "8px" }}>
          👂 Chú ý nghe: {TEST_SENTENCES[sentenceIdx].watch}
        </p>
      </section>

      {/* Ghi âm */}
      <section className="card" style={{ marginTop: "16px", padding: "20px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "12px" }}>
          2 · Ghi âm
        </h2>

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "0.85rem",
            marginBottom: "14px",
            cursor: recording ? "not-allowed" : "pointer",
            opacity: recording ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={noiseSuppression}
            disabled={recording}
            onChange={(e) => setNoiseSuppression(e.target.checked)}
          />
          Bật khử ồn / tự cân âm lượng của trình duyệt
          <span style={{ color: "var(--text-muted)" }}>
            — thử cả hai: khử ồn có thể ăn mất âm xát (/s/, /θ/)
          </span>
        </label>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", marginBottom: "14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: "0.85rem" }}>Cách đọc:</span>
          {READING_STYLES.map((s) => (
            <button
              key={s}
              onClick={() => setReadingStyle(s)}
              disabled={recording}
              className={readingStyle === s ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: "0.78rem", padding: "6px 12px" }}
            >
              {s}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={recording ? stopRecording : startRecording}
            className={recording ? "btn-danger" : "btn-primary"}
          >
            {recording ? "⏹ Dừng" : "🎙 Bắt đầu ghi"}
          </button>
          {audioUrl && <audio src={audioUrl} controls style={{ height: "36px" }} />}
        </div>

        {audioInfo && (
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "10px" }}>
            {audioInfo}
          </p>
        )}
      </section>

      {/* Chấm điểm */}
      <section className="card" style={{ marginTop: "16px", padding: "20px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "6px" }}>
          3 · Chấm điểm
        </h2>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "14px" }}>
          Bấm Azure hai lần trên <em>cùng một bản ghi</em> để kiểm tra độ ổn định.
        </p>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={() => assess("azure")} disabled={busy || !audioUrl} className="btn-primary">
            {busy ? "Đang chấm…" : "Chấm bằng Azure"}
          </button>
          <button onClick={() => assess("gemini")} disabled={busy || !audioUrl} className="btn-secondary">
            Chấm bằng Gemini (đối chứng)
          </button>
        </div>
        {error && (
          <p style={{ color: "#f43f5e", fontSize: "0.85rem", marginTop: "12px" }}>⚠️ {error}</p>
        )}

        {runs.length > 0 && (
          <div style={{ display: "flex", gap: "10px", marginTop: "16px", alignItems: "center", flexWrap: "wrap" }}>
            <button onClick={exportRuns} className="btn-secondary">
              ⬇ Tải kết quả ({runs.length} lần)
            </button>
            <button onClick={clearRuns} className="btn-danger" style={{ fontSize: "0.8rem" }}>
              Xoá hết
            </button>
            <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              Kết quả tự lưu — tải lại trang không mất
            </span>
          </div>
        )}
      </section>

      {/* Độ ổn định */}
      {azureRuns.length > 1 && (
        <section className="card" style={{ marginTop: "16px", padding: "20px" }}>
          <h2 style={{ fontSize: "1rem", fontWeight: 700, marginBottom: "10px" }}>
            📐 Độ ổn định — cùng file, chấm {azureRuns.length} lần
          </h2>
          <table style={{ width: "100%", fontSize: "0.85rem", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={{ padding: "6px 4px" }}>Lần</th>
                <th>Pron</th>
                <th>Accuracy</th>
                <th>Fluency</th>
                <th>Prosody</th>
                <th>Completeness</th>
                <th>Trễ</th>
              </tr>
            </thead>
            <tbody>
              {azureRuns.map((r) => {
                const nb = (r.raw as { NBest?: AzureNBest[] })?.NBest?.[0];
                return (
                  <tr key={r.id} style={{ borderTop: "1px solid rgba(255,255,255,0.08)" }}>
                    <td style={{ padding: "6px 4px" }}>#{r.id}</td>
                    <td>{nb?.PronScore ?? "—"}</td>
                    <td>{nb?.AccuracyScore ?? "—"}</td>
                    <td>{nb?.FluencyScore ?? "—"}</td>
                    <td>{nb?.ProsodyScore ?? "—"}</td>
                    <td>{nb?.CompletenessScore ?? "—"}</td>
                    <td>{r.latencyMs}ms</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Kết quả */}
      {runs.map((run) => (
        <ResultCard key={run.id} run={run} />
      ))}
    </div>
  );
}

function ResultCard({ run }: { run: RunResult }) {
  if (run.provider === "gemini") {
    const g = run.raw as {
      heardTranscript: string;
      matchesReference: boolean;
      overallScore: number;
      intonationScore: number;
      summaryVi: string;
      wordIssues: {
        word: string;
        issue: string;
        severity: string;
        breaksComprehension: boolean;
      }[];
    };
    return (
      <section className="card" style={{ marginTop: "16px", padding: "20px" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>
          #{run.id} · Gemini <span className="badge badge-purple">đối chứng</span>{" "}
        <span className="badge">{run.readingStyle}</span>
        </h2>
        <div style={{ display: "flex", gap: "10px", margin: "14px 0", flexWrap: "wrap" }}>
          <ScoreChip label="Tổng" value={g.overallScore} />
          <ScoreChip label="Ngữ điệu" value={g.intonationScore} />
        </div>
        <p style={{ fontSize: "0.85rem", marginBottom: "6px" }}>
          <strong>Nghe thành:</strong>{" "}
          <span style={{ fontFamily: "monospace" }}>{g.heardTranscript}</span>
        </p>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", marginBottom: "12px" }}>
          {g.summaryVi}
        </p>
        {g.wordIssues?.length > 0 && (
          <ul style={{ fontSize: "0.85rem", paddingLeft: "18px" }}>
            {g.wordIssues.map((w, i) => (
              <li key={i} style={{ marginBottom: "4px" }}>
                <strong>{w.word}</strong> — {w.issue}{" "}
                {w.breaksComprehension && (
                  <span className="badge badge-rose">gây khó hiểu</span>
                )}
              </li>
            ))}
          </ul>
        )}
        <RawJson data={run.raw} />
      </section>
    );
  }

  const nbest = (run.raw as { NBest?: AzureNBest[] }).NBest?.[0];
  const scores = nbest;
  const words = nbest?.Words ?? [];

  return (
    <section className="card" style={{ marginTop: "16px", padding: "20px" }}>
      <h2 style={{ fontSize: "1rem", fontWeight: 700 }}>
        #{run.id} · Azure{" "}
        <span className="badge badge-blue">
          {run.noiseSuppression ? "khử ồn BẬT" : "khử ồn TẮT"}
        </span>{" "}
        <span className="badge badge-amber">{run.readingStyle}</span>{" "}
        <span className="badge">bản thu #{run.recordingId}</span>
      </h2>

      <div style={{ display: "flex", gap: "10px", margin: "14px 0", flexWrap: "wrap" }}>
        <ScoreChip label="Tổng" value={scores?.PronScore} />
        <ScoreChip label="Chính xác" value={scores?.AccuracyScore} />
        <ScoreChip label="Trôi chảy" value={scores?.FluencyScore} />
        <ScoreChip label="Ngữ điệu" value={scores?.ProsodyScore} />
        <ScoreChip label="Đầy đủ" value={scores?.CompletenessScore} />
      </div>

      <p style={{ fontSize: "0.85rem", marginBottom: "4px" }}>
        <strong>Câu tham chiếu:</strong>{" "}
        <span style={{ fontFamily: "monospace", opacity: 0.8 }}>{run.referenceText}</span>
      </p>
      <p style={{ fontSize: "0.85rem", marginBottom: "12px" }}>
        <strong>Nghe thành:</strong>{" "}
        <span style={{ fontFamily: "monospace" }}>
          {(run.raw as { DisplayText?: string }).DisplayText ?? "—"}
        </span>
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
        {words.map((w, i) => {
          const acc = w.AccuracyScore ?? 0;
          const err = w.ErrorType ?? "None";
          const bad = err !== "None";
          return (
            <details
              key={i}
              style={{
                border: `1px solid ${bad ? "#f43f5e" : scoreColor(acc)}55`,
                borderRadius: "8px",
                padding: "6px 10px",
                fontSize: "0.85rem",
              }}
            >
              <summary style={{ cursor: "pointer", listStyle: "none" }}>
                <span style={{ color: bad ? "#f43f5e" : scoreColor(acc), fontWeight: 600 }}>
                  {w.Word}
                </span>{" "}
                <span style={{ opacity: 0.7, fontSize: "0.75rem" }}>
                  {Math.round(acc)}
                  {bad && ` · ${err}`}
                </span>
              </summary>
              <div style={{ marginTop: "6px", fontFamily: "monospace", fontSize: "0.75rem" }}>
                {w.Phonemes?.map((p, j) => (
                  <span
                    key={j}
                    style={{
                      marginRight: "8px",
                      color: scoreColor(p.AccuracyScore ?? 0),
                    }}
                  >
                    {p.Phoneme}
                    <sub>{Math.round(p.AccuracyScore ?? 0)}</sub>
                  </span>
                )) ?? "—"}
              </div>
            </details>
          );
        })}
      </div>

      <RawJson data={run.raw} />
    </section>
  );
}

function RawJson({ data }: { data: unknown }) {
  return (
    <details style={{ marginTop: "16px" }}>
      <summary style={{ cursor: "pointer", fontSize: "0.8rem", color: "var(--text-muted)" }}>
        Xem JSON thô
      </summary>
      <pre
        style={{
          fontSize: "0.7rem",
          overflow: "auto",
          maxHeight: "340px",
          marginTop: "8px",
          padding: "12px",
          borderRadius: "8px",
          background: "rgba(0,0,0,0.3)",
        }}
      >
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}
