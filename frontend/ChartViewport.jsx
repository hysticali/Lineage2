import React from 'react';

function clampPan(next, zoom) {
  if (zoom <= 1) return { x: 0, y: 0 };
  const limit = Math.max(0, 500 * (1 - 1 / zoom) + 120);
  return {
    x: Math.max(-limit, Math.min(limit, next.x)),
    y: Math.max(-limit, Math.min(limit, next.y)),
  };
}

export default function ChartViewport({ zoom, onZoom, centerKey, children, onBack, canGoBack, onReset }) {
  const viewport = React.useRef(null);
  const [size, setSize] = React.useState(0);
  // Offsets are SVG units, so zoom and resizing retain the viewed world point.
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [dragging, setDragging] = React.useState(false);
  const drag = React.useRef(null), suppressClick = React.useRef(false);
  const zoomRef = React.useRef(zoom);
  zoomRef.current = zoom;
  const onZoomRef = React.useRef(onZoom);
  onZoomRef.current = onZoom;

  React.useLayoutEffect(() => {
    const element = viewport.current;
    const measure = () => setSize(Math.min(element.clientWidth, element.clientHeight, 1000));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);

  React.useLayoutEffect(() => { setPan({ x: 0, y: 0 }); }, [centerKey]);

  React.useEffect(() => {
    setPan((current) => {
      const clamped = clampPan(current, zoom);
      return clamped.x === current.x && clamped.y === current.y ? current : clamped;
    });
  }, [zoom]);

  React.useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    function handleWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.25 : -0.25;
      const next = Math.max(1, Math.min(3, Math.round((zoomRef.current + step) * 4) / 4));
      if (next !== zoomRef.current) onZoomRef.current(next);
    }
    element.addEventListener('wheel', handleWheel, { passive: false });
    return () => element.removeEventListener('wheel', handleWheel);
  }, []);

  const scale = size * zoom / 1000;
  function center() { setPan({ x: 0, y: 0 }); }
  function fit() { center(); onZoom(1); }
  function start(event) {
    suppressClick.current = false;
    if (zoom <= 1 || event.button !== 0 || !event.isPrimary) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, pan, moved: false };
  }
  function move(event) {
    const current = drag.current;
    if (!current || current.id !== event.pointerId || !scale) return;
    const x = event.clientX - current.x, y = event.clientY - current.y;
    if (!current.moved && Math.hypot(x, y) < 5) return;
    current.moved = true; suppressClick.current = true; setDragging(true);
    viewport.current.setPointerCapture(event.pointerId);
    event.preventDefault();
    setPan(clampPan({ x: current.pan.x + x / scale, y: current.pan.y + y / scale }, zoom));
  }
  function end(event) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null; setDragging(false);
    if (viewport.current.hasPointerCapture(event.pointerId)) viewport.current.releasePointerCapture(event.pointerId);
  }
  function keyboard(event) {
    if (event.target !== event.currentTarget) return;
    const directions = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (zoom > 1 && directions[event.key]) {
      event.preventDefault(); const [x, y] = directions[event.key];
      setPan(current => clampPan({ x: current.x + x * 40 / scale, y: current.y + y * 40 / scale }, zoom));
    } else if (event.key === 'Home') {
      event.preventDefault(); center();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault(); onZoom(Math.min(3, zoom + 0.25));
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault(); onZoom(Math.max(1, zoom - 0.25));
    } else if (event.key === '0') {
      event.preventDefault(); fit();
    }
  }
  return <div className="chart-shell">
    <div className={`chart-viewport${zoom > 1 ? ' is-zoomed' : ''}${dragging ? ' is-dragging' : ''}`} ref={viewport}
      role="region" aria-label="Family wheel" tabIndex={0} onKeyDown={keyboard}
      onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end}
      onClickCapture={event => { if (suppressClick.current && event.detail) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}>
      <div className="chart-stage" style={{ width: size * zoom, height: size * zoom, marginLeft: pan.x * scale, marginTop: pan.y * scale }}>
        {children}
      </div>
    </div>
    <div className="chart-toolbar" role="toolbar" aria-label="Chart navigation and zoom">
      <button onClick={onBack} disabled={!canGoBack} aria-label="Return to previous center person" title="Return to previous center person"><span aria-hidden="true">←</span><span className="control-label"> Back</span></button>
      <button onClick={center} aria-label="Center wheel" title="Center wheel (Home)"><span aria-hidden="true">◎</span><span className="control-label"> Center wheel</span></button>
      <div className="zoom-controls">
        <button onClick={() => onZoom(Math.max(1, zoom - .25))} disabled={zoom <= 1} aria-label="Zoom out" title="Zoom out (-)">−</button>
        <output aria-label="Zoom level">{Math.round(zoom * 100)}%</output>
        <button onClick={() => onZoom(Math.min(3, zoom + .25))} disabled={zoom >= 3} aria-label="Zoom in" title="Zoom in (+)">+</button>
      </div>
      <button onClick={fit} aria-label="Fit chart" title="Fit the entire wheel (0)">Fit<span className="control-label"> chart</span></button>
      <button onClick={() => { fit(); onReset(); }} aria-label="Reset view" title="Reset navigation; keep family edits"><span aria-hidden="true">↺</span><span className="control-label"> Reset view</span></button>
    </div>
  </div>;
}
