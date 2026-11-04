import { specDocument } from "@/lib/spec";

export function GET() {
  return Response.json(specDocument);
}
