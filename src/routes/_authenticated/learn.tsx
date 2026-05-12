import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import { Search } from "lucide-react";

export const Route = createFileRoute("/_authenticated/learn")({
  head: () => ({ meta: [{ title: "Học ngôn ngữ ký hiệu — SignAI" }] }),
  component: LearnPage,
});

function LearnPage() {
  const { user } = useAuth();
  const [q, setQ] = useState("");

  const { data: vocab, isLoading } = useQuery({
    queryKey: ["vocabularies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vocabularies")
        .select("*")
        .order("word_index");
      if (error) throw error;
      return data;
    },
  });

  const { data: progress } = useQuery({
    queryKey: ["user_progress", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_progress")
        .select("vocabulary_id, mastery, correct_count, total_count");
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((p) => [p.vocabulary_id, p]));
    },
  });

  const filtered = vocab?.filter((v) => v.word.toLowerCase().includes(q.toLowerCase())) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Học ngôn ngữ ký hiệu</h1>
        <p className="text-sm text-muted-foreground">100 từ vựng cơ bản · Practice có chấm điểm AI</p>
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Tìm từ..." value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {isLoading ? (
        <div className="text-muted-foreground">Đang tải...</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {filtered.map((v) => {
            const p = progress?.[v.id];
            const m = p?.mastery ?? 0;
            return (
              <Link key={v.id} to="/learn/$wordId" params={{ wordId: v.id }}>
                <Card className="group cursor-pointer p-4 transition hover:border-primary hover:shadow-md">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-semibold capitalize">{v.word}</span>
                    <span className="text-xs text-muted-foreground">#{v.word_index}</span>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <Progress value={Number(m)} className="h-1.5 flex-1" />
                    <span className="text-xs tabular-nums text-muted-foreground">{Number(m).toFixed(0)}%</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {p ? `${p.correct_count}/${p.total_count} đúng` : "Chưa luyện"}
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
