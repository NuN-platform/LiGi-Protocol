import { specDocument } from "@/lib/spec";
import { Card } from "@/components/ui/card";

export function SpecPanel() {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <Card className="gap-4 p-5">
        <p className="text-xs tracking-[0.18em] text-primary uppercase">Whitepaper v2</p>
        <h2 className="font-display text-3xl tracking-tight">What the gate is running</h2>
        <p className="text-base leading-relaxed text-muted-foreground">{specDocument.summary}</p>
        <p className="text-sm leading-relaxed">
          A display paints one frame at a time. Each frame carries a 24-byte header and one Luby symbol. The first k
          frames are the source blocks. Every frame after that is an XOR of a robust-soliton subset, so a sensor can
          miss frames and still rebuild the payload. The symbol cells are shuffled from the session id and the sequence
          number. Four finder corners stay put, which is how a sensor knows it is looking at a gate.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs tracking-wide text-muted-foreground uppercase">
              <tr>
                <th className="py-2 pr-3 font-medium">Bytes</th>
                <th className="py-2 pr-3 font-medium">Field</th>
                <th className="py-2 font-medium">In this lab</th>
              </tr>
            </thead>
            <tbody>
              {specDocument.header.map((row) => (
                <tr key={row.bytes} className="border-t border-border">
                  <td className="py-2 pr-3 font-mono text-xs">{row.bytes}</td>
                  <td className="py-2 pr-3">{row.field}</td>
                  <td className="py-2 text-muted-foreground">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="grid gap-4">
        <Card className="gap-3 p-5">
          <h3 className="font-display text-xl">Design targets from the whitepaper</h3>
          <ul className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            <li>{specDocument.targets.density}</li>
            <li>{specDocument.targets.loss}</li>
            <li>{specDocument.targets.throughput}</li>
            <li>{specDocument.targets.payload}</li>
          </ul>
          <p className="font-mono text-xs text-primary">E_LiGi2 = f(T_speed, A_geo, R_pqc, R_fountain)</p>
        </Card>
        <Card className="gap-3 p-5">
          <h3 className="font-display text-xl">Running in the browser</h3>
          <ul className="grid gap-2 text-sm leading-relaxed">
            {specDocument.running.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
        <Card className="gap-3 p-5">
          <h3 className="font-display text-xl">Recorded in the papers, left out of the gate</h3>
          <ul className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            {specDocument.recorded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
