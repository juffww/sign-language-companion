import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/admin")({
  head: () => ({ meta: [{ title: "Admin — SignAI" }] }),
  component: AdminPage,
});

function AdminPage() {
  const { isAdmin, loading } = useAuth();

  const { data } = useQuery({
    queryKey: ["admin-stats"],
    enabled: isAdmin,
    queryFn: async () => {
      const [sessions, predictions, attempts] = await Promise.all([
        supabase.from("sessions").select("id, user_id"),
        supabase.from("predictions").select("word, confidence"),
        supabase.from("lesson_attempts").select("target_word, is_correct"),
      ]);

      const wordCounts: Record<string, { count: number; conf: number }> = {};
      (predictions.data ?? []).forEach((p) => {
        const w = p.word;
        if (!wordCounts[w]) wordCounts[w] = { count: 0, conf: 0 };
        wordCounts[w].count++;
        wordCounts[w].conf += Number(p.confidence);
      });
      const topWords = Object.entries(wordCounts)
        .map(([w, v]) => ({ word: w, count: v.count, avgConf: v.conf / v.count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const attemptStats: Record<string, { c: number; t: number }> = {};
      (attempts.data ?? []).forEach((a) => {
        const w = a.target_word;
        if (!attemptStats[w]) attemptStats[w] = { c: 0, t: 0 };
        attemptStats[w].t++;
        if (a.is_correct) attemptStats[w].c++;
      });
      const hardest = Object.entries(attemptStats)
        .filter(([, v]) => v.t >= 3)
        .map(([w, v]) => ({ word: w, accuracy: (v.c / v.t) * 100, total: v.t }))
        .sort((a, b) => a.accuracy - b.accuracy)
        .slice(0, 10);

      const uniqueUsers = new Set((sessions.data ?? []).map((s) => s.user_id)).size;
      return {
        totalSessions: sessions.data?.length ?? 0,
        totalPredictions: predictions.data?.length ?? 0,
        uniqueUsers,
        topWords,
        hardest,
      };
    },
  });

  if (loading) return <div>Đang tải...</div>;
  if (!isAdmin) return <Navigate to="/live" />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Admin Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "Người dùng", value: data?.uniqueUsers ?? 0 },
          { label: "Tổng phiên", value: data?.totalSessions ?? 0 },
          { label: "Tổng dự đoán", value: data?.totalPredictions ?? 0 },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs uppercase text-muted-foreground">{s.label}</div>
            <div className="mt-2 text-3xl font-bold">{s.value}</div>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-4">
          <h3 className="font-semibold">Top 10 từ được nhận diện</h3>
          <div className="mt-3 space-y-2">
            {data?.topWords.map((w) => (
              <div key={w.word} className="flex items-center justify-between text-sm">
                <span className="capitalize">{w.word}</span>
                <span className="text-muted-foreground">{w.count} lần · {w.avgConf.toFixed(0)}%</span>
              </div>
            ))}
            {!data?.topWords.length && <div className="text-sm text-muted-foreground">Chưa có dữ liệu</div>}
          </div>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold">10 từ khó nhất (luyện tập)</h3>
          <div className="mt-3 space-y-2">
            {data?.hardest.map((w) => (
              <div key={w.word} className="flex items-center justify-between text-sm">
                <span className="capitalize">{w.word}</span>
                <span className="text-destructive">{w.accuracy.toFixed(0)}% / {w.total} lần</span>
              </div>
            ))}
            {!data?.hardest.length && <div className="text-sm text-muted-foreground">Chưa có dữ liệu</div>}
          </div>
        </Card>
      </div>
    </div>
  );
}
