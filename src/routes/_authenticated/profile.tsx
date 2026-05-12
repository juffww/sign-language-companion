import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Hồ sơ — SignAI" }] }),
  component: ProfilePage,
});

function ProfilePage() {
  const { user, isAdmin } = useAuth();

  const { data: stats } = useQuery({
    queryKey: ["profile-stats", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const [sessions, attempts, progress] = await Promise.all([
        supabase.from("sessions").select("id", { count: "exact", head: true }),
        supabase.from("lesson_attempts").select("is_correct"),
        supabase.from("user_progress").select("mastery"),
      ]);
      const att = attempts.data ?? [];
      const corr = att.filter((a) => a.is_correct).length;
      const masteries = progress.data?.map((p) => Number(p.mastery)) ?? [];
      const mastered = masteries.filter((m) => m >= 80).length;
      return {
        sessions: sessions.count ?? 0,
        attempts: att.length,
        accuracy: att.length ? (corr / att.length) * 100 : 0,
        mastered,
        learning: masteries.length,
      };
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Hồ sơ</h1>
        <p className="text-sm text-muted-foreground">{user?.email}</p>
        {isAdmin && (
          <span className="mt-2 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
            Admin
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Phiên live", value: stats?.sessions ?? 0 },
          { label: "Lượt luyện tập", value: stats?.attempts ?? 0 },
          { label: "Độ chính xác", value: `${(stats?.accuracy ?? 0).toFixed(0)}%` },
          { label: "Từ thành thạo", value: `${stats?.mastered ?? 0}/${stats?.learning ?? 0}` },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">{s.label}</div>
            <div className="mt-2 text-3xl font-bold">{s.value}</div>
          </Card>
        ))}
      </div>
    </div>
  );
}
