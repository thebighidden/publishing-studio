import { useEffect, useLayoutEffect, useRef, useState } from "react";

const MIN_ZOOM = 0.05;
const MAX_ZOOM = 8;
const PAD = 28;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return size;
}

function fitScale(size, nw, nh) {
  if (!nw || !nh || !size.w || !size.h) return 1;
  return Math.min((size.w - PAD * 2) / nw, (size.h - PAD * 2) / nh);
}

/**
 * The canvas. Single view zooms and pans (wheel zooms at the cursor, drag pans,
 * double-click toggles fit and 100%); compare lays B over A behind a draggable
 * split; grid is a contact sheet of the batch.
 */
export default function Viewer({ asset, compare, view, zoom, setZoom, fitRef, background, gridItems, onPick, empty }) {
  const viewport = useRef(null);
  const size = useSize(viewport);
  const [natural, setNatural] = useState({ w: asset?.width || 0, h: asset?.height || 0 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [split, setSplit] = useState(50);
  const drag = useRef(null);

  useEffect(() => {
    setNatural({ w: asset?.width || 0, h: asset?.height || 0 });
    setPan({ x: 0, y: 0 });
  }, [asset?.id, asset?.width, asset?.height]);
  useEffect(() => {
    if (zoom === "fit") setPan({ x: 0, y: 0 });
  }, [zoom]);

  const fit = fitScale(size, natural.w, natural.h);
  fitRef.current = fit;
  const scale = zoom === "fit" ? fit : zoom;
  const zoomable = view === "single" && asset?.kind === "image";

  // Wheel zoom has to be a non-passive listener to stop the page scrolling.
  const wheelState = useRef({});
  wheelState.current = { scale, pan, zoomable, size };
  useEffect(() => {
    const el = viewport.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      const { scale: s, pan: p, zoomable: z, size: sz } = wheelState.current;
      if (!z) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left - sz.w / 2;
      const cy = e.clientY - rect.top - sz.h / 2;
      const next = clamp(s * Math.exp(-e.deltaY * 0.0015), MIN_ZOOM, MAX_ZOOM);
      setPan({ x: cx - ((cx - p.x) * next) / s, y: cy - ((cy - p.y) * next) / s });
      setZoom(next);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [setZoom]);

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    if (view === "compare") {
      drag.current = { mode: "split" };
      moveSplit(e);
    } else if (zoomable) {
      if (zoom === "fit") setZoom(fit);
      drag.current = { mode: "pan", x: e.clientX, y: e.clientY, pan };
    } else return;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const moveSplit = (e) => {
    const box = viewport.current.querySelector(".viewer-compare")?.getBoundingClientRect();
    if (box) setSplit(clamp(((e.clientX - box.left) / box.width) * 100, 0, 100));
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    if (d.mode === "split") moveSplit(e);
    else setPan({ x: d.pan.x + e.clientX - d.x, y: d.pan.y + e.clientY - d.y });
  };
  const onPointerUp = () => { drag.current = null; };
  const onDoubleClick = () => {
    if (!zoomable) return;
    setZoom(zoom === "fit" || Math.abs(zoom - fit) < 0.01 ? 1 : "fit");
  };

  let content;
  if (view === "grid") {
    content = (
      <div className="viewer-grid">
        {gridItems.map((item) => (
          <button
            key={item.key}
            className={`viewer-grid-cell ${item.asset?.id === asset?.id ? "selected" : ""} ${item.status}`}
            onClick={() => item.asset && onPick(item.asset)}
            disabled={!item.asset}
          >
            {item.asset ? (
              item.asset.kind === "video"
                ? <video src={item.asset.url} muted loop onMouseEnter={(e) => e.currentTarget.play()} onMouseLeave={(e) => e.currentTarget.pause()} />
                : <img src={item.asset.url} alt="" />
            ) : item.status === "failed" ? <span className="small">Failed</span> : <div className="spinner" />}
            {item.asset?.favorite && <span className="badge fav">★</span>}
          </button>
        ))}
      </div>
    );
  } else if (!asset) {
    content = empty;
  } else if (view === "compare" && compare) {
    const box = natural.w && natural.h
      ? { width: natural.w * fit, height: natural.h * fit }
      : { width: Math.max(0, Math.min(size.w, size.h) - PAD * 2), aspectRatio: "1 / 1" };
    content = (
      <div className="viewer-compare" style={box}>
        <img src={asset.url} alt="A" draggable={false} />
        <img src={compare.url} alt="B" draggable={false} style={{ clipPath: `inset(0 0 0 ${split}%)` }} />
        <div className="viewer-split" style={{ left: `${split}%` }}><span>⇆</span></div>
        <span className="viewer-tag a">A</span>
        <span className="viewer-tag b">B</span>
      </div>
    );
  } else if (asset.kind === "video") {
    content = <video key={asset.id} className="viewer-video" src={asset.url} controls autoPlay loop muted />;
  } else {
    content = (
      <img
        key={asset.id}
        className="viewer-image"
        src={asset.url}
        alt={asset.params?.prompt || "Generated image"}
        draggable={false}
        onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{
          width: natural.w || undefined,
          height: natural.h || undefined,
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          imageRendering: scale > 2 ? "pixelated" : "auto",
        }}
      />
    );
  }

  return (
    <div
      ref={viewport}
      className={`viewer bg-${background} view-${view} ${zoomable && zoom !== "fit" ? "pannable" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      {content}
    </div>
  );
}
