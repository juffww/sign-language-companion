import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { format } from "date-fns";

export const Route = createFileRoute("/_authenticated/history")({
  head: () => ({ meta: [{ title: "Lịch sử — SignAI" }] }),
  component: HistoryPage,
});

function HistoryPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("id, started_at, ended_at, source, word_count, avg_confidence, predictions(word, confidence, created_at)")
        .order("started_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Lịch sử phiên</h1>
        <p className="text-sm text-muted-foreground">50 phiên gần nhất</p>
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Đang tải...</div>
      ) : data?.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">Chưa có phiên nào.</Card>
      ) : (
        <div className="space-y-3">
          {data?.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <span className="text-sm font-medium">
                    {format(new Date(s.started_at), "dd/MM/yyyy HH:mm")}
                  </span>
                  <span className="ml-2 rounded bg-accent px-2 py-0.5 text-xs">{s.source}</span>
                </div>
                <div className="text-sm text-muted-foreground">
                  {s.word_count} từ · {s.avg_confidence ? `${Number(s.avg_confidence).toFixed(1)}%` : "—"}
                </div>
              </div>
              {s.predictions && s.predictions.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {s.predictions.map((p, i) => (
                    <span key={i} className="rounded-full border bg-card px-2.5 py-0.5 text-xs">
                      {p.word} <span className="text-muted-foreground">{Number(p.confidence).toFixed(0)}%</span>
                    </span>
                  ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
