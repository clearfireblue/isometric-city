# AGENTS.md

## Commands
- `npm run dev` - Start development server
- `npm run build` - Production build (also type-checks)
- `npm run typecheck` - TypeScript only
- `npm run lint` - Run ESLint
- No test framework configured; the sim is plain TS and can be driven headless with `npx tsx`

## Architecture
Goblin Hollow: Next.js 16 + React 19 cozy goblin community sim, drawn on HTML5 Canvas.
- `src/games/goblins/` - framework-free game code: `sim.ts` (Hollow engine: needs, moodlets, utility-AI, jobs), `worldgen.ts`, `pathfinding.ts`, `render.ts` (all art is drawn in code, no sprite sheets), `catalog.ts` (buildings & constants), `types.ts`
- `src/components/goblins/` - React UI: `GoblinGame.tsx` (canvas host, rAF loop, input), `Hud.tsx` (top bar, build bar, inspector, roster, log), `snapshot.ts` (plain data copied from the engine 4x/sec for React)
- `src/core/types/` - shared grid/entity types
- `src/components/ui/` - shadcn/Radix primitives

The engine is mutable and lives in a ref; React never reads it directly during render, only via `takeSnapshot`.

## Code Style
- TypeScript strict; `@/*` path alias
- React function components with `'use client'`
- Tailwind; panel styling via the `.panel` class in `globals.css`
- Keep simulation code free of React/DOM so it runs headless
