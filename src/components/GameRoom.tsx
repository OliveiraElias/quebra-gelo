"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Paintbrush,
  Users,
  Sparkles,
  Trash2,
  LogIn,
  Eraser,
  Palette,
  Trophy,
  Crown,
  RotateCcw,
  Home,
} from "lucide-react";
import confetti from "canvas-confetti";

type PresenceUser = {
  name: string;
  color: string;
  presence_ref: string;
};

const BRUSH_COLORS = [
  "#EF4444", // Red
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#8B5CF6", // Purple
  "#F59E0B", // Orange
  "#EC4899", // Pink
  "#14B8A6", // Teal/Emerald
  "#000000", // Black
];

type GameRoomProps = {
  roomId: string;
};



export default function GameRoom({ roomId }: GameRoomProps) {
  const router = useRouter();

  // Room metadata
  const cleanRoomId = decodeURIComponent(roomId);
  const roomName = cleanRoomId
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Authentication State
  const [userName, setUserName] = useState("");
  const [userColor, setUserColor] = useState(BRUSH_COLORS[0]);
  const [isJoined, setIsJoined] = useState(false);

  // Active Users State
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  // Room Game Rules State
  const [activeDrawer, setActiveDrawer] = useState<string | null>(null);
  const [scores, setScores] = useState<Record<string, number>>({});

  // Drawing Settings
  const [brushSize, setBrushSize] = useState(4);
  const [color, setColor] = useState(BRUSH_COLORS[0]);
  const [isEraser, setIsEraser] = useState(false);

  // Canvas Refs & State
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Supabase Channel Ref
  const channelRef = useRef<any>(null);

  // Determine if the current user is the master (Elias)
  const isMaster = userName.trim().toLowerCase() === "elias";

  // Refs to prevent stale state in subscription callbacks
  const activeDrawerRef = useRef<string | null>(null);
  const scoresRef = useRef<Record<string, number>>({});
  
  useEffect(() => {
    activeDrawerRef.current = activeDrawer;
  }, [activeDrawer]);

  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);

  // Can the current user draw on the canvas?
  const canDraw = !activeDrawer || activeDrawer === userName;

  // Auto-load identity from localStorage on mount
  useEffect(() => {
    const savedName = localStorage.getItem("quebra_gelo_name") || "";
    const savedColor = localStorage.getItem("quebra_gelo_color") || BRUSH_COLORS[Math.floor(Math.random() * BRUSH_COLORS.length)];

    setUserName(savedName);
    setUserColor(savedColor);
    setColor(savedColor);

    // If they already have a saved name, consider them joined immediately
    if (savedName.trim()) {
      setIsJoined(true);
    }
  }, []);



  // Initialize Canvas context
  useEffect(() => {
    if (!isJoined || !canvasRef.current) return;

    const canvas = canvasRef.current;
    
    const resizeCanvas = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const tempCanvas = document.createElement("canvas");
      tempCanvas.width = canvas.width;
      tempCanvas.height = canvas.height;
      const tempCtx = tempCanvas.getContext("2d");
      if (tempCtx) tempCtx.drawImage(canvas, 0, 0);

      canvas.width = parent.clientWidth * 2;
      canvas.height = parent.clientHeight * 2;
      canvas.style.width = `${parent.clientWidth}px`;
      canvas.style.height = `${parent.clientHeight}px`;

      const context = canvas.getContext("2d");
      if (context) {
        context.scale(2, 2);
        context.lineCap = "round";
        context.lineJoin = "round";
        contextRef.current = context;
        context.drawImage(tempCanvas, 0, 0, parent.clientWidth, parent.clientHeight);
      }
    };

    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);

    return () => {
      window.removeEventListener("resize", resizeCanvas);
    };
  }, [isJoined]);

  // Setup Supabase Realtime Channel
  useEffect(() => {
    if (!isJoined || !userName.trim()) return;

    const channel = supabase.channel(`quebra-gelo:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userName },
      },
    });

    channelRef.current = channel;

    // Listen to drawing Broadcasts
    channel.on("broadcast", { event: "draw" }, (payload) => {
      drawFromBroadcast(payload.payload);
    });

    channel.on("broadcast", { event: "clear" }, () => {
      clearLocalCanvas();
    });

    channel.on("broadcast", { event: "celebrate" }, () => {
      triggerConfetti();
    });

    // Listen to Game State Broadcasts
    channel.on("broadcast", { event: "state-update" }, (payload) => {
      setActiveDrawer(payload.payload.activeDrawer);
      setScores(payload.payload.scores);
    });

    // Listen to Request State (from new users)
    channel.on("broadcast", { event: "request-state" }, () => {
      if (isMaster) {
        channel.send({
          type: "broadcast",
          event: "state-update",
          payload: {
            activeDrawer: activeDrawerRef.current,
            scores: scoresRef.current,
          },
        });
      }
    });

    // Presence Tracking
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      const users: PresenceUser[] = [];
      Object.keys(state).forEach((key) => {
        const pres = state[key] as any;
        if (pres && pres[0]) {
          users.push({
            name: key,
            color: pres[0].color || "#000000",
            presence_ref: pres[0].presence_ref,
          });
        }
      });
      setActiveUsers(users);
    });

    channel.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          name: userName,
          color: userColor,
          online_at: new Date().toISOString(),
        });

        // Request state from Master if joining as guest
        if (!isMaster) {
          channel.send({
            type: "broadcast",
            event: "request-state",
            payload: {},
          });
        } else {
          // Master broadcasts current state on connect/reconnect
          channel.send({
            type: "broadcast",
            event: "state-update",
            payload: {
              activeDrawer: activeDrawerRef.current,
              scores: scoresRef.current,
            },
          });
        }
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [isJoined, userName, userColor, isMaster, roomId]);

  // Join handler for identity form inside this room
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    localStorage.setItem("quebra_gelo_name", userName);
    localStorage.setItem("quebra_gelo_color", userColor);

    setIsJoined(true);
  };

  // Trigger local & remote confetti celebration
  const handleCelebrate = () => {
    triggerConfetti();
    channelRef.current?.send({
      type: "broadcast",
      event: "celebrate",
      payload: {},
    });
  };

  const triggerConfetti = () => {
    confetti({
      particleCount: 80,
      spread: 60,
      origin: { y: 0.8 },
      colors: BRUSH_COLORS,
    });
  };

  // Game Master actions
  const setDrawer = (name: string | null) => {
    if (!isMaster) return;
    setActiveDrawer(name);
    
    // Clear canvas when a new drawer is set to start fresh
    handleClear();

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: name,
        scores: scoresRef.current,
      },
    });
  };

  const awardPoint = (name: string) => {
    if (!isMaster) return;

    const newScores = {
      ...scores,
      [name]: (scores[name] || 0) + 1,
    };
    setScores(newScores);

    // Trigger local & remote confetti celebration automatically
    handleCelebrate();

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: activeDrawerRef.current,
        scores: newScores,
      },
    });
  };

  const resetGame = () => {
    if (!isMaster) return;
    if (!window.confirm("Deseja realmente resetar todas as pontuações e o desenhista?")) return;

    setScores({});
    setActiveDrawer(null);
    handleClear();

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: null,
        scores: {},
      },
    });
  };

  // Drawing Helper Functions
  const drawFromBroadcast = (data: any) => {
    if (!canvasRef.current || !contextRef.current) return;
    const canvas = canvasRef.current;
    const ctx = contextRef.current;

    const w = canvas.width / 2;
    const h = canvas.height / 2;

    const px = data.prevX * w;
    const py = data.prevY * h;
    const cx = data.x * w;
    const cy = data.y * h;

    ctx.beginPath();
    ctx.strokeStyle = data.color;
    ctx.lineWidth = data.size;
    ctx.moveTo(px, py);
    ctx.lineTo(cx, cy);
    ctx.stroke();
    ctx.closePath();
  };

  const startDrawing = (x: number, y: number) => {
    if (!canDraw) return;
    isDrawingRef.current = true;
    lastPosRef.current = { x, y };
  };

  const draw = (x: number, y: number) => {
    if (!canDraw || !isDrawingRef.current || !lastPosRef.current || !contextRef.current || !canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    const lastPos = lastPosRef.current;

    const drawColor = isEraser ? "#FFFFFF" : color;

    ctx.beginPath();
    ctx.strokeStyle = drawColor;
    ctx.lineWidth = brushSize;
    ctx.moveTo(lastPos.x, lastPos.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    ctx.closePath();

    const w = canvas.width / 2;
    const h = canvas.height / 2;

    channelRef.current?.send({
      type: "broadcast",
      event: "draw",
      payload: {
        prevX: lastPos.x / w,
        prevY: lastPos.y / h,
        x: x / w,
        y: y / h,
        color: drawColor,
        size: brushSize,
      },
    });

    lastPosRef.current = { x, y };
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
  };

  const getCanvasCoords = (e: any) => {
    if (!canvasRef.current) return { x: 0, y: 0 };
    const rect = canvasRef.current.getBoundingClientRect();
    
    if (e.touches && e.touches[0]) {
      return {
        x: e.touches[0].clientX - rect.left,
        y: e.touches[0].clientY - rect.top,
      };
    }
    
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);
    startDrawing(x, y);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    const { x, y } = getCanvasCoords(e);
    draw(x, y);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    const { x, y } = getCanvasCoords(e);
    startDrawing(x, y);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const { x, y } = getCanvasCoords(e);
    draw(x, y);
  };

  const handleClear = () => {
    clearLocalCanvas();
    channelRef.current?.send({
      type: "broadcast",
      event: "clear",
      payload: {},
    });
  };

  const clearLocalCanvas = () => {
    if (!canvasRef.current || !contextRef.current) return;
    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-900 text-slate-100 font-sans min-h-screen">
      {!isJoined ? (
        // ── IDENTITY FORM (When entering room directly via link) ─────────────────────────────────
        <div className="flex-1 flex flex-col items-center justify-center p-6 relative overflow-hidden">
          <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-pink-600/20 blur-[120px] pointer-events-none" />

          <div className="w-full max-w-md bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl relative">
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/30">
                <Paintbrush className="w-8 h-8 text-white animate-bounce" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                Entrar na Sala: {roomName}
              </h1>
              <p className="text-xs text-slate-400 mt-2">
                Identifique-se para começar a desenhar!
              </p>
            </div>

            <form onSubmit={handleJoin} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Seu Nome
                </label>
                <input
                  type="text"
                  required
                  placeholder="Ex: Elias"
                  value={userName}
                  onChange={(e) => setUserName(e.target.value)}
                  className="w-full h-12 px-4 rounded-xl bg-slate-950/50 border border-slate-700 focus:border-violet-500 text-slate-100 placeholder-slate-500 outline-none transition-all"
                />
                {userName.trim().toLowerCase() === "elias" && (
                  <p className="text-xs text-amber-400 flex items-center gap-1 font-semibold">
                    <Crown className="w-3.5 h-3.5" /> Você entrará como Mestre da sala.
                  </p>
                )}
              </div>

              {/* Color Chooser */}
              <div className="space-y-2">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400 block">
                  Escolha sua Cor
                </label>
                <div className="grid grid-cols-8 gap-2">
                  {BRUSH_COLORS.map((c, i) => (
                    <button
                      key={`${c}-${i}`}
                      type="button"
                      onClick={() => setUserColor(c)}
                      className={`h-8 rounded-lg relative transition-all ${
                        userColor === c ? "ring-2 ring-white scale-110" : "opacity-80 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full h-12 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 active:scale-95 transition-all"
              >
                <LogIn className="w-5 h-5" />
                Entrar na Sala
              </button>
            </form>
          </div>
        </div>
      ) : (
        // ── CANVAS ROOM ────────────────────────────────
        <div className="flex-1 flex flex-col h-screen overflow-hidden">
          {/* Header */}
          <header className="h-16 border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center relative">
                {isMaster ? (
                  <Crown className="w-4 h-4 text-white" />
                ) : (
                  <Paintbrush className="w-4 h-4 text-white" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-1.5 font-sans">
                  <h2 className="text-sm font-bold capitalize bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                    Sala: {roomName}
                  </h2>
                  {isMaster && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 rounded font-bold uppercase tracking-wider">
                      Mestre
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-slate-500">
                  Logado como {userName}
                </p>
              </div>
            </div>

            {/* Header controls (Turn control dropdown for Master) */}
            <div className="flex items-center gap-2">
              {isMaster && (
                <>
                  <div className="flex items-center gap-1.5 bg-slate-850 border border-slate-800 rounded-lg px-2 h-9">
                    <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">
                      Turno:
                    </span>
                    <select
                      value={activeDrawer || ""}
                      onChange={(e) => setDrawer(e.target.value || null)}
                      className="bg-transparent text-xs text-slate-200 outline-none font-semibold cursor-pointer py-1"
                    >
                      <option value="" className="bg-slate-900 text-slate-300">
                        🔓 Desenho Livre
                      </option>
                      {activeUsers.map((u) => (
                        <option
                          key={u.presence_ref}
                          value={u.name}
                          className="bg-slate-900 text-slate-300"
                        >
                          🖌️ {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={resetGame}
                    className="h-9 px-3 rounded-lg border border-rose-900/40 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 text-xs font-medium flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Reset
                  </button>
                </>
              )}
              <button
                onClick={handleCelebrate}
                className="h-9 px-3 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Celebrar
              </button>
              <button
                onClick={() => {
                  setIsJoined(false);
                }}
                className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
              >
                <Home className="w-3.5 h-3.5" />
                Sair
              </button>
            </div>
          </header>

          {/* Active Users & Scores Bar */}
          <div className="h-14 border-b border-slate-800/60 bg-slate-900/40 px-4 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
            <div className="flex items-center gap-1 shrink-0">
              <Users className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mr-2">Placar:</span>
            </div>
            
            <div className="flex items-center gap-2.5 flex-nowrap py-1">
              {activeUsers.map((user) => {
                const userScore = scores[user.name] || 0;
                const isUserDrawer = activeDrawer === user.name;
                const isUserMaster = user.name.toLowerCase() === "elias";
                
                return (
                  <div
                    key={user.presence_ref}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-2xl border transition-all shrink-0 text-xs ${
                      isUserDrawer
                        ? "bg-violet-500/20 border-violet-500/50 text-violet-300 ring-1 ring-violet-500/20"
                        : "bg-slate-800/60 border-slate-700 text-slate-300"
                    }`}
                  >
                    {/* User color dot */}
                    <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: user.color }} />
                    
                    {/* User Name & Status */}
                    <span className="font-bold flex items-center gap-1 max-w-[90px] truncate">
                      {user.name}
                      {isUserMaster && <Crown className="w-3 h-3 text-amber-400 shrink-0" />}
                      {isUserDrawer && <Paintbrush className="w-3 h-3 text-violet-400 animate-pulse shrink-0" />}
                    </span>

                    {/* User Score Pill */}
                    <span className="bg-slate-950/60 text-amber-400 font-mono font-extrabold px-1.5 py-0.5 rounded-lg text-[10px] min-w-[20px] text-center border border-slate-800">
                      {userScore} pts
                    </span>

                    {/* Master Controls (Trophy only) */}
                    {isMaster && (
                      <div className="flex items-center gap-1 border-l border-slate-700/60 pl-1.5 ml-0.5">
                        <button
                          onClick={() => awardPoint(user.name)}
                          className="p-1 rounded-lg bg-amber-500/20 hover:bg-amber-500 text-amber-400 hover:text-slate-950 transition-colors"
                          title="Dar +1 Ponto"
                        >
                          <Trophy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Canvas Wrapper */}
          <div className="flex-1 bg-white relative select-none touch-none overflow-hidden">
            
            {/* Status notification banner (Non-blurred, viewable canvas) */}
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-slate-950/80 backdrop-blur-md border border-slate-800/80 text-slate-200 px-4 py-2 rounded-2xl shadow-lg z-10 flex items-center gap-2 pointer-events-none text-xs font-semibold">
              {activeDrawer ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-violet-500"></span>
                  </span>
                  <span>🎨 <strong className="text-violet-400">{activeDrawer}</strong> está desenhando...</span>
                  {!canDraw && <span className="text-slate-500 text-[10px] ml-1">(Você está adivinhando)</span>}
                </>
              ) : (
                <span>🔓 Desenho Livre (Todos podem desenhar)</span>
              )}
            </div>

            <canvas
              ref={canvasRef}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={stopDrawing}
              className={`absolute inset-0 block ${canDraw ? "cursor-crosshair" : "cursor-not-allowed"}`}
            />
          </div>

          {/* Bottom Toolbar */}
          <div className="p-4 border-t border-slate-800 bg-slate-950/80 backdrop-blur-xl shrink-0 flex flex-col gap-3">
            {/* Color & Tool picker */}
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsEraser(false)}
                  disabled={!canDraw}
                  className={`p-2.5 rounded-xl border transition-all ${
                    !isEraser && canDraw
                      ? "bg-violet-600/20 border-violet-500 text-violet-400 shadow-md"
                      : "bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                  }`}
                >
                  <Palette className="w-5 h-5" />
                </button>
                <button
                  onClick={() => setIsEraser(true)}
                  disabled={!canDraw}
                  className={`p-2.5 rounded-xl border transition-all ${
                    isEraser && canDraw
                      ? "bg-violet-600/20 border-violet-500 text-violet-400 shadow-md"
                      : "bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                  }`}
                >
                  <Eraser className="w-5 h-5" />
                </button>
              </div>

              {/* Slider for brush size */}
              <div className="flex-1 flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 h-11">
                <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider shrink-0">
                  Espessura
                </span>
                <input
                  type="range"
                  min="2"
                  max="20"
                  disabled={!canDraw}
                  value={brushSize}
                  onChange={(e) => setBrushSize(Number(e.target.value))}
                  className="w-full accent-violet-500 h-1 bg-slate-800 rounded-lg cursor-pointer disabled:opacity-30"
                />
                <span className="text-xs font-mono text-slate-300 w-6 text-right shrink-0">
                  {brushSize}px
                </span>
              </div>

              {/* Trash/Clear */}
              <button
                onClick={handleClear}
                disabled={!canDraw}
                className="p-2.5 bg-rose-950/20 hover:bg-rose-900/30 border border-rose-900/40 text-rose-400 hover:text-rose-350 rounded-xl transition-colors shrink-0 disabled:opacity-30"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>

            {/* Bottom palette */}
            {!isEraser && (
              <div className="flex items-center justify-between gap-1 overflow-x-auto py-1 scrollbar-none">
                {BRUSH_COLORS.map((c, i) => (
                  <button
                    key={`${c}-${i}`}
                    disabled={!canDraw}
                    onClick={() => setColor(c)}
                    className={`h-9 w-9 rounded-xl relative flex-shrink-0 transition-all ${
                      color === c && canDraw ? "ring-2 ring-white scale-110" : "opacity-80 hover:opacity-100 disabled:opacity-30"
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
