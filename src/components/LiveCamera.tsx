"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { CameraOff, CheckCircle2, Loader2 } from "lucide-react";

export type LiveCameraHandle = {
  capture: () => Promise<Blob>;
  celebrate: (label: string) => void;
  resetPreview: () => void;
  ready: boolean;
};

type LiveCameraProps = {
  className?: string;
  /** Só pede câmera quando precisa bater ponto ou há sessão aberta */
  enabled?: boolean;
};

export const LiveCamera = forwardRef<LiveCameraHandle, LiveCameraProps>(
  function LiveCamera({ className, enabled = true }, ref) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const clearTimer = useRef<number | null>(null);
    const [ready, setReady] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [flash, setFlash] = useState(false);
    const [frozenUrl, setFrozenUrl] = useState<string | null>(null);
    const [successLabel, setSuccessLabel] = useState<string | null>(null);

    const stopStream = useCallback(() => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
      setReady(false);
    }, []);

    useEffect(() => {
      if (!enabled) {
        stopStream();
        setError(null);
        return;
      }

      let cancelled = false;

      async function start() {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: "user",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
            audio: false,
          });
          if (cancelled) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          streamRef.current = stream;
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            await videoRef.current.play();
            setReady(true);
          }
        } catch {
          setError("Permita o uso da câmera para registrar com foto.");
        }
      }

      void start();
      return () => {
        cancelled = true;
        if (clearTimer.current) window.clearTimeout(clearTimer.current);
        stopStream();
      };
    }, [enabled, stopStream]);

    useImperativeHandle(
      ref,
      () => ({
        ready,
        capture: () =>
          new Promise<Blob>((resolve, reject) => {
            const video = videoRef.current;
            if (!video || !ready) {
              reject(new Error("Espere a câmera ligar e tente de novo."));
              return;
            }
            const canvas = document.createElement("canvas");
            canvas.width = video.videoWidth || 1280;
            canvas.height = video.videoHeight || 720;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
              reject(new Error("Não deu para tirar a foto. Tente de novo."));
              return;
            }
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

            setFlash(true);
            setFrozenUrl(dataUrl);
            window.setTimeout(() => setFlash(false), 180);

            canvas.toBlob(
              (blob) => {
                if (!blob) reject(new Error("Não deu para salvar a foto. Tente de novo."));
                else resolve(blob);
              },
              "image/jpeg",
              0.92,
            );
          }),
        celebrate: (label: string) => {
          if (!label) {
            setSuccessLabel(null);
            setFrozenUrl(null);
            return;
          }
          setSuccessLabel(label);
          if (clearTimer.current) window.clearTimeout(clearTimer.current);
          clearTimer.current = window.setTimeout(() => {
            setSuccessLabel(null);
            setFrozenUrl(null);
          }, 2200);
        },
        resetPreview: () => {
          if (clearTimer.current) window.clearTimeout(clearTimer.current);
          setSuccessLabel(null);
          setFrozenUrl(null);
          setFlash(false);
        },
      }),
      [ready],
    );

    if (!enabled) {
      return (
        <div className={`live-camera is-idle ${className ?? ""}`}>
          <CameraOff size={28} />
          <p>Câmera libera quando o ponto estiver disponível.</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className={`live-camera is-error ${className ?? ""}`}>
          <CameraOff size={28} />
          <p>{error}</p>
        </div>
      );
    }

    return (
      <div
        className={`live-camera ${flash ? "is-flash" : ""} ${successLabel ? "is-success" : ""} ${className ?? ""}`}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className={frozenUrl ? "is-hidden" : ""}
        />
        {frozenUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={frozenUrl} alt="Foto do registro" className="camera-freeze" />
        )}
        {flash && <div className="camera-flash" aria-hidden />}
        {successLabel && (
          <div className="camera-success">
            <CheckCircle2 size={36} />
            <strong>{successLabel}</strong>
          </div>
        )}
        {!ready && !frozenUrl && (
          <div className="live-camera-loading">
            <Loader2 className="spin" size={24} />
            <span>Ligando a câmera…</span>
          </div>
        )}
      </div>
    );
  },
);
