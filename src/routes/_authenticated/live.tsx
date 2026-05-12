import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { getFastApiUrl, setFastApiUrl } from "@/lib/fastapi";
import { useAuth } from "@/lib/auth-context";
import { Camera, Square, Play, Settings2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/live")({
  head: () => ({ meta: [{ title: "Live Recognition — SignAI" }] }),
  component: LivePage,
});

interface PredResult {
  word: string;
  conf: number;
  top3: Array<[string, number]>;
}

function LivePage() {
  const { user } = useAuth();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const intervalRef = useRef<number | null>(null);

  const [streaming, setStreaming] = useState(false);
  const [recording, setRecording] = useState(false);
  const [framesCaptured, setFramesCaptured] = useState(0);
  const [predictions, setPredictions] = useState<PredResult[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [apiUrl, setApiUrlState] = useState(getFastApiUrl());
  const [showSettings, setShowSettings] = useState(false);

  const FRAMES_NEEDED = 60; // ~2-3 seconds at 20fps

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
      toast.error("Không truy cập được camera: " + (e as Error).message);
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStreaming(false);
    setRecording(false);
    if (intervalRef.current) clearInterval(intervalRef.current);
  };

  useEffect(() => stopCamera, []);

  const ensureSession = async (): Promise<string> => {
    if (sessionId) return sessionId;
    const { data, error } = await supabase
      .from("sessions")
      .insert({ user_id: user!.id, source: "webcam" })
      .select("id")
      .single();
    if (error || !data) throw error || new Error("Không tạo được session");
    setSessionId(data.id);
    return data.id;
  };

  const captureFrameJpeg = (): Blob | null => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return null;
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let blob: Blob | null = null;
    canvas.toBlob((b) => (blob = b), "image/jpeg", 0.7);
    // Synchronous workaround: use dataURL
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    const bytes = atob(dataUrl.split(",")[1]);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    return new Blob([arr], { type: "image/jpeg" });
  };

  const startRecording = () => {
    if (!streaming) return;
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
          void sendFrames(frames);
        }
      }
    }, 50); // 20 fps
  };

  const stopRecordingEarly = () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    setRecording(false);
  };

  const sendFrames = async (frames: Blob[]) => {
    if (frames.length < 8) {
      toast.error("Cần ít nhất 8 frame");
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      frames.forEach((b, i) => fd.append("frames", b, `frame_${i}.jpg`));
      const res = await fetch(`${apiUrl}/api/predict`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(`Backend ${res.status}`);
      const json = (await res.json()) as PredResult;
      setPredictions((p) => [...p, json].slice(-10));

      const sid = await ensureSession();
      await supabase.from("predictions").insert({
        session_id: sid,
        user_id: user!.id,
        word: json.word,
        confidence: json.conf,
        top3: json.top3,
      });
      toast.success(`${json.word} (${json.conf.toFixed(1)}%)`);
    } catch (e) {
      toast.error("Lỗi gọi backend: " + (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const endSession = async () => {
    if (!sessionId) return;
    const wordCount = predictions.length;
    const avg = wordCount ? predictions.reduce((s, p) => s + p.conf, 0) / wordCount : 0;
    await supabase
      .from("sessions")
      .update({ ended_at: new Date().toISOString(), word_count: wordCount, avg_confidence: avg })
      .eq("id", sessionId);
    toast.success("Đã lưu phiên");
    setSessionId(null);
    setPredictions([]);
  };

  const saveApiUrl = () => {
    setFastApiUrl(apiUrl);
    setApiUrlState(apiUrl);
    toast.success("Đã lưu URL backend");
    setShowSettings(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Live Recognition</h1>
          <p className="text-sm text-muted-foreground">
            Bấm <strong>Bắt đầu camera</strong> → <strong>Quay ký hiệu</strong> (~3 giây).
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)}>
          <Settings2 className="h-4 w-4" />
        </Button>
      </div>

      {showSettings && (
        <Card className="p-4">
          <Label htmlFor="api">FastAPI Backend URL</Label>
          <div className="mt-2 flex gap-2">
            <Input id="api" value={apiUrl} onChange={(e) => setApiUrlState(e.target.value)} placeholder="https://xxx.trycloudflare.com" />
            <Button onClick={saveApiUrl}>Lưu</Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Hiện tại: <code>{apiUrl}</code>
          </p>
        </Card>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        <Card className="md:col-span-2 overflow-hidden p-0">
          <div className="relative aspect-video bg-black">
            <video ref={videoRef} className="h-full w-full -scale-x-100 object-cover" playsInline muted />
            <canvas ref={canvasRef} className="hidden" />
            {!streaming && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-white">
                <Camera className="h-10 w-10 opacity-60" />
                <Button onClick={startCamera}>Bắt đầu camera</Button>
              </div>
            )}
            {recording && (
              <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-destructive px-3 py-1 text-xs font-medium text-destructive-foreground">
                <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                REC {framesCaptured}/{FRAMES_NEEDED}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t bg-card p-3">
            {streaming && !recording && (
              <Button onClick={startRecording} disabled={busy}>
                <Play className="mr-1 h-4 w-4" /> Quay ký hiệu
              </Button>
            )}
            {recording && (
              <Button variant="secondary" onClick={stopRecordingEarly}>
                <Square className="mr-1 h-4 w-4" /> Dừng & dự đoán
              </Button>
            )}
            {streaming && (
              <Button variant="outline" onClick={stopCamera}>
                Tắt camera
              </Button>
            )}
            {sessionId && (
              <Button variant="ghost" onClick={endSession} className="ml-auto">
                Kết thúc phiên ({predictions.length} từ)
              </Button>
            )}
          </div>
          {recording && <Progress value={(framesCaptured / FRAMES_NEEDED) * 100} className="rounded-none" />}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 font-semibold">Kết quả gần nhất</h3>
          {predictions.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              Chưa có dự đoán
            </div>
          ) : (
            <div className="space-y-3">
              {[...predictions].reverse().map((p, i) => (
                <div key={i} className="rounded-lg border p-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-lg font-semibold">{p.word}</span>
                    <span className="text-sm text-primary">{p.conf.toFixed(1)}%</span>
                  </div>
                  <Progress value={p.conf} className="mt-2 h-1" />
                  <div className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                    {p.top3.slice(1, 3).map(([w, c], j) => (
                      <div key={j} className="flex justify-between">
                        <span>{w}</span><span>{c.toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            <Link to="/learn" className="text-primary underline">Học từ mới →</Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
