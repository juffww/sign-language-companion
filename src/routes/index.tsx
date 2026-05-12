import { createFileRoute, Link } from "@tanstack/react-router";
import { Hand, Activity, GraduationCap, Cpu, ArrowRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "SignAI — Nhận diện & Học ngôn ngữ ký hiệu bằng AI" },
      { name: "description", content: "Hệ thống IoT + AI nhận diện ngôn ngữ ký hiệu theo thời gian thực, có module học tập có chấm điểm tự động." },
      { property: "og:title", content: "SignAI — Sign Language Recognition" },
      { property: "og:description", content: "Raspberry Pi + FastAPI + Web. 100 từ vựng. Học có chấm điểm AI." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen" style={{ background: "var(--gradient-subtle)" }}>
      <header className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-2 font-semibold">
          <Hand className="h-5 w-5 text-primary" /> SignAI
        </div>
        <div className="flex gap-2">
          <Link to="/login"><Button variant="ghost" size="sm">Đăng nhập</Button></Link>
          <Link to="/signup"><Button size="sm">Bắt đầu</Button></Link>
        </div>
      </header>

      <section className="container mx-auto px-4 py-16 md:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs text-muted-foreground">
            <Sparkles className="h-3 w-3" /> PBL5 · Đại học Bách Khoa Đà Nẵng
          </span>
          <h1 className="mt-6 text-4xl font-bold tracking-tight md:text-6xl">
            Nhận diện ngôn ngữ ký hiệu bằng <span className="bg-clip-text text-transparent" style={{ backgroundImage: "var(--gradient-hero)" }}>AI thời gian thực</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Camera + Raspberry Pi truyền dữ liệu, mô hình BiLSTM + Attention nhận diện 100 từ phổ biến,
            kèm module học tập tương tác có chấm điểm tự động.
          </p>
          <div className="mt-8 flex justify-center gap-3">
            <Link to="/signup"><Button size="lg">Dùng thử <ArrowRight className="ml-1 h-4 w-4" /></Button></Link>
            <Link to="/login"><Button size="lg" variant="outline">Đăng nhập</Button></Link>
          </div>
        </div>

        <div className="mx-auto mt-20 grid max-w-5xl gap-6 md:grid-cols-3">
          {[
            { icon: Cpu, title: "IoT Pipeline", desc: "Raspberry Pi 4 + Camera stream qua WebSocket tới backend FastAPI." },
            { icon: Activity, title: "AI Inference", desc: "MediaPipe Holistic + BiLSTM + Bahdanau Attention, chuẩn hóa pixel theo vai." },
            { icon: GraduationCap, title: "Học tập tương tác", desc: "Practice & Quiz mode — chấm điểm theo confidence trả về từ model." },
          ].map((f) => (
            <div key={f.title} className="rounded-xl border bg-card p-6" style={{ boxShadow: "var(--shadow-elegant)" }}>
              <f.icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t py-8 text-center text-xs text-muted-foreground">
        © 2026 SignAI · Made for PBL5
      </footer>
    </div>
  );
}
