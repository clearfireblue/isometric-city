'use client';

import React, { useState } from 'react';
import {
  Archive, Bed, Cherry, Crosshair, FastForward, Fence, Flame, Flower2, Footprints, House, Lamp,
  Moon, MousePointer2, Pause, Play, RotateCcw, Shovel, Soup, Sprout, Sun, Tent, Users, Wheat, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BuildCategory, Look, NeedKey, Tool } from '@/games/goblins/types';
import { BUILDINGS, CATEGORIES } from '@/games/goblins/catalog';
import { NEED_LABEL, moodLabel } from '@/games/goblins/sim';
import type { Snapshot } from './snapshot';

// ---------------------------------------------------------------------------
// small bits
// ---------------------------------------------------------------------------

const TOOL_ICON: Record<Tool, React.ComponentType<{ className?: string }>> = {
  inspect: MousePointer2,
  clear: Shovel,
  path: Footprints,
  burrow: House,
  hut: Tent,
  mushroom_patch: Sprout,
  berry_bush: Cherry,
  cookfire: Flame,
  larder: Archive,
  lantern: Lamp,
  flower_bed: Flower2,
  fence: Fence,
};

export function moodColor(mood: number): string {
  if (mood < 20) return 'hsl(6 65% 55%)';
  if (mood < 40) return 'hsl(28 70% 55%)';
  if (mood < 60) return 'hsl(45 70% 58%)';
  if (mood < 80) return 'hsl(95 45% 55%)';
  return 'hsl(150 50% 55%)';
}

export function GoblinFace({ look, size = 36 }: { look: Look; size?: number }) {
  const skin = `hsl(${look.skinHue} 42% ${look.skinLight}%)`;
  const skinDark = `hsl(${look.skinHue} 42% ${look.skinLight - 10}%)`;
  const hat = `hsl(${look.hatHue} 45% 40%)`;
  const ear = 9 * look.earSize;
  return (
    <svg width={size} height={size} viewBox="-20 -22 40 40" aria-hidden>
      <circle cx="0" cy="0" r="17" fill={`hsl(${look.tunicHue} 30% 22%)`} />
      <path d={`M-7,-1 L${-9 - ear},${-5 - ear * 0.4} L-6,4 Z`} fill={skinDark} />
      <path d={`M7,-1 L${9 + ear},${-5 - ear * 0.4} L6,4 Z`} fill={skinDark} />
      <circle cx="0" cy="1" r="9" fill={skin} />
      <rect x="-4.5" y="-1" width="3" height="3" fill="#fff6c8" />
      <rect x="1.5" y="-1" width="3" height="3" fill="#fff6c8" />
      <rect x="-3.5" y="0" width="1.5" height="2" fill="#1b1a14" />
      <rect x="2.5" y="0" width="1.5" height="2" fill="#1b1a14" />
      <ellipse cx="0" cy="3.5" rx="2.2" ry="1.6" fill={skinDark} />
      <path d="M-3,6.5 Q0,8.5 3,6.5" stroke="#2a1d14" strokeWidth="1" fill="none" />
      {look.hat === 'cap' && <path d="M-9,-2 A9,9 0 0 1 9,-2 Z" fill={hat} />}
      {look.hat === 'pointy' && <path d="M-9,-3 L9,-3 L-3,-20 Z" fill={hat} />}
      {look.hat === 'mushroom' && (
        <g>
          <path d="M-12,-3 A12,8 0 0 1 12,-3 Z" fill="hsl(4 65% 48%)" />
          <circle cx="-4" cy="-7" r="1.4" fill="#fff" />
          <circle cx="4" cy="-6" r="1.4" fill="#fff" />
        </g>
      )}
      {look.hat === 'leaf' && <ellipse cx="2" cy="-9" rx="7" ry="3" fill="hsl(110 45% 38%)" transform="rotate(-25 2 -9)" />}
    </svg>
  );
}

