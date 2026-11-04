"use client";

import { benchRuns, cellProfiles, type CellProfile } from "@/lib/bench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export function BenchPanel({ onApply, disabled }: { onApply: (profile: CellProfile) => void; disabled: boolean }) {
  return (
    <div className="grid gap-4">
      <Card className="gap-3 p-5">
        <p className="text-xs tracking-[0.18em] text-primary uppercase">bis3946-pc · 27 Oct 2026</p>
        <h2 className="font-display text-3xl tracking-tight">Newest LiGi runs</h2>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          These are the newest tests on the lab machine. Nothing on disk was newer than 27 October 2026. The cell
          buttons load that geometry into the gate: cell size, 5 fps, and stride 6. The c8 button also turns on an
          ML-KEM optical rendezvous, which is how that pass was sealed.
        </p>
      </Card>
      <div className="grid gap-3 lg:grid-cols-2">
        {benchRuns.map((run) => (
          <Card key={run.name} className="gap-2 p-4">
            <div className="flex items-start justify-between gap-3">
              <h3 className="font-display text-xl">{run.name}</h3>
              <Badge variant={run.result === "Pass" || run.result.endsWith("pass") || run.result === "100/100" ? "default" : "outline"}>
                {run.result}
              </Badge>
            </div>
            <p className="font-mono text-xs text-muted-foreground">{run.when} · Europe/Zagreb</p>
            <p className="text-sm leading-relaxed">{run.detail}</p>
          </Card>
        ))}
      </div>
      <Card className="gap-3 p-5">
        <h3 className="font-display text-xl">Load a cell profile</h3>
        <div className="flex flex-wrap gap-2">
          {cellProfiles.map((profile) => (
            <Button key={profile.id} type="button" variant="outline" disabled={disabled} onClick={() => onApply(profile)}>
              {profile.label}
            </Button>
          ))}
        </div>
        <ul className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
          {cellProfiles.map((profile) => (
            <li key={profile.id}>
              <span className="font-mono text-foreground">{profile.label}</span> · {profile.cellPx} px · stride {profile.stride} · {profile.fps} fps. {profile.note}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
