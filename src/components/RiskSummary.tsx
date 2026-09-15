"use client";

import { Badge } from "@/components/ui/badge";

export default function RiskSummary({
  summary,
}: {
  summary: { high: number; medium: number; low: number };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-3 text-center">
      <div className="p-4 rounded-lg border border-border/50 bg-muted/50">
        <div className="text-2xl font-semibold tracking-tight text-destructive">
          {summary.high}
        </div>
        <div className="mt-2 text-sm font-medium text-muted-foreground">
          高危
        </div>
        <Badge variant="outline" className="mt-2 text-xs">
          高危
        </Badge>
      </div>
      <div className="p-4 rounded-lg border border-border/50 bg-muted/50">
        <div className="text-2xl font-semibold tracking-tight text-primary">
          {summary.medium}
        </div>
        <div className="mt-2 text-sm font-medium text-muted-foreground">
          中危
        </div>
        <Badge variant="outline" className="mt-2 text-xs">
          中危
        </Badge>
      </div>
      <div className="p-4 rounded-lg border border-border/50 bg-muted/50">
        <div className="text-2xl font-semibold tracking-tight text-success">
          {summary.low}
        </div>
        <div className="mt-2 text-sm font-medium text-muted-foreground">
          低危 / 通过
        </div>
        <Badge variant="outline" className="mt-2 text-xs">
          低危 / 通过
        </Badge>
      </div>
    </div>
  );
}