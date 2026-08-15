/**
 * Placeholder landing route.
 *
 * Its only job in this bootstrap step is to prove the wiring: the browser calls the API through
 * the same-origin `/api` proxy, TanStack Query manages the request, and the response is parsed
 * with the Zod schema the API itself builds the payload from.
 */

import { config, type DependencyHealth, type HealthReport } from "@automend/shared";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchHealth } from "@/lib/api";

function DependencyRow({ name, health }: { name: string; health: DependencyHealth }) {
  return (
    <div className="flex items-center justify-between border-b py-3 last:border-b-0">
      <span className="font-medium">{name}</span>
      <div className="flex items-center gap-3">
        <span className="text-muted-foreground text-sm tabular-nums">{health.latencyMs} ms</span>
        <Badge variant={health.status === "up" ? "default" : "destructive"}>{health.status}</Badge>
      </div>
    </div>
  );
}

function HealthCard({ report }: { report: HealthReport }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-3">
          API health
          <Badge variant={report.status === "healthy" ? "default" : "destructive"}>{report.status}</Badge>
        </CardTitle>
        <CardDescription>
          Service “{report.service}” — up for {report.uptimeSeconds}s
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DependencyRow name="PostgreSQL" health={report.dependencies.postgres} />
        <DependencyRow name="Redis" health={report.dependencies.redis} />
      </CardContent>
    </Card>
  );
}

function HomePage() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: config.webClient.healthRefetchIntervalMs,
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-semibold text-2xl tracking-tight">Platform status</h1>
        <p className="text-muted-foreground">
          The flow builder lands here. For now this page confirms the web app can reach the API, and that the API can
          reach Postgres and Redis.
        </p>
      </div>

      {health.isPending && <p className="text-muted-foreground">Checking…</p>}

      {health.isError && (
        <Card>
          <CardHeader>
            <CardTitle>API unreachable</CardTitle>
            <CardDescription>{health.error.message}</CardDescription>
          </CardHeader>
        </Card>
      )}

      {health.data && <HealthCard report={health.data} />}
    </div>
  );
}

export const Route = createFileRoute("/")({
  component: HomePage,
});
