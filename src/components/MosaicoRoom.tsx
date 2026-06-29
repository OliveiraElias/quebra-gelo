"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Users, Crown, RotateCcw, Clock, Play, Heart, CheckCircle2, HelpCircle, Paintbrush, LogIn, Sparkles } from "lucide-react";
import confetti from "canvas-confetti";

// ── Types ──────────────────────────────────────────────────────────────────

type GridCell = { id: string; targetColor: number; painted: boolean; paintedBy: string | null };
type PresenceUser = { name: string; color: string; presence_ref: string };
type ErrorMode = "hp" | "unpaint_self" | "unpaint_any";
type GameState = {
  status: "lobby" | "playing" | "won" | "lost";
  grid: GridCell[];
  hp: number;
  time: number;
  assignment: Record<string, number>;
  shuffleInterval?: number;
  cols?: number;
  rows?: number;
  hostName?: string;
  errorMode?: ErrorMode;
};

// ── Constants ──────────────────────────────────────────────────────────────

const COLORS = [
  { hex: "#EF4444", bg: "rgba(239,68,68,0.18)", border: "rgba(239,68,68,0.4)", glow: "rgba(239,68,68,0.6)", name: "Vermelho" },
  { hex: "#3B82F6", bg: "rgba(59,130,246,0.18)", border: "rgba(59,130,246,0.4)", glow: "rgba(59,130,246,0.6)", name: "Azul" },
  { hex: "#22C55E", bg: "rgba(34,197,94,0.18)", border: "rgba(34,197,94,0.4)", glow: "rgba(34,197,94,0.6)", name: "Verde" },
  { hex: "#A855F7", bg: "rgba(168,85,247,0.18)", border: "rgba(168,85,247,0.4)", glow: "rgba(168,85,247,0.6)", name: "Roxo" },
  { hex: "#F59E0B", bg: "rgba(245,158,11,0.18)", border: "rgba(245,158,11,0.4)", glow: "rgba(245,158,11,0.6)", name: "Laranja" },
  { hex: "#EC4899", bg: "rgba(236,72,153,0.18)", border: "rgba(236,72,153,0.4)", glow: "rgba(236,72,153,0.6)", name: "Rosa" },
  { hex: "#06B6D4", bg: "rgba(6,182,212,0.18)", border: "rgba(6,182,212,0.4)", glow: "rgba(6,182,212,0.6)", name: "Ciano" },
  { hex: "#EAB308", bg: "rgba(234,179,8,0.18)", border: "rgba(234,179,8,0.4)", glow: "rgba(234,179,8,0.6)", name: "Amarelo" },
  { hex: "#94A3B8", bg: "rgba(148,163,184,0.18)", border: "rgba(148,163,184,0.4)", glow: "rgba(148,163,184,0.6)", name: "Prata" },
  { hex: "#854D0E", bg: "rgba(133,77,14,0.18)", border: "rgba(133,77,14,0.4)", glow: "rgba(133,77,14,0.6)", name: "Marrom" },
  { hex: "#6366F1", bg: "rgba(99,102,241,0.18)", border: "rgba(99,102,241,0.4)", glow: "rgba(99,102,241,0.6)", name: "Índigo" },
  { hex: "#D946EF", bg: "rgba(217,70,239,0.18)", border: "rgba(217,70,239,0.4)", glow: "rgba(217,70,239,0.6)", name: "Fúcsia" },
  { hex: "#FFFFFF", bg: "rgba(255,255,255,0.15)", border: "rgba(255,255,255,0.4)", glow: "rgba(255,255,255,0.6)", name: "Branco" },
  { hex: "#1F2937", bg: "rgba(31,41,55,0.4)", border: "rgba(75,85,99,0.5)", glow: "rgba(156,163,175,0.3)", name: "Preto" },
  { hex: "#84CC16", bg: "rgba(132,204,22,0.18)", border: "rgba(132,204,22,0.4)", glow: "rgba(132,204,22,0.6)", name: "Lima" },
  { hex: "#FF8A65", bg: "rgba(255,138,101,0.18)", border: "rgba(255,138,101,0.4)", glow: "rgba(255,138,101,0.6)", name: "Pêssego" },
];

const PALETTE = ["#EF4444", "#3B82F6", "#22C55E", "#A855F7", "#F59E0B", "#EC4899", "#06B6D4", "#EAB308", "#94A3B8", "#854D0E", "#6366F1", "#D946EF", "#FFFFFF", "#1F2937", "#84CC16", "#FF8A65"];
const GRID_COLS = 8;
const GRID_ROWS = 12;
const MAX_HP = 100;
const HP_LOSS = 10;
const DURATION = 60;

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

