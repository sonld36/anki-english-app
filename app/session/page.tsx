"use client";

import { Suspense, useMemo, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { historyStorage } from "@/lib/history";
import { findEntry } from "@/lib/session";
import SessionView from "@/components/SessionView";

/**
 * `/session?id=…` — the turn-by-turn practice screen.
 *
 * Additive: `/practice?id=…` (Gemini Live) is untouched and keeps working
 * until Story 2.8 removes it, because deleting it before the replacement runs
 * leaves nothing that works.
 *
 * The entry is derived during render rather than fetched in an effect. Two
 * reasons: `app/practice/page.tsx:18` is one of the three known
 * `react-hooks/set-state-in-effect` errors and this story must not add a
 * fourth; and the memo is what makes `entry.script` referentially stable,
 * which `useSampleAudio` requires — it keys every piece of its state on script
 * object identity.
 *
 * Reading `localStorage` during render needs `useHydrated` to be honest about
 * when it may happen. In production this component is client-only (a
 * prerendered route bails out to the client at the nearest `Suspense`
 * boundary), but `next dev` renders routes on demand and so runs it on the
 * server too, where `historyStorage` sees no `window` and returns `[]`.
 * Deriving straight from that would make the server say "not found" and the
 * client say otherwise — a hydration mismatch, and a red overlay in dev.
 * `useSyncExternalStore` is how React is *told* the two differ, so it renders
 * the loading state during hydration and the real one straight after, with no
 * `setState` in an effect.
 */
const noopSubscribe = () => () => {};

function useHydrated(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false
  );
}

function SessionContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const id = searchParams.get("id");
  const hydrated = useHydrated();

  const entry = useMemo(() => {
    if (!hydrated) return null;
    // `lib/history.ts` has no `getById` — one list, read one out of it.
    // The choosing is `findEntry`'s so the node suite can hold it; this side
    // only supplies the list.
    return findEntry(historyStorage.getAll(), id);
  }, [hydrated, id]);

  if (!hydrated) {
    return (
      <div
        style={{
          minHeight: "100dvh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--surface-base)",
        }}
      >
        <div className="spinner" />
      </div>
    );
  }

  if (!entry) {
    return (
      <main
        style={{
          minHeight: "100dvh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "var(--space-4)",
          padding: "var(--space-5)",
          textAlign: "center",
          background: "var(--surface-base)",
          color: "var(--ink-secondary)",
          fontFamily: "var(--font-sans)",
        }}
      >
        <div style={{ fontSize: "3rem" }} aria-hidden="true">
          🔍
        </div>
        <h2 style={{ fontWeight: 700, color: "var(--ink-primary)" }}>
          Không tìm thấy buổi luyện
        </h2>
        <p style={{ fontSize: "14px" }}>
          Kịch bản này không còn trong lịch sử.
        </p>
        <button
          onClick={() => router.push("/")}
          style={{
            padding: "var(--space-3) var(--space-5)",
            fontSize: "14px",
            fontWeight: 600,
            fontFamily: "inherit",
            color: "var(--surface-base)",
            background: "var(--chrome)",
            border: "1px solid var(--chrome)",
            borderRadius: "var(--radius-sm)",
            cursor: "pointer",
          }}
        >
          ← Về trang chủ
        </button>
      </main>
    );
  }

  return <SessionView entry={entry} />;
}

export default function SessionPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            minHeight: "100dvh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--surface-base)",
          }}
        >
          <div className="spinner" />
        </div>
      }
    >
      <SessionContent />
    </Suspense>
  );
}