function Bar({ value, color, label }: { value: number; color: string; label: string }) {
  return (
    <div>
      <div className="mb-0.5 flex justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span>{Math.round(value)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/40">
        <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; value: React.ReactNode; warn?: boolean }) {
  return (
    <div className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 text-sm', warn ? 'bg-destructive/20 text-orange-200' : 'bg-black/20')} title={label}>
      <Icon className="h-4 w-4 opacity-80" />
      <span className="font-semibold tabular-nums">{value}</span>
      <span className="hidden text-xs text-muted-foreground lg:inline">{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------

export function TopBar({ snap, speed, setSpeed, onNew }: { snap: Snapshot; speed: number; setSpeed: (s: number) => void; onNew: () => void }) {
  const speeds = [
    { v: 0, icon: Pause, label: 'Pause (Space)' },
    { v: 1, icon: Play, label: 'Normal (1)' },
    { v: 3, icon: FastForward, label: 'Fast (2)' },
    { v: 8, icon: FastForward, label: 'Very fast (3)' },
  ];
  return (
    <div className="panel pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl px-3 py-2">
      <div className="mr-1">
        <div className="font-display text-lg font-semibold leading-none text-primary">{snap.name}</div>
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {snap.night ? <Moon className="h-3 w-3" /> : <Sun className="h-3 w-3" />}
          Day {snap.day} · {snap.clock}
        </div>
      </div>
      <div className="flex items-center gap-0.5 rounded-lg bg-black/25 p-0.5">
        {speeds.map((s, i) => (
          <button
            key={s.v}
            title={s.label}
            onClick={() => setSpeed(s.v)}
            className={cn('flex h-7 items-center rounded-md px-2 transition-colors', speed === s.v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-white/5 hover:text-foreground')}
          >
            <s.icon className="h-3.5 w-3.5" />
            {i === 3 && <FastForward className="-ml-1.5 h-3.5 w-3.5" />}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Stat icon={Users} label="Goblins" value={snap.goblins.length} />
        <Stat icon={Wheat} label="Food" value={`${snap.food}/${snap.foodCap}`} warn={snap.food < 4} />
        <Stat icon={Soup} label="Stew" value={snap.stew} />
        <Stat icon={Bed} label="Free beds" value={snap.beds} warn={snap.goblins.some((g) => g.homeless)} />
        <div className="flex items-center gap-1.5 rounded-md bg-black/20 px-2 py-1 text-sm" title="Average mood">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: moodColor(snap.mood) }} />
          <span className="font-semibold">{moodLabel(snap.mood)}</span>
        </div>
      </div>
      <button onClick={onNew} title="Start a new hollow" className="ml-auto flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-white/5 hover:text-foreground">
        <RotateCcw className="h-3.5 w-3.5" /> New hollow
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build bar
// ---------------------------------------------------------------------------

const CATEGORY_TOOLS: Record<BuildCategory, Tool[]> = {
  homes: ['burrow', 'hut'],
  food: ['mushroom_patch', 'berry_bush', 'cookfire', 'larder'],
  decor: ['path', 'lantern', 'flower_bed', 'fence'],
};

const TOOL_BLURB: Partial<Record<Tool, string>> = {
  inspect: 'Click goblins and buildings to see what they are up to. Drag to look around.',
  clear: 'Remove trees, rocks, paths or buildings. Drag to clear several.',
  path: 'Goblins walk faster on paths, and they look tidy. Drag to paint.',
};

const toolLabel = (t: Tool) => (t in BUILDINGS ? BUILDINGS[t as keyof typeof BUILDINGS].label : t === 'path' ? 'Dirt Path' : t === 'clear' ? 'Clear' : 'Inspect');
const toolBlurb = (t: Tool) => (t in BUILDINGS ? BUILDINGS[t as keyof typeof BUILDINGS].blurb : TOOL_BLURB[t]);

function ToolButton({ t, tool, setTool }: { t: Tool; tool: Tool; setTool: (t: Tool) => void }) {
  const Icon = TOOL_ICON[t];
  return (
    <button
      onClick={() => setTool(tool === t && t !== 'inspect' ? 'inspect' : t)}
      className={cn(
        'group relative flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-semibold leading-tight transition-colors',
        tool === t ? 'bg-primary text-primary-foreground' : 'text-foreground/80 hover:bg-white/5',
      )}
    >
      <Icon className="h-5 w-5" />
      <span className="text-center">{toolLabel(t)}</span>
      <span className="pointer-events-none absolute bottom-full left-1/2 mb-2 hidden w-52 -translate-x-1/2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-xs font-normal text-foreground shadow-lg group-hover:block">
        <b className="font-display">{toolLabel(t)}</b>
        <br />
        {toolBlurb(t)}
      </span>
    </button>
  );
}

export function BuildBar({ tool, setTool }: { tool: Tool; setTool: (t: Tool) => void }) {
  const [cat, setCat] = useState<BuildCategory>('homes');
  return (
    <div className="panel pointer-events-auto flex max-w-full items-stretch gap-2 overflow-x-auto rounded-xl p-1.5 md:overflow-visible">
      <div className="flex shrink-0 items-center gap-0.5 border-r border-border pr-2">
        <ToolButton t="inspect" tool={tool} setTool={setTool} />
        <ToolButton t="clear" tool={tool} setTool={setTool} />
      </div>
      <div className="flex flex-col gap-1">
        <div className="flex gap-1">
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              onClick={() => setCat(c.id)}
              className={cn('rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide', cat === c.id ? 'bg-accent/40 text-foreground' : 'text-muted-foreground hover:text-foreground')}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="flex gap-0.5">
          {CATEGORY_TOOLS[cat].map((t) => (
            <ToolButton key={t} t={t} tool={tool} setTool={setTool} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side panel: roster / goblin inspector / building inspector
// ---------------------------------------------------------------------------

const NEED_COLOR: Record<NeedKey, string> = {
  hunger: 'hsl(28 75% 58%)',
  rest: 'hsl(230 45% 65%)',
  social: 'hsl(330 50% 65%)',
  fun: 'hsl(95 45% 55%)',
};

export function SidePanel({
  snap, onSelectGoblin, onClose, follow, setFollow,
}: {
  snap: Snapshot;
  onSelectGoblin: (id: number) => void;
  onClose: () => void;
  follow: boolean;
  setFollow: (f: boolean) => void;
}) {
  const g = snap.goblin;
  const b = snap.building;
  if (g) {
    return (
      <div className="panel pointer-events-auto flex max-h-full w-72 flex-col overflow-hidden rounded-xl">
        <div className="flex items-start gap-3 border-b border-border p-3">
          <GoblinFace look={g.look} size={48} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-lg font-semibold leading-tight">{g.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs">
              <span className="h-2 w-2 rounded-full" style={{ background: moodColor(g.mood) }} />
              {moodLabel(g.mood)} · {Math.round(g.mood)}
            </div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
        <div className="scrollbar-thin space-y-3 overflow-y-auto p-3">
          <div className="rounded-lg bg-black/25 px-3 py-2 text-sm italic text-foreground/90">“{g.thought}”</div>
          <div className="space-y-1.5">
            {(Object.keys(NEED_LABEL) as NeedKey[]).map((k) => (
              <Bar key={k} label={NEED_LABEL[k]} value={g.needs[k]} color={NEED_COLOR[k]} />
            ))}
          </div>
          <div>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Feeling</div>
            {g.moodlets.length === 0 && <div className="text-xs text-muted-foreground">Nothing in particular.</div>}
            <ul className="space-y-0.5">
              {[...g.moodlets].sort((a, b2) => b2.value - a.value).map((m) => (
                <li key={m.id} className="flex justify-between gap-2 text-xs">
                  <span>{m.label}</span>
                  <span className={cn('tabular-nums font-semibold', m.value >= 0 ? 'text-lime-300' : 'text-orange-300')}>{m.value > 0 ? `+${m.value}` : m.value}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-0.5 text-xs text-muted-foreground">
            <div>Home: <span className="text-foreground">{g.homeLabel ?? 'none yet — build a burrow or hut'}</span></div>
            <div>Arrived: <span className="text-foreground">day {g.arrivedDay}</span></div>
          </div>
          <button
            onClick={() => setFollow(!follow)}
            className={cn('flex w-full items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-semibold', follow ? 'bg-primary text-primary-foreground' : 'bg-white/5 hover:bg-white/10')}
          >
            <Crosshair className="h-3.5 w-3.5" /> {follow ? 'Following' : 'Follow'}
          </button>
        </div>
      </div>
    );
  }
  if (b) {
    return (
      <div className="panel pointer-events-auto w-72 rounded-xl">
        <div className="flex items-start justify-between border-b border-border p-3">
          <div>
            <div className="font-display text-lg font-semibold">{b.name ?? b.label}</div>
            {b.name && <div className="text-xs text-muted-foreground">{b.label}</div>}
          </div>
          <button onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-white/5"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 p-3 text-sm">
          {b.built < 1 ? (
            <>
              <Bar label="Construction" value={b.built * 100} color="hsl(38 82% 60%)" />
              <div className="text-xs text-muted-foreground">{b.worker ? `${b.worker} is working on it.` : 'Waiting for a free pair of hands.'}</div>
            </>
          ) : (
            <>
              {(b.kind === 'mushroom_patch' || b.kind === 'berry_bush') && (
                <Bar label={b.growth >= 1 ? 'Ripe — ready to pick!' : 'Ripening'} value={b.growth * 100} color="hsl(95 45% 55%)" />
              )}
              {b.kind === 'cookfire' && <div>Stew in the pot: <b>{b.stew}</b> bowls</div>}
              {b.capacity && (
                <div>
                  <div className="text-xs text-muted-foreground">Residents ({b.residents.length}/{b.capacity})</div>
                  <ul className="mt-1 space-y-0.5">
                    {b.residents.map((r) => (
                      <li key={r.id}>
                        <button className="text-primary hover:underline" onClick={() => onSelectGoblin(r.id)}>{r.name}</button>
                      </li>
                    ))}
                    {b.residents.length === 0 && <li className="text-xs text-muted-foreground">Empty — someone will move in soon.</li>}
                  </ul>
                </div>
              )}
              {b.worker && <div className="text-xs text-muted-foreground">{b.worker} is busy here.</div>}
            </>
          )}
        </div>
      </div>
    );
  }
  return <Roster snap={snap} onSelectGoblin={onSelectGoblin} />;
}

function Roster({ snap, onSelectGoblin }: { snap: Snapshot; onSelectGoblin: (id: number) => void }) {
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  return (
    <div className="panel pointer-events-auto flex max-h-full w-64 flex-col overflow-hidden rounded-xl">
      <button onClick={() => setOpen(!open)} className="flex items-center justify-between border-b border-border px-3 py-2 text-left font-display font-semibold">
        <span>The Hollow-folk</span>
        <span className="flex items-center gap-1 font-sans text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" /> {snap.goblins.length} {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <ul className="scrollbar-thin overflow-y-auto p-1.5">
          {snap.goblins.map((r) => (
            <li key={r.id}>
              <button onClick={() => onSelectGoblin(r.id)} className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-white/5">
                <GoblinFace look={r.look} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm font-semibold">
                    <span className="truncate">{r.name}</span>
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: moodColor(r.mood) }} />
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{r.thought}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Log feed
// ---------------------------------------------------------------------------

export function LogFeed({ snap, onSelectGoblin }: { snap: Snapshot; onSelectGoblin: (id: number) => void }) {
  return (
    <div className="pointer-events-auto flex w-80 flex-col gap-1">
      {snap.log.map((l, i) => (
        <button
          key={l.id}
          style={{ opacity: 0.45 + (0.55 * (i + 1)) / snap.log.length }}
          onClick={() => l.goblinId !== undefined && onSelectGoblin(l.goblinId)}
          className={cn(
            'panel animate-log-in rounded-lg px-2.5 py-1.5 text-left text-xs leading-snug',
            l.tone === 'good' && 'border-l-2 border-l-lime-400/60',
            l.tone === 'bad' && 'border-l-2 border-l-orange-400/70',
          )}
        >
          {l.text}
        </button>
      ))}
    </div>
  );
}