function makeGrid(nColors: number, cols: number, rows: number): GridCell[] {
  const pool = shuffle(Array.from({ length: cols * rows }, (_, i) => i % nColors));
  return pool.map((t, i) => ({ id: `c${i}`, targetColor: t, painted: false, paintedBy: null }));
}

// Rearrange targetColor values only among unpainted cells
function shuffleUnpainted(currentGrid: GridCell[]): GridCell[] {
  const unpaintedIdx = currentGrid.reduce<number[]>((acc, c, i) => { if (!c.painted) acc.push(i); return acc; }, []);
  if (unpaintedIdx.length < 2) return currentGrid;
  const colors = shuffle(unpaintedIdx.map(i => currentGrid[i].targetColor));
  const next = [...currentGrid];
  unpaintedIdx.forEach((gridIdx, k) => { next[gridIdx] = { ...next[gridIdx], targetColor: colors[k] }; });
  return next;
}

// ── Component ──────────────────────────────────────────────────────────────

export default function MosaicoRoom({ roomId }: { roomId: string }) {
  const roomName = decodeURIComponent(roomId).split(/[-_]+/).map(w => w[0].toUpperCase() + w.slice(1)).join(" ");

  // Identity
  const [userName, setUserName] = useState("");
  const [userColor, setUserColor] = useState(PALETTE[0]);
  const [isJoined, setIsJoined] = useState(false);

  // Presence
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [presenceSynced, setPresenceSynced] = useState(false);

  // Game
  const [status, setStatus] = useState<GameState["status"]>("lobby");
  const [grid, setGrid] = useState<GridCell[]>([]);
  const [hp, setHp] = useState(MAX_HP);
  const [time, setTime] = useState(DURATION);
  const [assignment, setAssignment] = useState<Record<string, number>>({});
  const [shuffleInterval, setShuffleInterval] = useState(2);
  const [cols, setCols] = useState(GRID_COLS);
  const [rows, setRows] = useState(GRID_ROWS);
  const [hostName, setHostName] = useState<string | null>(null);
  const [errorMode, setErrorMode] = useState<ErrorMode>("hp");

  // Elias master config (pre-game adjustable)
  const [customDuration, setCustomDuration] = useState(DURATION);
  const [customMaxHp, setCustomMaxHp] = useState(MAX_HP);
  const [customShuffleInterval, setCustomShuffleInterval] = useState(2.5);
  const [customCols, setCustomCols] = useState(GRID_COLS);
  const [customRows, setCustomRows] = useState(GRID_ROWS);
  const [customErrorMode, setCustomErrorMode] = useState<ErrorMode>("hp");

  // Host detection
  const isElias = userName.trim().toLowerCase() === "elias";
  const getHost = () => {
    if (!activeUsers.length) return null;
    if (activeUsers.some(u => u.name.toLowerCase() === "elias")) return "elias";
    return [...activeUsers].sort((a, b) => a.name.localeCompare(b.name))[0]?.name ?? null;
  };
  const isHost = isElias || (status === "playing" && hostName ? hostName === userName : (presenceSynced && getHost() === userName && !activeUsers.some(u => u.name.toLowerCase() === "elias")));

  // Visual FX
  const [shakeCells, setShakeCells] = useState<Set<string>>(new Set());
  const [popCells, setPopCells] = useState<Set<string>>(new Set());

  const channelRef = useRef<any>(null);
  const stateRef = useRef({ status, grid, hp, time, assignment, activeUsers, shuffleInterval, cols, rows, isHost, hostName, errorMode });
  useEffect(() => { stateRef.current = { status, grid, hp, time, assignment, activeUsers, shuffleInterval, cols, rows, isHost, hostName, errorMode }; });

  // Derived
  const myIdx = assignment[userName] ?? -1;
  const myColor = myIdx >= 0 ? COLORS[myIdx] : null;
  const painted = grid.filter(c => c.painted).length;
  const total = grid.length;

  // Confetti
  const celebrate = () => {
    const end = Date.now() + 4000;
    (function f() { confetti({ particleCount: 4, angle: 60, spread: 55, origin: { x: 0 }, colors: COLORS.map(c => c.hex) }); confetti({ particleCount: 4, angle: 120, spread: 55, origin: { x: 1 }, colors: COLORS.map(c => c.hex) }); if (Date.now() < end) requestAnimationFrame(f); }());
  };

  // Broadcast state helper
  const broadcastState = (s: GameState) => { channelRef.current?.send({ type: "broadcast", event: "mosaico-state", payload: s }); };

  // Host loop — runs every 500ms, completely stable, reads state from ref to avoid restarts
  useEffect(() => {
    let tick = 0;
    const iv = setInterval(() => {
      const cur = stateRef.current;
      if (!isJoined || !cur.isHost || cur.status !== "playing") {
        tick = 0; // Reset tick when not active
        return;
      }

      // Decrement time every 2 ticks (1 second)
      let newTime = cur.time;
      if (tick % 2 === 0) {
        newTime = Math.max(0, cur.time - 1);
      }

      const allPainted = cur.grid.length > 0 && cur.grid.every(c => c.painted);
      let newStatus: GameState["status"] = cur.status;
      if (allPainted) { newStatus = "won"; celebrate(); channelRef.current?.send({ type: "broadcast", event: "celebrate", payload: {} }); }
      else if (newTime <= 0 || cur.hp <= 0) { newStatus = "lost"; }

      tick++;
      // Shuffle unpainted cell positions every N ticks (e.g. 0.5s = 1 tick, 1.0s = 2 ticks, 1.5s = 3 ticks, etc.)
      const ticksPerShuffle = cur.shuffleInterval !== undefined ? Math.round(cur.shuffleInterval * 2) : 4;
      const shouldShuffle = newStatus === "playing" && ticksPerShuffle > 0 && (tick % ticksPerShuffle === 0);
      const newGrid = shouldShuffle ? shuffleUnpainted(cur.grid) : cur.grid;

      if (tick % 2 === 0) {
        setTime(newTime);
      }
      setStatus(newStatus);
      setGrid(newGrid);
      broadcastState({
        status: newStatus,
        grid: newGrid,
        hp: cur.hp,
        time: newTime,
        assignment: cur.assignment,
        shuffleInterval: cur.shuffleInterval,
        cols: cur.cols,
        rows: cur.rows,
        hostName: cur.hostName || undefined,
        errorMode: cur.errorMode
      });
    }, 500);
    return () => clearInterval(iv);
  }, [isJoined]);

  // Channel setup
  useEffect(() => {
    if (!isJoined || !userName.trim()) { setPresenceSynced(false); return; }
    const ch = supabase.channel(`mosaico:${roomId}`, { config: { broadcast: { self: false }, presence: { key: userName } } });
    channelRef.current = ch;

    ch.on("broadcast", { event: "mosaico-state" }, ({ payload }: { payload: GameState }) => {
      setStatus(payload.status); setGrid(payload.grid); setHp(payload.hp); setTime(payload.time); setAssignment(payload.assignment);
      if (payload.shuffleInterval !== undefined) setShuffleInterval(payload.shuffleInterval);
      if (payload.cols !== undefined) setCols(payload.cols);
      if (payload.rows !== undefined) setRows(payload.rows);
      if (payload.hostName !== undefined) setHostName(payload.hostName ?? null);
      if (payload.errorMode !== undefined) setErrorMode(payload.errorMode);
    });

    ch.on("broadcast", { event: "request-mosaico" }, () => {
      if (!isHost) return;
      const cur = stateRef.current;
      broadcastState({ status: cur.status, grid: cur.grid, hp: cur.hp, time: cur.time, assignment: cur.assignment, shuffleInterval: cur.shuffleInterval, cols: cur.cols, rows: cur.rows, hostName: cur.hostName || undefined, errorMode: cur.errorMode });
    });

    ch.on("broadcast", { event: "cell-paint" }, ({ payload }: { payload: { cellId: string; by: string } }) => {
      if (!isHost) return;
      const cur = stateRef.current;
      const cell = cur.grid.find(c => c.id === payload.cellId);
      if (!cell || cell.painted) return;
      const pIdx = cur.assignment[payload.by] ?? -1;
      let newGrid = cur.grid;
      let newHp = cur.hp;
      if (pIdx >= 0 && pIdx === cell.targetColor) {
        newGrid = cur.grid.map(c => c.id === payload.cellId ? { ...c, painted: true, paintedBy: payload.by } : c);
      } else {
        if (cur.errorMode === "unpaint_self") {
          const paintedByMe = cur.grid.filter(c => c.painted && c.paintedBy === payload.by);
          if (paintedByMe.length > 0) {
            const targetToUnpaint = paintedByMe[Math.floor(Math.random() * paintedByMe.length)];
            newGrid = cur.grid.map(c => c.id === targetToUnpaint.id ? { ...c, painted: false, paintedBy: null } : c);
          }
        } else if (cur.errorMode === "unpaint_any") {
          const paintedAny = cur.grid.filter(c => c.painted);
          if (paintedAny.length > 0) {
            const targetToUnpaint = paintedAny[Math.floor(Math.random() * paintedAny.length)];
            newGrid = cur.grid.map(c => c.id === targetToUnpaint.id ? { ...c, painted: false, paintedBy: null } : c);
          }
        } else {
          newHp = Math.max(0, cur.hp - HP_LOSS);
        }
      }
      setGrid(newGrid); setHp(newHp);
      broadcastState({ status: cur.status, grid: newGrid, hp: newHp, time: cur.time, assignment: cur.assignment, shuffleInterval: cur.shuffleInterval, cols: cur.cols, rows: cur.rows, hostName: cur.hostName || undefined, errorMode: cur.errorMode });
    });

    ch.on("broadcast", { event: "celebrate" }, () => celebrate());

    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState();
      setActiveUsers(Object.keys(st).map(k => { const p = (st[k] as any)[0]; return { name: k, color: p?.color ?? "#000", presence_ref: p?.presence_ref ?? k }; }));
      setPresenceSynced(true);
    });

    ch.subscribe(async s => {
      if (s === "SUBSCRIBED") {
        await ch.track({ name: userName, color: userColor, online_at: new Date().toISOString() });
        ch.send({ type: "broadcast", event: "request-mosaico", payload: {} });
      }
    });

    return () => { ch.unsubscribe(); };
  }, [isJoined, userName, userColor, roomId]);

  // Actions
  const handleJoin = (e: React.FormEvent) => { e.preventDefault(); if (!userName.trim()) return; sessionStorage.setItem("quebra_gelo_color", userColor); setIsJoined(true); };

  const startGame = () => {
    if (!isHost) return;
    const sorted = [...activeUsers].sort((a, b) => a.name.localeCompare(b.name));
    const nColors = Math.min(sorted.length, COLORS.length);
    const asgn: Record<string, number> = {};
    sorted.forEach((u, i) => { asgn[u.name] = i % nColors; });
    const finalCols = isElias ? customCols : GRID_COLS;
    const finalRows = isElias ? customRows : GRID_ROWS;
    const newGrid = makeGrid(nColors, finalCols, finalRows);
    const initHp = isElias ? customMaxHp : MAX_HP;
    const initTime = isElias ? customDuration : DURATION;
    const initShuffle = isElias ? customShuffleInterval : 2;
    const initErrorMode = isElias ? customErrorMode : "hp";
    const s: GameState = {
      status: "playing",
      grid: newGrid,
      hp: initHp,
      time: initTime,
      assignment: asgn,
      shuffleInterval: initShuffle,
      cols: finalCols,
      rows: finalRows,
      hostName: userName,
      errorMode: initErrorMode
    };
    setStatus("playing"); setGrid(newGrid); setHp(initHp); setTime(initTime); setAssignment(asgn); setShuffleInterval(initShuffle); setCols(finalCols); setRows(finalRows); setHostName(userName); setErrorMode(initErrorMode);
    broadcastState(s);
  };

  const masterAddTime = () => {
    if (!isElias || status !== "playing") return;
    const newTime = time + 60;
    setTime(newTime);
    broadcastState({ status, grid, hp, time: newTime, assignment, shuffleInterval, cols, rows, hostName: hostName || undefined, errorMode });
  };

  const masterRestoreHp = () => {
    if (!isElias || status !== "playing") return;
    const newHp = Math.min(customMaxHp, hp + 30);
    setHp(newHp);
    broadcastState({ status, grid, hp: newHp, time, assignment, shuffleInterval, cols, rows, hostName: hostName || undefined, errorMode });
  };

  const masterResetHp = () => {
    if (!isElias || status !== "playing") return;
    setHp(customMaxHp);
    broadcastState({ status, grid, hp: customMaxHp, time, assignment, shuffleInterval, cols, rows, hostName: hostName || undefined, errorMode });
  };

  const resetGame = () => {
    if (!isHost) return;
    const s: GameState = { status: "lobby", grid: [], hp: MAX_HP, time: DURATION, assignment: {}, shuffleInterval: 2, cols: GRID_COLS, rows: GRID_ROWS, hostName: undefined, errorMode: undefined };
    setStatus("lobby"); setGrid([]); setHp(MAX_HP); setTime(DURATION); setAssignment({}); setShuffleInterval(2); setCols(GRID_COLS); setRows(GRID_ROWS); setHostName(null); setErrorMode("hp");
    broadcastState(s);
  };

  const touchCell = (cell: GridCell) => {
    if (status !== "playing" || cell.painted) return;
    const correct = myIdx >= 0 && myIdx === cell.targetColor;
    if (correct) {
      setPopCells(p => new Set([...p, cell.id]));
      setTimeout(() => setPopCells(p => { const n = new Set(p); n.delete(cell.id); return n; }), 300);
    } else {
      setShakeCells(p => new Set([...p, cell.id]));
      setTimeout(() => setShakeCells(p => { const n = new Set(p); n.delete(cell.id); return n; }), 400);
    }
    // Broadcast to host
    channelRef.current?.send({ type: "broadcast", event: "cell-paint", payload: { cellId: cell.id, by: userName } });
    // Host handles locally too
    if (isHost) {
      let newGrid = grid;
      let newHp = hp;
      if (correct) {
        newGrid = grid.map(c => c.id === cell.id ? { ...c, painted: true, paintedBy: userName } : c);
      } else {
        if (errorMode === "unpaint_self") {
          const paintedByMe = grid.filter(c => c.painted && c.paintedBy === userName);
          if (paintedByMe.length > 0) {
            const targetToUnpaint = paintedByMe[Math.floor(Math.random() * paintedByMe.length)];
            newGrid = grid.map(c => c.id === targetToUnpaint.id ? { ...c, painted: false, paintedBy: null } : c);
          }
        } else if (errorMode === "unpaint_any") {
          const paintedAny = grid.filter(c => c.painted);
          if (paintedAny.length > 0) {
            const targetToUnpaint = paintedAny[Math.floor(Math.random() * paintedAny.length)];
            newGrid = grid.map(c => c.id === targetToUnpaint.id ? { ...c, painted: false, paintedBy: null } : c);
          }
        } else {
          newHp = Math.max(0, hp - HP_LOSS);
        }
      }
      setGrid(newGrid);
      setHp(newHp);
      broadcastState({ status, grid: newGrid, hp: newHp, time, assignment, shuffleInterval, cols, rows, hostName: hostName || undefined, errorMode });
    }
  };

  // ── Login Screen ──────────────────────────────────────────────────────────

  if (!isJoined) {
    return (
      <main className="min-h-dvh bg-slate-950 flex flex-col items-center justify-center p-6 select-none">
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-[-15%] left-[-15%] w-[60%] h-[60%] rounded-full bg-violet-700/20 blur-[120px]" />
          <div className="absolute bottom-[-15%] right-[-15%] w-[60%] h-[60%] rounded-full bg-pink-700/20 blur-[120px]" />
        </div>
        <div className="relative z-10 w-full max-w-xs">
          <div className="text-center mb-8">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-violet-500/10 border border-violet-500/30 text-violet-400 text-xs font-bold uppercase tracking-widest mb-4">
              <Sparkles className="w-3 h-3" /> Mosaico Coletivo
            </div>
            <h1 className="text-3xl font-black text-white mb-2">{roomName}</h1>
            <p className="text-slate-400 text-sm">Pinte juntos. Vençam juntos.</p>
          </div>
          <form onSubmit={handleJoin} className="space-y-4">
            <input
              value={userName}
              onChange={e => setUserName(e.target.value)}
              placeholder="Seu nome"
              maxLength={20}
              className="w-full bg-slate-900 border border-slate-700 rounded-2xl px-4 py-3 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-violet-500 text-sm"
            />
            <div>
              <p className="text-xs text-slate-500 mb-2">Cor de perfil</p>
              <div className="flex gap-2 flex-wrap">
                {PALETTE.map(c => (
                  <button key={c} type="button" onClick={() => setUserColor(c)}
                    className="w-7 h-7 rounded-full border-2 transition-transform hover:scale-110"
                    style={{ backgroundColor: c, borderColor: userColor === c ? "#fff" : "transparent" }} />
                ))}
              </div>
            </div>
            <button type="submit" disabled={!userName.trim() || undefined as any}
              suppressHydrationWarning
              className="w-full py-3 rounded-2xl font-extrabold text-sm bg-gradient-to-r from-violet-600 to-pink-600 text-white disabled:opacity-40 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
              <LogIn className="w-4 h-4" /> Entrar na Sala
            </button>
          </form>
        </div>
      </main>
    );
  }

  // ── End screens ───────────────────────────────────────────────────────────

  if (status === "won" || status === "lost") {
    return (
      <main className="min-h-dvh bg-slate-950 flex flex-col items-center justify-center p-6 text-white select-none">
        <div className="text-center max-w-xs">
          {status === "won" ? (
            <>
              <div className="text-6xl mb-4">🎨</div>
              <h2 className="text-3xl font-black text-emerald-400 mb-2">Mosaico Completo!</h2>
              <p className="text-slate-400 text-sm mb-6">Vocês pintaram tudo juntos. Incrível!</p>
            </>
          ) : (
            <>
              <div className="text-6xl mb-4">{hp <= 0 ? "💔" : "⏰"}</div>
              <h2 className="text-3xl font-black text-rose-400 mb-2">{hp <= 0 ? "Vida Esgotada!" : "Tempo Esgotado!"}</h2>
              <p className="text-slate-400 text-sm mb-6">Só {painted}/{total} células pintadas. Tentem de novo!</p>
            </>
          )}
          {isHost && (
            <button onClick={resetGame} className="flex items-center gap-2 mx-auto px-6 py-3 rounded-2xl bg-slate-800 border border-slate-700 text-sm font-bold hover:bg-slate-700 transition-colors">
              <RotateCcw className="w-4 h-4" /> Jogar Novamente
            </button>
          )}
        </div>
      </main>
    );
  }

  // ── Game Screen ───────────────────────────────────────────────────────────

  const hpPct = Math.max(0, hp) / MAX_HP * 100;
  const timePct = time / DURATION * 100;
  const mins = Math.floor(time / 60);
  const secs = String(time % 60).padStart(2, "0");

  return (
    <main className="flex flex-col bg-slate-950 text-white select-none h-dvh overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800 bg-slate-900/60 backdrop-blur shrink-0"
        style={{ paddingTop: "max(0.75rem, env(safe-area-inset-top))" }}>
        <div>
          <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-wider font-bold mb-0.5">
            <Sparkles className="w-3 h-3 text-violet-400" /> Mosaico Coletivo
          </div>
          <h1 className="text-sm font-black text-white leading-none">{roomName}</h1>
        </div>
        <div className="flex items-center gap-2">
          {isHost && status !== "lobby" && (
            <button onClick={resetGame} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg border border-slate-700 text-slate-400 hover:bg-slate-800 transition-colors">
              <RotateCcw className="w-3 h-3" /> Reset
            </button>
          )}
          <div className="flex items-center gap-1 text-xs text-slate-400">
            <Users className="w-3.5 h-3.5" /> {activeUsers.length}
          </div>
        </div>
      </div>

      {/* ── Players bar ── */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800 overflow-x-auto shrink-0">
        {activeUsers.map((u, i) => {
          const ci = assignment[u.name] ?? -1;
          const gc = ci >= 0 ? COLORS[ci] : null;
          return (
            <div key={u.name + i} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-slate-800 bg-slate-900/60 text-xs text-slate-300 shrink-0">
              <div className="w-2.5 h-2.5 rounded-full border-2 border-white/20" style={{ backgroundColor: gc?.hex ?? u.color }} />
              <span className="font-bold">{u.name}</span>
              {gc && <span className="text-[9px] text-slate-500">{gc.name}</span>}
              {isHost && u.name === userName && <Crown className="w-2.5 h-2.5 text-amber-400 ml-0.5" />}
            </div>
          );
        })}
      </div>

      {/* ── Main content ── */}
      <div className="flex-1 w-full flex flex-col items-center justify-start p-4 overflow-hidden">

        {/* Lobby */}
        {status === "lobby" && (
          <div className="flex-1 w-full max-w-xs flex flex-col items-center justify-start gap-6 overflow-y-auto pb-24 scrollbar-none">
            <div className="p-6 rounded-3xl bg-slate-900/40 border border-slate-800 w-full">
              <HelpCircle className="w-10 h-10 text-slate-500 mx-auto mb-3 animate-pulse" />
              <h3 className="font-extrabold text-slate-200 mb-2">Como funciona</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Cada jogador recebe uma <strong className="text-slate-200">cor única</strong>. Você só pode pintar as células que têm a sua cor como alvo. O time vence quando todas as células forem pintadas corretamente!
              </p>
            </div>
            {myColor && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-2xl border w-full" style={{ borderColor: myColor.border, backgroundColor: myColor.bg }}>
                <div className="w-8 h-8 rounded-full" style={{ backgroundColor: myColor.hex }} />
                <div className="text-left">
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider">Sua cor</p>
                  <p className="font-extrabold text-white">{myColor.name}</p>
                </div>
              </div>
            )}
            {/* Elias master config — only visible in lobby to Elias */}
            {isElias && (
              <div className="w-full p-4 rounded-2xl border border-amber-500/30 bg-amber-500/5 space-y-4">
                <p className="text-xs font-extrabold text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
                  <Crown className="w-3 h-3" /> Controles do Master
                </p>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Duração</span>
                    <span className="font-bold text-white">{customDuration}s</span>
                  </div>
                  <input type="range" min={30} max={300} step={15} value={customDuration}
                    onChange={e => setCustomDuration(Number(e.target.value))}
                    className="w-full accent-amber-400" />
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                    <span>30s</span><span>5min</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Vida Máxima</span>
                    <span className="font-bold text-white">{customMaxHp} HP</span>
                  </div>
                  <input type="range" min={30} max={300} step={10} value={customMaxHp}
                    onChange={e => setCustomMaxHp(Number(e.target.value))}
                    className="w-full accent-amber-400" />
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                    <span>30 HP</span><span>300 HP</span>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                    <span>Mudar Blocos A Cada</span>
                    <span className="font-bold text-white">
                      {customShuffleInterval === 0 ? "Desativado" : `${customShuffleInterval}s`}
                    </span>
                  </div>
                  <input type="range" min={0} max={10} step={0.5} value={customShuffleInterval}
                    onChange={e => setCustomShuffleInterval(Number(e.target.value))}
                    className="w-full accent-amber-400" />
                  <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                    <span>Desativado (0)</span><span>10s</span>
                  </div>
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 mb-1.5">Regra de Erro</div>
                  <div className="grid grid-cols-3 gap-1 bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
                    <button
                      onClick={() => setCustomErrorMode("hp")}
                      className={`py-1.5 px-2 rounded-lg text-[9px] font-extrabold uppercase transition-all ${customErrorMode === "hp" ? "bg-amber-400 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"}`}
                    >
                      Vida HP
                    </button>
                    <button
                      onClick={() => setCustomErrorMode("unpaint_self")}
                      className={`py-1.5 px-2 rounded-lg text-[9px] font-extrabold uppercase transition-all ${customErrorMode === "unpaint_self" ? "bg-amber-400 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"}`}
                    >
                      Desmarcar Meu
                    </button>
                    <button
                      onClick={() => setCustomErrorMode("unpaint_any")}
                      className={`py-1.5 px-2 rounded-lg text-[9px] font-extrabold uppercase transition-all ${customErrorMode === "unpaint_any" ? "bg-amber-400 text-slate-950 shadow-md" : "text-slate-400 hover:text-white"}`}
                    >
                      Desmarcar Qualquer
                    </button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Colunas (Largura)</span>
                      <span className="font-bold text-white">{customCols}</span>
                    </div>
                    <input type="range" min={4} max={12} step={1} value={customCols}
                      onChange={e => setCustomCols(Number(e.target.value))}
                      className="w-full accent-amber-400" />
                    <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                      <span>4</span><span>12</span>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] text-slate-400 mb-1">
                      <span>Linhas (Altura)</span>
                      <span className="font-bold text-white">{customRows}</span>
                    </div>
                    <input type="range" min={4} max={20} step={1} value={customRows}
                      onChange={e => setCustomRows(Number(e.target.value))}
                      className="w-full accent-amber-400" />
                    <div className="flex justify-between text-[9px] text-slate-600 mt-0.5">
                      <span>4</span><span>20</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isHost ? (
              <button onClick={startGame} className="w-full py-3.5 rounded-2xl font-extrabold text-sm bg-gradient-to-r from-violet-600 to-pink-600 hover:opacity-90 transition-opacity flex items-center justify-center gap-2">
                <Play className="w-4 h-4" /> Iniciar Mosaico
              </button>
            ) : (
              <p className="text-xs text-slate-500 animate-pulse">Aguardando o host iniciar…</p>
            )}
          </div>
        )}

        {/* Playing grid */}
        {status === "playing" && (
          <div className="flex-1 w-full max-w-md flex flex-col items-center overflow-hidden pb-16">
            {/* My color badge */}
            {myColor && (
              <div className="w-full flex items-center gap-2 mb-2 px-3 py-2 rounded-xl border" style={{ borderColor: myColor.border, backgroundColor: myColor.bg }}>
                <Paintbrush className="w-4 h-4" style={{ color: myColor.hex }} />
                <span className="text-xs font-bold text-white">Você pinta em <span style={{ color: myColor.hex }}>{myColor.name}</span></span>
              </div>
            )}

            {/* Elias in-game master panel */}
            {isElias && (
              <div className="w-full flex gap-2 mb-2">
                <button onClick={masterAddTime}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-extrabold uppercase border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors">
                  <Clock className="w-3 h-3" /> +60s
                </button>
                <button onClick={masterRestoreHp}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-extrabold uppercase border border-emerald-500/40 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors">
                  <Heart className="w-3 h-3" /> +30 HP
                </button>
                <button onClick={masterResetHp}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-xl text-[10px] font-extrabold uppercase border border-rose-500/40 bg-rose-500/10 text-rose-400 hover:bg-rose-500/20 transition-colors">
                  <Heart className="w-3 h-3" /> Full HP
                </button>
              </div>
            )}

            {/* Scrollable grid container */}
            <div className="flex-1 w-full overflow-y-auto overflow-x-hidden border border-slate-800/60 rounded-2xl p-2.5 bg-slate-950/20 backdrop-blur-sm scrollbar-thin scrollbar-thumb-slate-850 scrollbar-track-transparent">
              <div
                className="grid gap-1.5 mx-auto w-full"
                style={{
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`
                }}
              >
                {grid.map(cell => {
                  const tc = COLORS[cell.targetColor];
                  const isPainted = cell.painted;
                  const isShaking = shakeCells.has(cell.id);
                  const isPopping = popCells.has(cell.id);

                  return (
                    <button
                      key={cell.id}
                      onClick={() => touchCell(cell)}
                      className={`aspect-square rounded-xl border-2 flex items-center justify-center transition-colors duration-150 touch-pan-y
                        ${isShaking ? "animate-shake" : ""}
                        ${isPopping ? "animate-cell-pop" : ""}
                        ${isPainted ? "cursor-default" : "hover:scale-105 active:scale-95"}
                      `}
                      style={{
                        backgroundColor: isPainted ? tc.hex + "cc" : tc.bg,
                        borderColor: isPainted ? tc.hex : tc.border,
                        boxShadow: isPainted ? `0 0 12px ${tc.glow}` : "none",
                      }}
                    >
                      {isPainted && <CheckCircle2 className="w-4 h-4 text-white/90" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Fixed footer ── */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t border-slate-800 bg-slate-900/90 backdrop-blur-xl px-4 py-3 shrink-0"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {/* HP bar or Error mode rule indicator */}
        {errorMode === "hp" ? (
          <div className="flex items-center gap-2 mb-2">
            <Heart className={`w-3.5 h-3.5 shrink-0 ${hpPct <= 30 ? "text-rose-400 animate-pulse" : "text-slate-400"}`} />
            <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${hpPct}%`,
                  background: hpPct > 60 ? "linear-gradient(90deg,#22c55e,#16a34a)" : hpPct > 30 ? "linear-gradient(90deg,#f59e0b,#d97706)" : "linear-gradient(90deg,#ef4444,#b91c1c)",
                }}
              />
            </div>
            <span className="text-[10px] text-slate-400 shrink-0">{hp} HP</span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 mb-2 text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2.5 py-1 rounded-lg border border-amber-500/20 w-fit">
            <Sparkles className="w-3 h-3 text-amber-400 animate-pulse" />
            <span>Erros desmarcam: <strong className="uppercase">{errorMode === "unpaint_self" ? "Seu acerto" : "Qualquer acerto"}</strong></span>
          </div>
        )}

        <div className="flex items-center justify-between">
          {/* Timer */}
          <div className={`flex items-center gap-1.5 font-mono font-bold text-lg ${time <= 20 ? "text-rose-400 animate-pulse" : time <= 45 ? "text-amber-400" : "text-slate-200"}`}>
            <Clock className="w-4 h-4" />
            {mins}:{secs}
          </div>

          {/* Progress */}
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400">
              <span className="font-bold text-white">{painted}</span>/{total} células
            </div>
            <div className="w-20 h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-violet-500 to-pink-500 rounded-full transition-all duration-300"
                style={{ width: total > 0 ? `${(painted / total) * 100}%` : "0%" }}
              />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
