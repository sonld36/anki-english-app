import { NextRequest, NextResponse } from "next/server";

const LIVE_MODEL = "models/gemini-2.5-flash-native-audio-latest";

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_gemini_api_key_here") {
    return NextResponse.json(
      { error: "GEMINI_API_KEY chưa được cấu hình" },
      { status: 503 }
    );
  }

  // Return the API key + correct model for client-side WebSocket connection
  // (acceptable for local dev; use ephemeral tokens in production)
  return NextResponse.json({
    apiKey,
    model: LIVE_MODEL,
  });
}
