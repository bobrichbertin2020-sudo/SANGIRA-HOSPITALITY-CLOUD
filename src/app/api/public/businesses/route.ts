import { NextResponse, type NextRequest } from "next/server";
import { searchPublicBusinesses } from "@/lib/public-businesses";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (query.length > 80) {
    return NextResponse.json({ error: "Search text is too long." }, { status: 400 });
  }

  const { data, error } = await searchPublicBusinesses(query.length >= 2 ? query : null, 8);
  if (error) {
    console.error("Public business search failed:", error.message);
    return NextResponse.json(
      { error: "Business search is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    { businesses: data ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
