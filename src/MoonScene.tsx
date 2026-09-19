import { useEffect, useRef, useState } from "react";
import type { MoonController } from "./moonRenderer";

/** Enhances only the matching poster; its original moon is the no-WebGL fallback. */
export function MoonScene({ paused }: { paused: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const controllerRef = useRef<MoonController | null>(null);
  const pausedRef = useRef(paused);
  const syncRef = useRef<() => void>(() => {});
  const [state, setState] = useState("loading");
  const [moving, setMoving] = useState(false);

  useEffect(() => {
    pausedRef.current = paused;
    syncRef.current();
  }, [paused]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let inView = false;
    let contextLost = false;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      const running =
        !pausedRef.current &&
        !reducedMotion.matches &&
        !document.hidden &&
        inView &&
        !contextLost;
      controllerRef.current?.setRunning(running);
      if (!disposed) setMoving(Boolean(controllerRef.current) && running);
    };
    syncRef.current = sync;
    const observer = new IntersectionObserver(
      ([entry]) => {
        inView = entry.isIntersecting;
        sync();
      },
      { threshold: 0.01 },
    );
    observer.observe(canvas);
    const onContextLost = (event: Event) => {
      event.preventDefault();
      contextLost = true;
      setState("fallback");
      sync();
    };
    const onContextRestored = () => {
      contextLost = false;
      controllerRef.current?.render();
      setState("ready");
      sync();
    };
    canvas.addEventListener("webglcontextlost", onContextLost);
    canvas.addEventListener("webglcontextrestored", onContextRestored);
    document.addEventListener("visibilitychange", sync);
    reducedMotion.addEventListener("change", sync);

    // Keep Three.js outside the initial checkout/application bundle.
    import("./moonRenderer")
      .then(({ createMoonRenderer }) => createMoonRenderer(canvas))
      .then((controller) => {
        if (disposed) {
          controller.dispose();
          return;
        }
        controllerRef.current = controller;
        setState(contextLost ? "fallback" : "ready");
        sync();
      })
      .catch((error: unknown) => {
        if (disposed) return;
        console.warn(
          "3D moon unavailable; keeping the original poster.",
          error,
        );
        setState("fallback");
      });

    return () => {
      disposed = true;
      syncRef.current = () => {};
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      reducedMotion.removeEventListener("change", sync);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      controllerRef.current?.dispose();
      controllerRef.current = null;
    };
  }, []);

  return (
    <div
      className="moon-layer"
      data-state={state}
      data-motion={moving ? "running" : "paused"}
    >
      <canvas ref={canvasRef} width={1536} height={1024} />
    </div>
  );
}
