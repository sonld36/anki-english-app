import { NextRequest, NextResponse } from "next/server";

const ANKI_URL = "http://127.0.0.1:8765";

// Whitelist of safe read-only actions
const ALLOWED_ACTIONS = new Set([
  "deckNames",
  "deckNamesAndIds",
  "findCards",
  "findNotes",
  "cardsInfo",
  "notesInfo",
  "getNumCardsReviewedToday",
]);

export async function POST(req: NextRequest) {
  const { action, params } = await req.json().catch(() => ({}));

  if (!action || !ALLOWED_ACTIONS.has(action)) {
    return NextResponse.json(
      { error: "Action not allowed or missing" },
      { status: 403 }
    );
  }

  try {
    const res = await fetch(ANKI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, version: 6, params }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json();
    if (data.error) {
      return NextResponse.json({ error: data.error }, { status: 400 });
    }

    return NextResponse.json({ result: data.result });
  } catch (err) {
    const isConnectionError =
      err instanceof TypeError || (err as NodeJS.ErrnoException).code === "ECONNREFUSED";

    return NextResponse.json(
      {
        error: isConnectionError
          ? "Không thể kết nối Anki. Hãy chắc chắn Anki đang mở và AnkiConnect đã được cài."
          : "Lỗi kết nối AnkiConnect",
      },
      { status: 503 }
    );
  }
}
