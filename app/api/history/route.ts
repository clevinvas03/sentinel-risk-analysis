import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Assessment history. GET -> recent runs (question, answer, trace, sources).
export async function GET() {
  try {
    const rows = await query(
      `SELECT id, question, answer, trace, sources, created_at
       FROM assessments
       ORDER BY created_at DESC
       LIMIT 50`
    );
    return Response.json({ assessments: rows });
  } catch (e: any) {
    return Response.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}
