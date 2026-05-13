import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, Camera, Play, CheckCircle2, XCircle } from "lucide-react";
import { getFastApiUrl } from "@/lib/fastapi";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/learn_/$wordId")({
  head: () => ({ meta: [{ title: "Luyện tập — SignAI" }] }),
  component: LessonPage,
});

const MIN_CONFIDENCE = 60;
const FRAMES_NEEDED = 60;

function LessonPage() {
  const { wordId } = useParams({ from: "/_authenticated/learn/$wordId" });
  const { user } = useAuth();

  const { data: vocab } = useQuery({
    queryKey: ["vocab", wordId],
    queryFn: async () => {
      const { data, error } = await supabase.from("vocabularies").select("*").eq("id", wordId).single();
      if (error) throw error;
      return data;
    },
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ word: string; conf: number; correct: boolean; top3: Array<[string, number]> } | null>(null);

  const startCamera = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720, facingMode: "user" },
      });
      streamRef.current = s;
      if (videoRef.current) {
        videoRef.current.srcObject = s;
        await videoRef.current.play();
      }
      setStreaming(true);
    } catch (e) {
      toast.error("Không truy cập được camera");
    }
  };

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    if (intervalRef.current) clearInterval(intervalRef.current);
  }, []);

  const captureFrameJpeg = (): Blob | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = 640;
    canvas.height = 360;
    canvas.getContext("2d")!.drawImage(video, 0, 0, 640, 360);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const bytes = atob(dataUrl.split(",")[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: "image/jpeg" });
  };

  const start = () => {
    if (!streaming || !vocab) return;
    setResult(null);
    const frames: Blob[] = [];
    setFramesCaptured(0);
    setRecording(true);
    intervalRef.current = window.setInterval(() => {
      const blob = captureFrameJpeg();
      if (blob) {
        frames.push(blob);
        setFramesCaptured(frames.length);
        if (frames.length >= FRAMES_NEEDED) {
          window.clearInterval(intervalRef.current!);
          setRecording(false);
          void evaluate(frames);
        }
      }
    }, 50);
  };

  const evaluate = async (frames: Blob[]) => {
    if (!vocab) return;
    setBusy(true);
    try {
      const fd = new FormData();
      frames.forEach((b, i) => fd.append("frames", b, `f_${i}.jpg`));
      const res = await fetch(`${getFastApiUrl()}/api/predict`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Backend ${res.status}`);
      const json = (await res.json()) as { word: string; conf: number; top3: Array<[string, number]> };
      const correct = json.word.toLowerCase() === vocab.word.toLowerCase() && json.conf >= MIN_CONFIDENCE;
      setResult({ ...json, correct });

      await supabase.from("lesson_attempts").insert({
        user_id: user!.id,
        vocabulary_id: vocab.id,
        target_word: vocab.word,
        predicted_word: json.word,
        confidence: json.conf,
        is_correct: correct,
        top3: json.top3,
      });
    } catch (e) {
      toast.error("Lỗi backend: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!vocab) return <div>Đang tải...</div>;

  return (
    <div className="space-y-6">
      <Link to="/learn" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Quay lại
      </Link>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="p-6">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Ký hiệu mục tiêu</span>
          <h1 className="mt-2 text-5xl font-bold capitalize">{vocab.word}</h1>
          <p className="mt-4 text-sm text-muted-foreground">
            {vocab.description ?? "Hãy thực hiện ký hiệu trong khoảng 3 giây trước camera. Hệ thống sẽ chấm điểm tự động."}
          </p>
          {vocab.video_url && (
            <video src={vocab.video_url} controls className="mt-4 w-full rounded-lg" />
          )}
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="relative aspect-video bg-black">
            <video ref={videoRef} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            {!streaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <Camera className="h-10 w-10 opacity-60" />
                <Button onClick={startCamera}>Bật camera</Button>
              </div>
            )}
            {recording && (
              <div className="absolute left-3 top-3 rounded-full bg-destructive px-3 py-1 text-xs text-destructive-foreground">
                REC {framesCaptured}/{FRAMES_NEEDED}
              </div>
            )}
          </div>
          <div className="border-t bg-card p-3">
            <Button className="w-full" disabled={!streaming || recording || busy} onClick={start}>
              <Play className="mr-1 h-4 w-4" /> {busy ? "Đang chấm..." : "Bắt đầu luyện tập"}
            </Button>
            {recording && <Progress value={(framesCaptured / FRAMES_NEEDED) * 100} className="mt-2 h-1" />}
          </div>

          {result && (
            <div className={`border-t p-4 ${result.correct ? "bg-success/10" : "bg-destructive/10"}`}>
              <div className="flex items-center gap-2">
                {result.correct ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : (
                  <XCircle className="h-5 w-5 text-destructive" />
                )}
                <span className="font-semibold">
                  {result.correct ? "Chính xác!" : "Chưa đúng"}
                </span>
                <span className="ml-auto text-sm">{result.conf.toFixed(1)}%</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Model dự đoán: <strong className="text-foreground">{result.word}</strong>
                {!result.correct && <> (mục tiêu: {vocab.word})</>}
              </p>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
