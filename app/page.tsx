import { Lab } from "@/components/ligi-lab";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const params = await searchParams;
  return <Lab sensor={params.role === "sensor"} />;
}
