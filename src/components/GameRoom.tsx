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
  Zap,
  Compass,
  Pause,
  Clock,
  Play,
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

  // Timer State
  const [timeRemaining, setTimeRemaining] = useState(90);
  const [maxTime, setMaxTime] = useState(90);
  const [timerActive, setTimerActive] = useState(false);
  const [timerStatus, setTimerStatus] = useState<"idle" | "running" | "ended">("idle");
  const [presenceSynced, setPresenceSynced] = useState(false);

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

  // Host detection logic
  const getHostName = () => {
    if (activeUsers.length === 0) return null;
    const eliasPresent = activeUsers.some((u) => u.name.toLowerCase() === "elias");
    if (eliasPresent) return "elias";
    const sorted = [...activeUsers].sort((a, b) => a.name.localeCompare(b.name));
    return sorted[0]?.name || null;
  };

  const isHost = isMaster || (presenceSynced && getHostName() === userName && !activeUsers.some((u) => u.name.toLowerCase() === "elias"));

  // Refs to prevent stale state in subscription callbacks
  const activeDrawerRef = useRef<string | null>(null);
  const scoresRef = useRef<Record<string, number>>({});
  
  useEffect(() => {
    activeDrawerRef.current = activeDrawer;
  }, [activeDrawer]);

  useEffect(() => {
    scoresRef.current = scores;
  }, [scores]);

  const stateRef = useRef<{
    activeDrawer: string | null;
    scores: Record<string, number>;
    timeRemaining: number;
    timerActive: boolean;
    timerStatus: "idle" | "running" | "ended";
    maxTime: number;
    isHost: boolean;
  }>({
    activeDrawer,
    scores,
    timeRemaining,
    timerActive,
    timerStatus,
    maxTime,
    isHost,
  });

  useEffect(() => {
    stateRef.current = {
      activeDrawer,
      scores,
      timeRemaining,
      timerActive,
      timerStatus,
      maxTime,
      isHost,
    };
  }, [activeDrawer, scores, timeRemaining, timerActive, timerStatus, maxTime, isHost]);

  // Can the current user draw on the canvas?
  const canDraw = !activeDrawer || activeDrawer === userName;

  // Auto-load identity from sessionStorage on mount (resets each browser session)
  useEffect(() => {
    const savedColor = sessionStorage.getItem("quebra_gelo_color") || BRUSH_COLORS[Math.floor(Math.random() * BRUSH_COLORS.length)];

    setUserColor(savedColor);
    setColor(savedColor);
    // Name is NOT pre-loaded — user must type it every session
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
      if (payload.payload.timeRemaining !== undefined) setTimeRemaining(payload.payload.timeRemaining);
      if (payload.payload.timerActive !== undefined) setTimerActive(payload.payload.timerActive);
      if (payload.payload.timerStatus !== undefined) setTimerStatus(payload.payload.timerStatus);
      if (payload.payload.maxTime !== undefined) setMaxTime(payload.payload.maxTime);
    });

    // Listen to Request State (from new users)
    channel.on("broadcast", { event: "request-state" }, () => {
      if (stateRef.current.isHost) {
        channel.send({
          type: "broadcast",
          event: "state-update",
          payload: {
            activeDrawer: stateRef.current.activeDrawer,
            scores: stateRef.current.scores,
            timeRemaining: stateRef.current.timeRemaining,
            timerActive: stateRef.current.timerActive,
            timerStatus: stateRef.current.timerStatus,
            maxTime: stateRef.current.maxTime,
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
      setPresenceSynced(true);
    });

    channel.subscribe(async (status, err) => {
      console.log(`[Supabase Realtime] Status: ${status}`, err || "");
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
              activeDrawer: stateRef.current.activeDrawer,
              scores: stateRef.current.scores,
              timeRemaining: stateRef.current.timeRemaining,
              timerActive: stateRef.current.timerActive,
              timerStatus: stateRef.current.timerStatus,
              maxTime: stateRef.current.maxTime,
            },
          });
        }
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [isJoined, userName, userColor, isMaster, roomId]);

  // Host Timer Tick Loop
  useEffect(() => {
    if (!isJoined) return;

    const interval = setInterval(() => {
      const current = stateRef.current;
      if (!current.isHost || !current.timerActive) return;

      const newTime = Math.max(0, current.timeRemaining - 1);
      let newStatus = current.timerStatus;
      let newActive: boolean = current.timerActive;

      if (newTime === 0) {
        newStatus = "ended";
        newActive = false;
      }

      setTimeRemaining(newTime);
      setTimerStatus(newStatus);
      setTimerActive(newActive);

      channelRef.current?.send({
        type: "broadcast",
        event: "state-update",
        payload: {
          activeDrawer: current.activeDrawer,
          scores: current.scores,
          timeRemaining: newTime,
          timerActive: newActive,
          timerStatus: newStatus,
          maxTime: current.maxTime,
        },
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isJoined]);

  // Join handler for identity form inside this room
  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;

    // Use sessionStorage so the name is asked again on each new browser session
    sessionStorage.setItem("quebra_gelo_color", userColor);

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

    // Auto-trigger timer if drawer is assigned
    const nextTime = maxTime;
    const nextActive = name !== null;
    const nextStatus = name !== null ? ("running" as const) : ("idle" as const);

    setTimeRemaining(nextTime);
    setTimerActive(nextActive);
    setTimerStatus(nextStatus);

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: name,
        scores: scoresRef.current,
        timeRemaining: nextTime,
        timerActive: nextActive,
        timerStatus: nextStatus,
        maxTime,
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

    // Stop timer
    setTimerActive(false);
    setTimerStatus("idle");

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: activeDrawerRef.current,
        scores: newScores,
        timeRemaining,
        timerActive: false,
        timerStatus: "idle",
        maxTime,
      },
    });
  };

  const resetGame = () => {
    if (!isMaster) return;
    if (!window.confirm("Deseja realmente resetar todas as pontuações e o desenhista?")) return;

    setScores({});
    setActiveDrawer(null);
    handleClear();

    // Reset timer
    setTimeRemaining(90);
    setTimerActive(false);
    setTimerStatus("idle");
    setMaxTime(90);

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: {
        activeDrawer: null,
        scores: {},
        timeRemaining: 90,
        timerActive: false,
        timerStatus: "idle",
        maxTime: 90,
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
    <main className="flex-1 flex flex-col bg-slate-900 text-slate-100 font-sans" style={{ minHeight: '100dvh' }}>
      {!isJoined ? (
        // ── IDENTITY FORM (When entering room directly via link) ─────────────────────────────────
        <div
          className="flex-1 flex flex-col items-center justify-center relative overflow-y-auto"
          style={{
            paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
            paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
            paddingLeft: '1.5rem',
            paddingRight: '1.5rem',
          }}
        >
          <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-pink-600/20 blur-[120px] pointer-events-none" />

          <div className="w-full max-w-md bg-slate-800/40 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 shadow-2xl relative my-auto">
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

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-500/25 active:scale-95 transition-all"
                >
                  <LogIn className="w-5 h-5" />
                  Entrar na Sala
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : (
        // ── CANVAS ROOM ────────────────────────────────
        <div className="flex-1 flex flex-col overflow-hidden" style={{ height: '100dvh' }}>
          {/* Header */}
          <header
            className="border-b border-slate-800 bg-slate-900/80 backdrop-blur px-4 flex flex-col shrink-0"
            style={{
              paddingTop: 'env(safe-area-inset-top)',
            }}
          >
            {/* Main row */}
            <div className="flex items-center justify-between gap-2" style={{ minHeight: '3.5rem' }}>
              {/* Left: user identity */}
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center shrink-0">
                  {isMaster ? (
                    <Crown className="w-4 h-4 text-white" />
                  ) : (
                    <Paintbrush className="w-4 h-4 text-white" />
                  )}
                </div>
                <div className="flex items-center gap-1.5 font-sans min-w-0">
                  <p className="text-sm font-semibold text-slate-300 truncate">
                    {userName}
                  </p>
                  {isMaster && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1 rounded font-bold uppercase tracking-wider shrink-0">
                      Mestre
                    </span>
                  )}
                </div>
              </div>

              {/* Right: celebrate (always visible) */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleCelebrate}
                  className="h-9 px-3 rounded-lg bg-violet-600/20 hover:bg-violet-600/30 text-violet-400 text-xs font-bold flex items-center gap-1.5 transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Celebrar</span>
                </button>
              </div>
            </div>

            {/* Master-only second row: turn control + timer controls + reset */}
            {isMaster && (
              <div className="flex flex-wrap items-center gap-2 pb-2">
                <div className="flex-1 flex items-center gap-1.5 bg-slate-800/60 border border-slate-700 rounded-lg px-2 h-9 min-w-[120px]">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider shrink-0">
                    Turno:
                  </span>
                  <select
                    value={activeDrawer || ""}
                    onChange={(e) => setDrawer(e.target.value || null)}
                    className="bg-transparent text-xs text-slate-200 outline-none font-semibold cursor-pointer py-1 min-w-0 flex-1"
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

                {/* Manual Timer Controls */}
                <div className="flex items-center gap-1.5 bg-slate-800/60 border border-slate-700 rounded-lg px-2 h-9">
                  <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider shrink-0">Timer:</span>
                  <button
                    type="button"
                    onClick={() => {
                      const nextActive = !timerActive;
                      const nextStatus = nextActive ? ("running" as const) : ("idle" as const);
                      setTimerActive(nextActive);
                      setTimerStatus(nextStatus);
                      channelRef.current?.send({
                        type: "broadcast",
                        event: "state-update",
                        payload: {
                          activeDrawer,
                          scores,
                          timeRemaining,
                          timerActive: nextActive,
                          timerStatus: nextStatus,
                          maxTime,
                        }
                      });
                    }}
                    className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                  >
                    {timerActive ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTimeRemaining(maxTime);
                      setTimerStatus("idle");
                      setTimerActive(false);
                      channelRef.current?.send({
                        type: "broadcast",
                        event: "state-update",
                        payload: {
                          activeDrawer,
                          scores,
                          timeRemaining: maxTime,
                          timerActive: false,
                          timerStatus: "idle",
                          maxTime,
                        }
                      });
                    }}
                    className="p-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 transition-colors"
                    title="Resetar tempo"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMax = maxTime === 60 ? 90 : maxTime === 90 ? 120 : maxTime === 120 ? 45 : 60;
                      setMaxTime(nextMax);
                      setTimeRemaining(nextMax);
                      channelRef.current?.send({
                        type: "broadcast",
                        event: "state-update",
                        payload: {
                          activeDrawer,
                          scores,
                          timeRemaining: nextMax,
                          timerActive,
                          timerStatus,
                          maxTime: nextMax,
                        }
                      });
                    }}
                    className="px-1.5 py-0.5 rounded bg-slate-700 hover:bg-slate-650 text-[10px] font-bold text-slate-200 transition-colors"
                  >
                    {maxTime}s
                  </button>
                </div>

                <button
                  onClick={resetGame}
                  className="h-9 px-3 rounded-lg border border-rose-900/40 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 text-xs font-medium flex items-center gap-1 transition-colors shrink-0"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>
              </div>
            )}
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
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 flex items-center gap-2 z-10 pointer-events-none">
              <div className="bg-slate-950/80 backdrop-blur-md border border-slate-800/80 text-slate-200 px-4 py-2 rounded-2xl shadow-lg flex items-center gap-2 text-xs font-semibold">
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

              {/* Timer badge */}
              {(timerActive || timerStatus === "ended" || activeDrawer !== null) && (
                <div className={`bg-slate-950/80 backdrop-blur-md border text-xs font-mono font-bold px-3 py-2 rounded-2xl shadow-lg flex items-center gap-1.5 transition-all
                  ${timerStatus === "ended" ? "border-rose-500/80 text-rose-400 animate-pulse font-extrabold" : timeRemaining <= 15 ? "border-amber-500/80 text-amber-400 animate-pulse" : "border-slate-800/80 text-slate-200"}`}
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{timerStatus === "ended" ? "TEMPO ESGOTADO!" : `${timeRemaining}s`}</span>
                </div>
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
          <div
            className="border-t border-slate-800 bg-slate-950/80 backdrop-blur-xl shrink-0 flex flex-col gap-3"
            style={{
              padding: '1rem',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}
          >
            {/* Brush size slider — full width row */}
            <div className="flex items-center gap-3 bg-slate-900/60 border border-slate-800 rounded-xl px-4 h-11">
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

            {/* Tools + Color palette row */}
            <div className="flex items-center gap-2">
              {/* Palette / Eraser toggle */}
              <button
                onClick={() => setIsEraser(false)}
                disabled={!canDraw}
                className={`p-2.5 rounded-xl border transition-all shrink-0 ${
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
                className={`p-2.5 rounded-xl border transition-all shrink-0 ${
                  isEraser && canDraw
                    ? "bg-violet-600/20 border-violet-500 text-violet-400 shadow-md"
                    : "bg-slate-800/40 border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-30"
                }`}
              >
                <Eraser className="w-5 h-5" />
              </button>

              {/* Color palette (hidden when eraser active) */}
              {!isEraser && (
                <div className="flex-1 flex items-center justify-between gap-1 overflow-x-auto scrollbar-none">
                  {BRUSH_COLORS.map((c, i) => (
                    <button
                      key={`${c}-${i}`}
                      disabled={!canDraw}
                      onClick={() => setColor(c)}
                      className={`h-9 w-9 rounded-xl flex-shrink-0 transition-all ${
                        color === c && canDraw ? "ring-2 ring-white scale-110" : "opacity-80 hover:opacity-100 disabled:opacity-30"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              )}

              {/* Trash/Clear */}
              <button
                onClick={handleClear}
                disabled={!canDraw}
                className="p-2.5 bg-rose-950/20 hover:bg-rose-900/30 border border-rose-900/40 text-rose-400 hover:text-rose-350 rounded-xl transition-colors shrink-0 disabled:opacity-30"
              >
                <Trash2 className="w-5 h-5" />
              </button>
            </div>
          </div>

        </div>
      )}
    </main>
  );
}
