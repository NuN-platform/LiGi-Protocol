import { keyExchange, sources } from "@/lib/spec";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export function SourcesPanel() {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        {sources.map((source) => (
          <Card key={source.title} className="gap-3 p-5">
            <Badge variant="outline">{source.kind}</Badge>
            <h3 className="font-display text-xl">{source.title}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{source.detail}</p>
            {"href" in source && source.href ? (
              <a className="text-sm text-primary underline-offset-4 hover:underline" href={source.href} target="_blank" rel="noreferrer">
                Open source
              </a>
            ) : null}
          </Card>
        ))}
      </div>
      <Card className="gap-3 p-5">
        <h3 className="font-display text-xl">Geometric optical key exchange</h3>
        <p className="text-sm text-muted-foreground">
          Stored in the author's Drive as frequency, hex mark, and Fibonacci-Ising state. The gate shows the table.
          It does not transmit on these carriers.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-4 font-medium">Frequency</th>
                <th className="py-2 pr-4 font-medium">Hex</th>
                <th className="py-2 font-medium">Ising state</th>
              </tr>
            </thead>
            <tbody>
              {keyExchange.map((row) => (
                <tr key={row.hex} className="border-t border-border">
                  <td className="py-2 pr-4 font-mono">{row.frequencyThz} THz</td>
                  <td className="py-2 pr-4 font-mono">{row.hex}</td>
                  <td className="py-2 font-mono">{row.ising}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          Drive files open for the owner. Someone else needs the author to share them. GitHub repositories linked here
          are public.
        </p>
      </Card>
    </div>
  );
}
