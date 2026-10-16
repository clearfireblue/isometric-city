'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Tool } from '@/games/goblins/types';
import { BUILDINGS, MINUTES_PER_SECOND } from '@/games/goblins/catalog';
import { Hollow } from '@/games/goblins/sim';
import { generateWorld } from '@/games/goblins/worldgen';
import { clearSave, loadWorld, saveWorld } from '@/games/goblins/save';
import { Camera, Renderer, RenderState, pickGoblin, pickTile, project } from '@/games/goblins/render';
import { Snapshot, takeSnapshot } from './snapshot';
import { BuildBar, LogFeed, SidePanel, TopBar } from './Hud';

const PAINT_TOOLS: Tool[] = ['path', 'clear', 'fence', 'flower_bed', 'lantern'];

function newHollow(): Hollow {
  return new Hollow(generateWorld(Math.floor(Math.random() * 1e9)));
}

function centreCamera(h: Hollow, cam: Camera) {
  const fire = h.world.buildings.find((b) => b.kind === 'cookfire') ?? h.world.buildings[0];
  const x = fire ? fire.x : h.world.width / 2;
  const y = fire ? fire.y : h.world.height / 2;
  const { px, py } = project(x, y, 0);
  cam.x = px;
  cam.y = py;
}

export default function GoblinGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hollowRef = useRef<Hollow | null>(null);
  const camRef = useRef<Camera>({ x: 0, y: 0, zoom: 1.5 });
  const rendererRef = useRef(new Renderer());
  const rsRef = useRef<RenderState>({ hover: null, tool: 'inspect', selectedGoblin: null, selectedBuilding: null, time: 0 });
  const speedRef = useRef(1);
  const followRef = useRef(false);

  const [tool, setToolState] = useState<Tool>('inspect');
  const [speed, setSpeedState] = useState(1);
  // selection lives in rsRef for the renderer; these mirror it so React re-renders
  const [, setSelGoblin] = useState<number | null>(null);
  const [, setSelBuilding] = useState<number | null>(null);
  const [follow, setFollowState] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const setTool = useCallback((t: Tool) => {
    rsRef.current.tool = t;
    setToolState(t);
  }, []);
  const setSpeed = useCallback((s: number) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);
  const setFollow = useCallback((f: boolean) => {
    followRef.current = f;
    setFollowState(f);
  }, []);
  const selectGoblin = useCallback((id: number | null) => {
    rsRef.current.selectedGoblin = id;
    rsRef.current.selectedBuilding = null;
    setSelGoblin(id);
    setSelBuilding(null);
    if (id === null) setFollow(false);
    const g = hollowRef.current?.world.goblins.find((gg) => gg.id === id);
    if (g) {
      const { px, py } = project(g.x, g.y, g.z);
      camRef.current.x = px;
      camRef.current.y = py;
    }
  }, [setFollow]);
  const selectBuilding = useCallback((id: number | null) => {
    rsRef.current.selectedBuilding = id;
    rsRef.current.selectedGoblin = null;
    setSelBuilding(id);
    setSelGoblin(null);
    setFollow(false);
  }, [setFollow]);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 1800);
  }, []);

  // main loop
  useEffect(() => {
    if (hollowRef.current === null) {
      const saved = loadWorld();
      hollowRef.current = saved ? new Hollow(saved) : newHollow();
      centreCamera(hollowRef.current, camRef.current);
    }
    // handy for tinkering from the browser console: goblinHollow.world
    (window as unknown as { goblinHollow?: () => Hollow | null }).goblinHollow = () => hollowRef.current;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    let raf = 0;
    let last = performance.now();
    let snapTimer = 0;
    let saveTimer = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(canvas.clientWidth * dpr);
      canvas.height = Math.floor(canvas.clientHeight * dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    const frame = (now: number) => {
      const h = hollowRef.current!;
      const dtReal = Math.min(0.1, (now - last) / 1000);
      last = now;
      rsRef.current.time += dtReal;
      // simulate in ≤1 minute steps for stable pathing
      let minutes = dtReal * MINUTES_PER_SECOND * speedRef.current;
      while (minutes > 0) {
        const step = Math.min(1, minutes);
        h.update(step);
        minutes -= step;
      }
      // follow selected goblin
      if (followRef.current && rsRef.current.selectedGoblin !== null) {
        const g = h.world.goblins.find((gg) => gg.id === rsRef.current.selectedGoblin);
        if (g) {
          const { px, py } = project(g.x, g.y, g.z);
          const cam = camRef.current;
          cam.x += (px - cam.x) * Math.min(1, dtReal * 4);
          cam.y += (py - cam.y) * Math.min(1, dtReal * 4);
        }
      }
      const dpr = canvas.width / Math.max(1, canvas.clientWidth);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      rendererRef.current.draw(ctx, h, camRef.current, canvas.clientWidth, canvas.clientHeight, rsRef.current);

      snapTimer += dtReal;
      if (snapTimer > 0.25) {
        snapTimer = 0;
        setSnap(takeSnapshot(h, rsRef.current.selectedGoblin, rsRef.current.selectedBuilding));
      }
      saveTimer += dtReal;
      if (saveTimer > 20) {
        saveTimer = 0;
        saveWorld(h.world);
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onUnload = () => hollowRef.current && saveWorld(hollowRef.current.world);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('beforeunload', onUnload);
      onUnload();
    };
  }, []);

  // ----- input ---------------------------------------------------------------

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ startX: number; startY: number; camX: number; camY: number; panning: boolean; painting: boolean; lastTile: string; pinch?: number } | null>(null);

  const applyTool = useCallback((x: number, y: number) => {
    const h = hollowRef.current!;
    const t = rsRef.current.tool;
    let err: string | null = null;
    if (t === 'path') err = h.paintPath(x, y);
    else if (t === 'clear') err = h.clear(x, y);
    else if (t in BUILDINGS) err = h.place(t as keyof typeof BUILDINGS, x, y);
    if (err && err !== 'Nothing to clear') flash(err);
  }, [flash]);

  const localPoint = (e: React.PointerEvent | React.WheelEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    canvasRef.current!.setPointerCapture(e.pointerId);
    const p = localPoint(e);
    pointers.current.set(e.pointerId, p);
    const cam = camRef.current;
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      drag.current = { startX: (a.x + b.x) / 2, startY: (a.y + b.y) / 2, camX: cam.x, camY: cam.y, panning: true, painting: false, lastTile: '', pinch: Math.hypot(a.x - b.x, a.y - b.y) };
      return;
    }
    const tool = rsRef.current.tool;
    const painting = e.button === 0 && PAINT_TOOLS.includes(tool);
    drag.current = { startX: p.x, startY: p.y, camX: cam.x, camY: cam.y, panning: e.button !== 0, painting, lastTile: '' };
    if (painting) {
      const t = pickTile(hollowRef.current!.world, cam, canvasRef.current!.clientWidth, canvasRef.current!.clientHeight, p.x, p.y);
      if (t) {
        drag.current.lastTile = `${t.x},${t.y}`;
        applyTool(t.x, t.y);
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const p = localPoint(e);
    const canvas = canvasRef.current!;
    const cam = camRef.current;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, p);
    rsRef.current.hover = pickTile(hollowRef.current!.world, cam, W, H, p.x, p.y);
    const d = drag.current;
    if (!d) return;
    if (pointers.current.size === 2 && d.pinch) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      cam.zoom = Math.max(0.5, Math.min(3.5, cam.zoom * (dist / d.pinch)));
      d.pinch = dist;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      cam.x -= (mx - d.startX) / cam.zoom;
      cam.y -= (my - d.startY) / cam.zoom;
      d.startX = mx;
      d.startY = my;
      return;
    }
    if (d.painting && rsRef.current.hover) {
      const key = `${rsRef.current.hover.x},${rsRef.current.hover.y}`;
      if (key !== d.lastTile) {
        d.lastTile = key;
        applyTool(rsRef.current.hover.x, rsRef.current.hover.y);
      }
      return;
    }
    if (!d.panning && Math.hypot(p.x - d.startX, p.y - d.startY) > 5) d.panning = true;
    if (d.panning) {
      cam.x = d.camX - (p.x - d.startX) / cam.zoom;
      cam.y = d.camY - (p.y - d.startY) / cam.zoom;
      if (followRef.current) setFollow(false);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const p = localPoint(e);
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (pointers.current.size > 0) return;
    drag.current = null;
    if (!d || d.panning || d.painting || e.button !== 0) return;
    const canvas = canvasRef.current!;
    const h = hollowRef.current!;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const tool = rsRef.current.tool;
    if (tool === 'inspect') {
      const g = pickGoblin(h.world, camRef.current, W, H, p.x, p.y);
      if (g) {
        rsRef.current.selectedGoblin = g.id;
        rsRef.current.selectedBuilding = null;
        setSelGoblin(g.id);
        setSelBuilding(null);
        return;
      }
      const t = pickTile(h.world, camRef.current, W, H, p.x, p.y);
      const bid = t ? h.world.tiles[t.y][t.x].buildingId : null;
      if (bid !== null) selectBuilding(bid);
      else selectGoblin(null);
      return;
    }
    const t = pickTile(h.world, camRef.current, W, H, p.x, p.y);
    if (t) applyTool(t.x, t.y);
  };

  const onWheel = (e: React.WheelEvent) => {
    const cam = camRef.current;
    const p = localPoint(e);
    const canvas = canvasRef.current!;
    const W = canvas.clientWidth;
    const H = canvas.clientHeight;
    const before = { x: (p.x - W / 2) / cam.zoom + cam.x, y: (p.y - H / 2) / cam.zoom + cam.y };
    cam.zoom = Math.max(0.5, Math.min(3.5, cam.zoom * Math.exp(-e.deltaY * 0.0015)));
    cam.x = before.x - (p.x - W / 2) / cam.zoom;
    cam.y = before.y - (p.y - H / 2) / cam.zoom;
  };

  // keyboard
  useEffect(() => {
    const keys = new Set<string>();
    const down = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        setSpeed(speedRef.current === 0 ? 1 : 0);
      } else if (e.key === '1') setSpeed(1);
      else if (e.key === '2') setSpeed(3);
      else if (e.key === '3') setSpeed(8);
      else if (e.key === 'Escape') {
        setTool('inspect');
        selectGoblin(null);
      } else keys.add(e.key.toLowerCase());
    };
    const up = (e: KeyboardEvent) => keys.delete(e.key.toLowerCase());
    const pan = window.setInterval(() => {
      const cam = camRef.current;
      const s = 12 / cam.zoom;
      if (keys.has('w') || keys.has('arrowup')) cam.y -= s;
      if (keys.has('s') || keys.has('arrowdown')) cam.y += s;
      if (keys.has('a') || keys.has('arrowleft')) cam.x -= s;
      if (keys.has('d') || keys.has('arrowright')) cam.x += s;
    }, 16);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.clearInterval(pan);
    };
  }, [selectGoblin, setSpeed, setTool]);

  const onNew = () => {
    if (!window.confirm('Leave this hollow and found a brand new one? Your current hollow will be lost.')) return;
    clearSave();
    hollowRef.current = newHollow();
    centreCamera(hollowRef.current, camRef.current);
    selectGoblin(null);
    saveWorld(hollowRef.current.world);
  };

  const cursor = tool === 'inspect' ? 'cursor-grab active:cursor-grabbing' : 'cursor-crosshair';

  return (
    <div className="relative h-dvh w-screen select-none overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 h-full w-full touch-none ${cursor}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => (rsRef.current.hover = null)}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {snap && (
        <div className="pointer-events-none absolute inset-0 flex flex-col p-3" style={{ paddingTop: 'max(0.75rem, var(--safe-area-inset-top))' }}>
          <TopBar snap={snap} speed={speed} setSpeed={setSpeed} onNew={onNew} />
          <div className="mt-3 flex min-h-0 flex-1 items-start justify-between gap-3">
            <div className="hidden self-end md:block">
              <LogFeed snap={snap} onSelectGoblin={selectGoblin} />
            </div>
            <div className="max-h-[calc(100%-6rem)] min-h-0">
              <SidePanel
                snap={snap}
                onSelectGoblin={selectGoblin}
                onClose={() => {
                  selectGoblin(null);
                  selectBuilding(null);
                }}
                follow={follow}
                setFollow={setFollow}
              />
            </div>
          </div>
          <div className="mt-3 flex justify-center" style={{ paddingBottom: 'var(--safe-area-inset-bottom)' }}>
            <BuildBar tool={tool} setTool={setTool} />
          </div>
          {toast && (
            <div className="absolute left-1/2 top-24 -translate-x-1/2 rounded-lg bg-black/75 px-3 py-1.5 text-sm text-orange-100">{toast}</div>
          )}
        </div>
      )}
    </div>
  );
}
