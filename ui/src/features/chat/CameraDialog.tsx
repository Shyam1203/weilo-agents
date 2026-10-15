import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ErrorText } from "../../components/ui/Field";
import { Icon } from "../../components/ui/Icon";
import { Modal } from "../../components/ui/Modal";

export function CameraDialog({ onCapture, onClose }: { onCapture: (file: File) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot use the camera.");
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then(
      (s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (video.current) video.current.srcObject = s;
      },
      (e: unknown) => setError(e instanceof DOMException && e.name === "NotAllowedError" ? "The browser blocked the camera." : "Cannot open the camera."),
    );
    return () => {
      cancelled = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const capture = () => {
    const el = video.current;
    if (!el || !el.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = el.videoWidth;
    canvas.height = el.videoHeight;
    canvas.getContext("2d")!.drawImage(el, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) onCapture(new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
        onClose();
      },
      "image/jpeg",
      0.9,
    );
  };

  return (
    <Modal title="Camera" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-xl bg-black">
          <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} className="size-full object-cover" />
          {!ready && !error && (
            <span className="absolute text-white/70">
              <Icon name="spinner" size={20} />
            </span>
          )}
        </div>
        <ErrorText>{error}</ErrorText>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" icon="camera" disabled={!ready} onClick={capture}>
            Take photo
          </Button>
        </div>
      </div>
    </Modal>
  );
}
