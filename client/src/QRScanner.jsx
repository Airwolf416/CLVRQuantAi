import { useState, useEffect, useRef, useCallback } from "react";
import jsQR from "jsqr";

const C = {
  bg: "#050709", panel: "#0c1220", border: "#141e35",
  gold: "#c9a84c", gold2: "#e8c96d", text: "#c8d4ee",
  muted: "#4a5d80", muted2: "#6b7fa8", green: "#00c787", red: "#ff4060",
};
const MONO = "'IBM Plex Mono', monospace";

export default function QRScanner({ onScan, onClose }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const scanRef   = useRef(null);
  const stoppedRef = useRef(false);

  const [camError,   setCamError]   = useState(null);
  const [scanning,   setScanning]   = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [torchOn,    setTorchOn]    = useState(false);
  const [detected,   setDetected]   = useState(false);

  const stopAll = useCallback(() => {
    stoppedRef.current = true;
    if (scanRef.current) cancelAnimationFrame(scanRef.current);
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
  }, []);

  const handleDetected = useCallback((raw) => {
    if (stoppedRef.current) return;
    stopAll();
    setDetected(true);
    setTimeout(() => onScan(raw), 400);
  }, [stopAll, onScan]);

  useEffect(() => {
    let active = true;
    async function startCam() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setScanning(true);
        }
      } catch (e) {
        const msg = e?.message || "";
        setCamError(msg.includes("ermission") ? "Camera permission denied. Please allow camera access." : "Camera unavailable on this device.");
        setShowManual(true);
      }
    }
    startCam();
    return () => { active = false; stopAll(); };
  }, [stopAll]);

  useEffect(() => {
    if (!scanning || detected) return;

    let localStopped = false;

    const canvasScan = async () => {
      if (localStopped) return;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      const loop = () => {
        if (localStopped || stoppedRef.current) return;
        const vid = videoRef.current;
        if (vid?.videoWidth > 0) {
          canvas.width  = vid.videoWidth;
          canvas.height = vid.videoHeight;
          ctx.drawImage(vid, 0, 0);
          const img  = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height);
          if (code?.data) { handleDetected(code.data); return; }
        }
        scanRef.current = requestAnimationFrame(loop);
      };
      loop();
    };

    if ("BarcodeDetector" in window) {
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const loop = async () => {
        if (localStopped || stoppedRef.current) return;
        try {
          if (videoRef.current?.readyState === 4) {
            const codes = await detector.detect(videoRef.current);
            if (codes.length > 0) { handleDetected(codes[0].rawValue); return; }
          }
        } catch {}
        scanRef.current = requestAnimationFrame(loop);
      };
      loop();
    } else {
      canvasScan();
    }

    return () => { localStopped = true; if (scanRef.current) cancelAnimationFrame(scanRef.current); };
  }, [scanning, detected, handleDetected]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn }] });
      setTorchOn(t => !t);
    } catch {}
  };

  const submitManual = () => {
    const code = manualCode.trim().toUpperCase();
    if (!code) return;
    handleDetected(code);
  };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9000, background: "#000", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes scanLine { 0%{top:4px} 100%{top:calc(100% - 6px)} }
        @keyframes scanPulse { 0%,100%{opacity:0.7} 50%{opacity:1} }
      `}</style>

      <div style={{ position: "relative", flex: 1, overflow: "hidden" }}>
        <video
          ref={videoRef}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
          playsInline muted autoPlay
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />

        {!showManual && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.55)" }} />

            <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
              <div style={{ fontFamily: MONO, fontSize: 9, color: "rgba(255,255,255,0.6)", letterSpacing: "0.2em", marginBottom: 20 }}>
                SCAN ACCESS CODE QR
              </div>

              <div style={{ position: "relative", width: 240, height: 240, margin: "0 auto" }}>
                {[
                  { top: 0, left: 0, borderTop: `3px solid ${C.gold}`, borderLeft: `3px solid ${C.gold}`, borderRadius: "8px 0 0 0" },
                  { top: 0, right: 0, borderTop: `3px solid ${C.gold}`, borderRight: `3px solid ${C.gold}`, borderRadius: "0 8px 0 0" },
                  { bottom: 0, left: 0, borderBottom: `3px solid ${C.gold}`, borderLeft: `3px solid ${C.gold}`, borderRadius: "0 0 0 8px" },
                  { bottom: 0, right: 0, borderBottom: `3px solid ${C.gold}`, borderRight: `3px solid ${C.gold}`, borderRadius: "0 0 8px 0" },
                ].map((s, i) => (
                  <div key={i} style={{ position: "absolute", width: 32, height: 32, ...s }} />
                ))}

                {scanning && !detected && (
                  <div style={{
                    position: "absolute", left: 6, right: 6, height: 2,
                    background: `linear-gradient(90deg,transparent,${C.gold},transparent)`,
                    boxShadow: `0 0 10px ${C.gold}`,
                    animation: "scanLine 2s ease-in-out infinite",
                  }} />
                )}

                {detected && (
                  <div style={{
                    position: "absolute", inset: 0, background: "rgba(0,199,135,0.25)",
                    borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
                    border: "2px solid #00c787",
                  }}>
                    <div style={{ fontSize: 52, animation: "scanPulse 0.4s ease" }}>✓</div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10, color: "rgba(255,255,255,0.55)" }}>
                {detected ? "Code detected!" : "Align QR code within frame"}
              </div>
            </div>
          </div>
        )}

        {camError && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(5,7,9,0.88)", padding: 24 }}>
            <div style={{ fontFamily: MONO, fontSize: 10, color: C.red, textAlign: "center", lineHeight: 1.6 }}>{camError}</div>
          </div>
        )}
      </div>

      <div style={{ background: "#0b1220", padding: "16px 20px 36px", borderTop: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: showManual ? 12 : 0 }}>
          <button onClick={() => { stopAll(); onClose(); }} style={btnStyle(C.muted, "rgba(255,255,255,0.04)", "rgba(255,255,255,0.1)")}>✕ Cancel</button>
          <button onClick={toggleTorch} style={btnStyle(torchOn ? C.gold : C.muted2, torchOn ? "rgba(201,168,76,0.15)" : "rgba(255,255,255,0.04)", torchOn ? "rgba(201,168,76,0.35)" : "rgba(255,255,255,0.1)")}>
            🔦 {torchOn ? "On" : "Torch"}
          </button>
          <button onClick={() => setShowManual(m => !m)} style={btnStyle(C.gold, "rgba(201,168,76,0.08)", "rgba(201,168,76,0.25)")}>
            ⌨ Manual
          </button>
        </div>

        {showManual && (
          <div style={{ display: "flex", gap: 8, marginTop: 2 }}>
            <input
              data-testid="input-qr-manual"
              value={manualCode}
              onChange={e => setManualCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === "Enter" && submitManual()}
              placeholder="CLVR-VIP-XXXX or CLVR-FF-XXXX"
              autoFocus
              style={{
                flex: 1, background: "rgba(255,255,255,0.05)", border: `1px solid rgba(201,168,76,0.25)`,
                borderRadius: 6, padding: "10px 12px", color: C.text, fontSize: 11,
                fontFamily: MONO, outline: "none", letterSpacing: 1,
              }}
            />
            <button
              data-testid="btn-qr-manual-submit"
              onClick={submitManual}
              style={btnStyle(C.gold, "rgba(201,168,76,0.15)", "rgba(201,168,76,0.4)")}
            >
              ↵
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function btnStyle(color, bg, border) {
  return {
    background: bg, border: `1px solid ${border}`, borderRadius: 8,
    padding: "10px 16px", color, fontSize: 11, cursor: "pointer",
    fontFamily: MONO, letterSpacing: "0.05em", flex: 1,
  };
}
