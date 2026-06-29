"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Zap,
  Users,
  Sparkles,
  Crown,
  RotateCcw,
  Home,
  AlertTriangle,
  Clock,
  Play,
  CheckCircle2,
  HelpCircle,
  Paintbrush,
  ShieldAlert,
  Sliders,
  Move,
  Compass
} from "lucide-react";
import confetti from "canvas-confetti";

type PresenceUser = {
  name: string;
  color: string;
  presence_ref: string;
  lockedControlId: string | null; // which control this user is holding
  currentValX: number;
  currentValY?: number;
};

type GameControl = {
  id: string;
  name: string;
  type: "slider-h" | "slider-v" | "dial" | "xy-pad";
  description: string;
  icon: any;
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

const CONTROLS: GameControl[] = [
  { id: "plasma-x", name: "Filtro de Plasma (X)", type: "slider-h", description: "Ajuste a modulação horizontal", icon: Sliders },
  { id: "harmonic-y", name: "Foco Harmônico (Y)", type: "slider-v", description: "Estabilize a amplitude vertical", icon: Sliders },
  { id: "phase-dial", name: "Defletor de Fase", type: "dial", description: "Rotacione para sintonizar a fase da onda", icon: Compass },
  { id: "mag-pad", name: "Campo Magnético (X/Y)", type: "xy-pad", description: "Posicione o núcleo no centro de carga", icon: Move },
];

type TargetState = {
  "plasma-x": { min: number; max: number };
  "harmonic-y": { min: number; max: number };
  "phase-dial": { min: number; max: number };
  "mag-pad": { xMin: number; xMax: number; yMin: number; yMax: number };
};

const DEFAULT_TARGETS: TargetState = {
  "plasma-x": { min: 40, max: 60 },
  "harmonic-y": { min: 30, max: 50 },
  "phase-dial": { min: 160, max: 200 },
  "mag-pad": { xMin: 40, xMax: 60, yMin: 40, yMax: 60 },
};

type SincroniaRoomProps = {
  roomId: string;
};

export default function SincroniaRoom({ roomId }: SincroniaRoomProps) {
  const router = useRouter();

  const cleanRoomId = decodeURIComponent(roomId);
  const roomName = cleanRoomId
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Identity state (sessionStorage based)
  const [userName, setUserName] = useState("");
  const [userColor, setUserColor] = useState(BRUSH_COLORS[0]);
  const [isJoined, setIsJoined] = useState(false);

  // Active Users list
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);

  // Local state for dragging controls
  const [localControlValues, setLocalControlValues] = useState({
    "plasma-x": 50,
    "harmonic-y": 50,
    "phase-dial": 0, // angle in degrees 0-360
    "mag-pad-x": 50,
    "mag-pad-y": 50,
  });

  // Locked control by current player
  const [myLockedControl, setMyLockedControl] = useState<string | null>(null);

  // Target states (synced from host)
  const [targets, setTargets] = useState<TargetState>(DEFAULT_TARGETS);

  // Game flow states
  const [gameStatus, setGameStatus] = useState<"lobby" | "playing" | "won" | "lost">("lobby");
  const [globalSync, setGlobalSync] = useState(0); // 0 to 100%
  const [timeRemaining, setTimeRemaining] = useState(90);
  const [isStormActive, setIsStormActive] = useState(false);
  const [stormOffset, setStormOffset] = useState({ x: 0, y: 0 });

  // Refs for tracking active touches
  const dialContainerRef = useRef<HTMLDivElement>(null);
  const padContainerRef = useRef<HTMLDivElement>(null);
  const sliderHContainerRef = useRef<HTMLDivElement>(null);
  const sliderVContainerRef = useRef<HTMLDivElement>(null);

  // Supabase Channel
  const channelRef = useRef<any>(null);

  const isEliasMaster = userName.trim().toLowerCase() === "elias";

  // Host detection logic
  const getHostName = () => {
    if (activeUsers.length === 0) return null;
    const eliasPresent = activeUsers.some((u) => u.name.toLowerCase() === "elias");
    if (eliasPresent) return "elias";
    const sorted = [...activeUsers].sort((a, b) => a.presence_ref.localeCompare(b.presence_ref));
    return sorted[0]?.name || null;
  };

  const isHost = isEliasMaster || (getHostName() === userName && !activeUsers.some((u) => u.name.toLowerCase() === "elias"));

  // Ref to share fresh state with the interval loop
  const stateRef = useRef({
    gameStatus,
    globalSync,
    timeRemaining,
    targets,
    localControlValues,
    activeUsers,
    myLockedControl,
    isStormActive,
  });

  useEffect(() => {
    stateRef.current = {
      gameStatus,
      globalSync,
      timeRemaining,
      targets,
      localControlValues,
      activeUsers,
      myLockedControl,
      isStormActive,
    };
  }, [gameStatus, globalSync, timeRemaining, targets, localControlValues, activeUsers, myLockedControl, isStormActive]);

  // Load color on mount
  useEffect(() => {
    const savedColor = sessionStorage.getItem("quebra_gelo_color") || BRUSH_COLORS[Math.floor(Math.random() * BRUSH_COLORS.length)];
    setUserColor(savedColor);
  }, []);

  // Storm Jitter Effect loop
  useEffect(() => {
    if (!isStormActive) {
      setStormOffset({ x: 0, y: 0 });
      return;
    }

    const jitterInterval = setInterval(() => {
      setStormOffset({
        x: (Math.random() - 0.5) * 8,
        y: (Math.random() - 0.5) * 8,
      });
    }, 80);

    return () => clearInterval(jitterInterval);
  }, [isStormActive]);

  // Check if a specific control is currently aligned/synchronized
  const checkControlAligned = (controlId: string, values: typeof localControlValues, targetSet: TargetState) => {
    if (controlId === "plasma-x") {
      const val = values["plasma-x"];
      const tgt = targetSet["plasma-x"];
      return val >= tgt.min && val <= tgt.max;
    }
    if (controlId === "harmonic-y") {
      const val = values["harmonic-y"];
      const tgt = targetSet["harmonic-y"];
      return val >= tgt.min && val <= tgt.max;
    }
    if (controlId === "phase-dial") {
      const val = values["phase-dial"];
      const tgt = targetSet["phase-dial"];
      return val >= tgt.min && val <= tgt.max;
    }
    if (controlId === "mag-pad") {
      const xVal = values["mag-pad-x"];
      const yVal = values["mag-pad-y"];
      const tgt = targetSet["mag-pad"];
      return xVal >= tgt.xMin && xVal <= tgt.xMax && yVal >= tgt.yMin && yVal <= tgt.yMax;
    }
    return false;
  };

  // Host Game Logic Loop
  useEffect(() => {
    if (!isJoined || !isHost || gameStatus !== "playing") return;

    const generateNewTargets = (): TargetState => {
      return {
        "plasma-x": {
          min: Math.floor(Math.random() * 50) + 10, // range 10-60
          max: 0, // set below
        },
        "harmonic-y": {
          min: Math.floor(Math.random() * 50) + 10,
          max: 0,
        },
        "phase-dial": {
          min: Math.floor(Math.random() * 200) + 40, // range 40-240
          max: 0,
        },
        "mag-pad": {
          xMin: Math.floor(Math.random() * 50) + 15,
          xMax: 0,
          yMin: Math.floor(Math.random() * 50) + 15,
          yMax: 0,
        },
      };
    };

    // Helper to format ranges
    const formatTargets = (t: TargetState): TargetState => {
      t["plasma-x"].max = t["plasma-x"].min + 20; // 20% bracket
      t["harmonic-y"].max = t["harmonic-y"].min + 20;
      t["phase-dial"].max = t["phase-dial"].min + 45; // 45 deg bracket
      t["mag-pad"].xMax = t["mag-pad"].xMin + 20;
      t["mag-pad"].yMax = t["mag-pad"].yMin + 20;
      return t;
    };

    let targetTicks = 0;

    const interval = setInterval(() => {
      const current = stateRef.current;
      if (current.gameStatus !== "playing") return;

      // 1. Evaluate alignment of active controls
      // Active controls = controls locked by active users, or all if solo.
      const assignedControls = new Set(
        current.activeUsers
          .map((u) => u.lockedControlId)
          .filter((id): id is string => id !== null)
      );

      const controlsToEvaluate = assignedControls.size > 0 
        ? Array.from(assignedControls) 
        : ["plasma-x", "harmonic-y", "phase-dial", "mag-pad"];

      // Check if all designated controls are inside target brackets
      let allAligned = true;
      controlsToEvaluate.forEach((ctrlId) => {
        // Resolve values
        // For non-local users, fetch their current values from the activeUsers presence state
        let testValues = { ...current.localControlValues };
        
        current.activeUsers.forEach((u) => {
          if (u.name !== userName && u.lockedControlId === ctrlId) {
            if (ctrlId === "mag-pad") {
              testValues["mag-pad-x"] = u.currentValX;
              testValues["mag-pad-y"] = u.currentValY ?? 50;
            } else {
              // @ts-ignore
              testValues[ctrlId] = u.currentValX;
            }
          }
        });

        const aligned = checkControlAligned(ctrlId, testValues, current.targets);
        if (!aligned) {
          allAligned = false;
        }
      });

      // 2. Adjust Sync Progress
      let newSync = current.globalSync;
      if (allAligned) {
        newSync += current.isStormActive ? 2.5 : 4.5; // storm slows down charge progress
      } else {
        newSync -= 1.5; // slow decay if not synchronized
      }
      newSync = Math.max(0, Math.min(100, newSync));

      // 3. Tick countdown
      const newTime = current.timeRemaining - 1;

      // Check win/loss
      let newStatus: "lobby" | "playing" | "won" | "lost" = current.gameStatus;
      if (newSync >= 100) {
        newStatus = "won";
        triggerVictoryConfetti();
        channelRef.current?.send({
          type: "broadcast",
          event: "celebrate",
          payload: {},
        });
      } else if (newTime <= 0) {
        newStatus = "lost";
      }

      // 4. Shift targets periodically (every 14 seconds) or during storms
      targetTicks++;
      let nextTargets = current.targets;
      let nextStorm = current.isStormActive;

      if (targetTicks >= 14 && newStatus === "playing") {
        targetTicks = 0;
        nextTargets = formatTargets(generateNewTargets());
        // 20% chance of launching a solar storm
        nextStorm = Math.random() < 0.25;
      } else if (current.isStormActive && targetTicks % 5 === 0) {
        // Storm warning: targets shift faster!
        nextTargets = formatTargets(generateNewTargets());
      }

      // Clear storm after 8 seconds
      if (current.isStormActive && targetTicks >= 8) {
        nextStorm = false;
      }

      const updatedState = {
        status: newStatus,
        globalSync: Number(newSync.toFixed(1)),
        timeRemaining: newTime,
        targets: nextTargets,
        isStormActive: nextStorm,
      };

      setGlobalSync(updatedState.globalSync);
      setTimeRemaining(updatedState.timeRemaining);
      setTargets(updatedState.targets);
      setIsStormActive(updatedState.isStormActive);
      setGameStatus(updatedState.status);

      channelRef.current?.send({
        type: "broadcast",
        event: "sincronia-state",
        payload: updatedState,
      });

    }, 1000);

    return () => clearInterval(interval);
  }, [isJoined, isHost, gameStatus]);

  // Setup Supabase Realtime Channels
  useEffect(() => {
    if (!isJoined || !userName.trim()) return;

    const channel = supabase.channel(`sincronia:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userName },
      },
    });

    channelRef.current = channel;

    // Listen for state sync updates
    channel.on("broadcast", { event: "sincronia-state" }, (payload) => {
      const data = payload.payload;
      setGameStatus(data.status);
      setGlobalSync(data.globalSync);
      setTimeRemaining(data.timeRemaining);
      setTargets(data.targets);
      setIsStormActive(data.isStormActive);
    });

    // Request state on initial load
    channel.on("broadcast", { event: "request-sincronia" }, () => {
      if (isHost) {
        channel.send({
          type: "broadcast",
          event: "sincronia-state",
          payload: {
            status: stateRef.current.gameStatus,
            globalSync: stateRef.current.globalSync,
            timeRemaining: stateRef.current.timeRemaining,
            targets: stateRef.current.targets,
            isStormActive: stateRef.current.isStormActive,
          },
        });
      }
    });

    channel.on("broadcast", { event: "celebrate" }, () => {
      triggerVictoryConfetti();
    });

    // Presence Sync
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
            lockedControlId: pres[0].lockedControlId || null,
            currentValX: pres[0].currentValX || 50,
            currentValY: pres[0].currentValY,
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
          lockedControlId: myLockedControl,
          currentValX: 50,
          online_at: new Date().toISOString(),
        });

        // Query initial state
        channel.send({
          type: "broadcast",
          event: "request-sincronia",
          payload: {},
        });
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [isJoined, userName, userColor, roomId, isHost]);

  // Track values updates over Presence to show sliders moving in real time to others
  const updatePresenceValues = async (controlId: string | null, valX: number, valY?: number) => {
    if (!channelRef.current) return;
    await channelRef.current.track({
      name: userName,
      color: userColor,
      lockedControlId: controlId,
      currentValX: valX,
      currentValY: valY,
      online_at: new Date().toISOString(),
    });
  };

  // Lock onto a specific module
  const handleLockControl = async (controlId: string) => {
    if (gameStatus !== "playing") return;

    // Check if someone else already locked this control
    const isAlreadyLocked = activeUsers.some(
      (u) => u.name !== userName && u.lockedControlId === controlId
    );
    if (isAlreadyLocked) return; // cannot lock

    const nextLock = myLockedControl === controlId ? null : controlId;
    setMyLockedControl(nextLock);

    // Initial value to push
    let currentX = 50;
    let currentY: number | undefined = undefined;
    if (nextLock === "plasma-x") currentX = localControlValues["plasma-x"];
    else if (nextLock === "harmonic-y") currentX = localControlValues["harmonic-y"];
    else if (nextLock === "phase-dial") currentX = localControlValues["phase-dial"];
    else if (nextLock === "mag-pad") {
      currentX = localControlValues["mag-pad-x"];
      currentY = localControlValues["mag-pad-y"];
    }

    await updatePresenceValues(nextLock, currentX, currentY);
  };

  // ── TOUCH / MOUSE INTERACTIVE GESTURE HANDLERS ─────────────────────────

  // 1. Horizontal Slider H Drag
  const handleSliderHMove = (clientX: number) => {
    const container = sliderHContainerRef.current;
    if (!container || gameStatus !== "playing") return;
    // Check lock
    const isLockedByOther = activeUsers.some((u) => u.name !== userName && u.lockedControlId === "plasma-x");
    if (isLockedByOther) return;

    const rect = container.getBoundingClientRect();
    const xPercentage = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const rounded = Number(xPercentage.toFixed(1));

    setLocalControlValues((prev) => ({ ...prev, "plasma-x": rounded }));
    if (myLockedControl === "plasma-x") {
      updatePresenceValues("plasma-x", rounded);
    }
  };

  // 2. Vertical Slider V Drag
  const handleSliderVMove = (clientY: number) => {
    const container = sliderVContainerRef.current;
    if (!container || gameStatus !== "playing") return;
    const isLockedByOther = activeUsers.some((u) => u.name !== userName && u.lockedControlId === "harmonic-y");
    if (isLockedByOther) return;

    const rect = container.getBoundingClientRect();
    // Invert so 100% is top and 0% is bottom
    const yPercentage = Math.max(0, Math.min(100, (1 - (clientY - rect.top) / rect.height) * 100));
    const rounded = Number(yPercentage.toFixed(1));

    setLocalControlValues((prev) => ({ ...prev, "harmonic-y": rounded }));
    if (myLockedControl === "harmonic-y") {
      updatePresenceValues("harmonic-y", rounded);
    }
  };

  // 3. Dial rotation Drag
  const handleDialRotation = (clientX: number, clientY: number) => {
    const container = dialContainerRef.current;
    if (!container || gameStatus !== "playing") return;
    const isLockedByOther = activeUsers.some((u) => u.name !== userName && u.lockedControlId === "phase-dial");
    if (isLockedByOther) return;

    const rect = container.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    
    let angle = Math.atan2(dy, dx) * (180 / Math.PI); // -180 to 180 deg
    if (angle < 0) angle += 360; // scale 0-360 deg
    const rounded = Math.round(angle);

    setLocalControlValues((prev) => ({ ...prev, "phase-dial": rounded }));
    if (myLockedControl === "phase-dial") {
      updatePresenceValues("phase-dial", rounded);
    }
  };

  // 4. XY Pad Drag
  const handleXYPadMove = (clientX: number, clientY: number) => {
    const container = padContainerRef.current;
    if (!container || gameStatus !== "playing") return;
    const isLockedByOther = activeUsers.some((u) => u.name !== userName && u.lockedControlId === "mag-pad");
    if (isLockedByOther) return;

    const rect = container.getBoundingClientRect();
    const xVal = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    const yVal = Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100));
    
    const roundedX = Number(xVal.toFixed(1));
    const roundedY = Number(yVal.toFixed(1));

    setLocalControlValues((prev) => ({
      ...prev,
      "mag-pad-x": roundedX,
      "mag-pad-y": roundedY,
    }));

    if (myLockedControl === "mag-pad") {
      updatePresenceValues("mag-pad", roundedX, roundedY);
    }
  };

  // ── END OF GESTURE ACTIONS ─────────────────────────────────────────────

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim()) return;
    sessionStorage.setItem("quebra_gelo_color", userColor);
    setIsJoined(true);
  };

  const startGame = () => {
    if (!isHost) return;
    const initial = {
      status: "playing" as const,
      globalSync: 5,
      timeRemaining: 90,
      targets: DEFAULT_TARGETS,
      isStormActive: false,
    };
    setGlobalSync(initial.globalSync);
    setTimeRemaining(initial.timeRemaining);
    setTargets(initial.targets);
    setIsStormActive(initial.isStormActive);
    setGameStatus(initial.status);

    channelRef.current?.send({
      type: "broadcast",
      event: "sincronia-state",
      payload: initial,
    });
  };

  const resetGame = async () => {
    if (!isHost) return;
    const initial = {
      status: "lobby" as const,
      globalSync: 0,
      timeRemaining: 90,
      targets: DEFAULT_TARGETS,
      isStormActive: false,
    };
    setGlobalSync(initial.globalSync);
    setTimeRemaining(initial.timeRemaining);
    setTargets(initial.targets);
    setIsStormActive(initial.isStormActive);
    setGameStatus(initial.status);
    setMyLockedControl(null);
    await updatePresenceValues(null, 50);

    channelRef.current?.send({
      type: "broadcast",
      event: "sincronia-state",
      payload: initial,
    });
  };

  const triggerVictoryConfetti = () => {
    const duration = 4 * 1000;
    const end = Date.now() + duration;

    (function frame() {
      confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: BRUSH_COLORS,
      });
      confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: BRUSH_COLORS,
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  };

  // Helper coordinate generator for slider targets visual placement
  const getAlignedColor = (ctrlId: string) => {
    return checkControlAligned(ctrlId, localControlValues, targets)
      ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
      : "bg-indigo-950/20 border-indigo-500/30 text-indigo-400";
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-950 text-slate-100 font-sans select-none overflow-hidden" style={{ minHeight: "100dvh" }}>
      {!isJoined ? (
        // ── IDENTITY LOGIN ────────────────────────────────
        <div
          className="flex-1 flex flex-col items-center justify-center relative overflow-y-auto"
          style={{
            paddingTop: "max(1.5rem, env(safe-area-inset-top))",
            paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
            paddingLeft: "1.5rem",
            paddingRight: "1.5rem",
          }}
        >
          <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-violet-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-pink-600/20 blur-[120px] pointer-events-none" />

          <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative my-auto">
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center mb-4 shadow-lg shadow-violet-500/30">
                <Compass className="w-8 h-8 text-white animate-spin-slow" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                Sincronia Cósmica
              </h1>
              <p className="text-xs text-slate-400 mt-2">
                Deslize e segure os sintonizadores para alinhar as frequências em equipe!
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
                  className="w-full h-12 px-4 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-violet-500 text-slate-100 placeholder-slate-600 outline-none transition-all"
                />
                {isEliasMaster && (
                  <p className="text-xs text-amber-400 flex items-center gap-1 font-semibold">
                    <Crown className="w-3.5 h-3.5" /> Entrará como Mestre Elias.
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
                        userColor === c ? "ring-2 ring-white scale-110" : "opacity-75 hover:opacity-100"
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-violet-600 to-pink-600 hover:from-violet-500 hover:to-pink-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20 active:scale-95 transition-all"
                >
                  Entrar no Jogo
                </button>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => router.push("/")}
                    className="h-10 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl flex items-center justify-center gap-1.5 border border-slate-700/50 active:scale-95 transition-all text-xs"
                  >
                    <Paintbrush className="w-3.5 h-3.5 text-pink-400" />
                    Desenho
                  </button>
                  <button
                    type="button"
                    onClick={() => router.push("/circuito")}
                    className="h-10 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl flex items-center justify-center gap-1.5 border border-slate-700/50 active:scale-95 transition-all text-xs"
                  >
                    <Zap className="w-3.5 h-3.5 text-yellow-400" />
                    Reator
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : (
        // ── GAME INTERFACE ────────────────────────────────
        <div className="flex-1 flex flex-col overflow-hidden" style={{ height: "100dvh" }}>
          {/* Header */}
          <header
            className="border-b border-slate-800 bg-slate-900/40 backdrop-blur px-4 flex flex-col shrink-0"
            style={{
              paddingTop: "env(safe-area-inset-top)",
            }}
          >
            <div className="flex items-center justify-between gap-2" style={{ minHeight: "3.5rem" }}>
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-violet-500 to-pink-500 flex items-center justify-center shrink-0">
                  <Compass className="w-4 h-4 text-white" />
                </div>
                <div className="flex items-center gap-1.5 min-w-0">
                  <p className="text-sm font-semibold text-slate-200 truncate">
                    {userName}
                  </p>
                  {isEliasMaster && (
                    <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 rounded font-bold uppercase tracking-wider shrink-0">
                      Mestre
                    </span>
                  )}
                  {isHost && !isEliasMaster && (
                    <span className="text-[9px] bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 px-1.5 rounded font-bold uppercase tracking-wider shrink-0">
                      Host
                    </span>
                  )}
                </div>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex items-center gap-2">
                {gameStatus === "lobby" && isHost && (
                  <button
                    onClick={startGame}
                    className="h-9 px-4 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5 transition-all shadow-md shadow-emerald-600/10 active:scale-95"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Iniciar Sincronia
                  </button>
                )}
                {gameStatus !== "lobby" && isHost && (
                  <button
                    onClick={resetGame}
                    className="h-9 px-3 rounded-lg border border-rose-900/40 bg-rose-950/20 hover:bg-rose-900/30 text-rose-400 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    Resetar
                  </button>
                )}
                <button
                  onClick={() => router.push("/")}
                  className="h-9 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <Home className="w-3.5 h-3.5" />
                  Sair
                </button>
              </div>
            </div>
          </header>

          {/* Active users horizontal bar */}
          <div className="h-12 border-b border-slate-900 bg-slate-950 px-4 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
            <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mr-2 shrink-0">Frequência:</span>
            <div className="flex items-center gap-2 flex-nowrap py-1">
              {activeUsers.map((user, idx) => {
                const ctrlName = CONTROLS.find((c) => c.id === user.lockedControlId)?.name || "Lobby";
                return (
                  <div
                    key={`${user.presence_ref || user.name}-${idx}`}
                    className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-slate-800 bg-slate-900/60 text-xs text-slate-300 shrink-0"
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: user.color }} />
                    <span className="font-bold">{user.name}</span>
                    <span className="text-[10px] text-slate-500">({ctrlName})</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main workspace */}
          <div className="flex-1 flex flex-col p-4 overflow-y-auto gap-4 items-center justify-start">

            {/* Central synchrony core */}
            <div className="w-full max-w-lg bg-slate-900/30 border border-slate-800/80 rounded-2xl p-4 flex items-center justify-between shrink-0 relative overflow-hidden">
              {isStormActive && (
                <div className="absolute inset-0 bg-rose-950/20 border border-rose-500/30 rounded-2xl flex items-center justify-center animate-pulse pointer-events-none z-10">
                  <div className="flex items-center gap-2 text-rose-400 font-extrabold text-xs tracking-widest uppercase">
                    <ShieldAlert className="w-4 h-4 text-rose-400 animate-bounce" />
                    Tempestade Magnética!
                  </div>
                </div>
              )}

              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span className="text-xs font-mono font-bold text-slate-200">
                    Estabilidade: {timeRemaining}s
                  </span>
                </div>
                <h2 className="text-sm font-bold text-slate-300 mt-0.5">Sincronia Harmônica</h2>
              </div>

              {/* Sync Percentage bar */}
              <div className="flex items-center gap-3 shrink-0">
                <div className="flex flex-col items-end">
                  <span className="text-2xl font-black font-mono bg-gradient-to-r from-violet-400 to-pink-400 bg-clip-text text-transparent">
                    {globalSync}%
                  </span>
                  <span className="text-[9px] uppercase font-bold text-slate-500">Global</span>
                </div>
                <div className="w-20 h-4 bg-slate-950 rounded-full border border-slate-800 p-0.5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-violet-500 to-pink-500 transition-all duration-300"
                    style={{ width: `${globalSync}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Grid of Interactive Modules */}
            {gameStatus === "lobby" ? (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 bg-slate-900/20 border border-slate-800 rounded-3xl max-w-md w-full">
                <HelpCircle className="w-12 h-12 text-slate-500 mb-3 animate-pulse" />
                <h3 className="font-extrabold text-slate-200">Aguardando Sincronização</h3>
                <p className="text-xs text-slate-400 mt-2 max-w-xs leading-relaxed">
                  {isHost
                    ? "Para ligar os filtros de onda, clique em 'Iniciar Sincronia' no topo. Todos os participantes devem se trancar em um controle específico e ajustá-lo na faixa correta simultaneamente."
                    : "Aguardando o Host iniciar a calibragem dos defletores magnéticos."}
                </p>
              </div>
            ) : (
              // ── PLAYING TUNERS GRID ─────────────────────────
              <div 
                className="w-full max-w-lg grid grid-cols-1 md:grid-cols-2 gap-4 pb-8 transition-transform duration-75"
                style={{
                  transform: isStormActive ? `translate(${stormOffset.x}px, ${stormOffset.y}px)` : "none",
                }}
              >
                {/* 1. HORIZONTAL SLIDER CARD */}
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 relative transition-all ${
                    myLockedControl === "plasma-x" ? "ring-1 ring-violet-500/50 bg-slate-900/50" : "bg-slate-900/20"
                  } ${getAlignedColor("plasma-x")}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-200">Filtro Plasma-X</h3>
                      <span className="text-[9px] text-slate-500 block">Alvo: {targets["plasma-x"].min}% - {targets["plasma-x"].max}%</span>
                    </div>
                    <button
                      onClick={() => handleLockControl("plasma-x")}
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border transition-colors ${
                        myLockedControl === "plasma-x"
                          ? "bg-violet-600 text-white border-violet-500"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      {myLockedControl === "plasma-x" ? "LOCKED" : "LOCK"}
                    </button>
                  </div>

                  {/* Horizontal Slide track */}
                  <div
                    ref={sliderHContainerRef}
                    onMouseMove={(e) => {
                      if (e.buttons === 1) handleSliderHMove(e.clientX);
                    }}
                    onTouchMove={(e) => {
                      if (e.touches[0]) handleSliderHMove(e.touches[0].clientX);
                    }}
                    className="h-16 w-full bg-slate-950/80 rounded-xl relative border border-slate-900 cursor-pointer overflow-hidden flex items-center justify-center"
                  >
                    {/* Target highlight zone */}
                    <div
                      className="absolute top-0 bottom-0 bg-emerald-500/10 border-l border-r border-emerald-500/30"
                      style={{
                        left: `${targets["plasma-x"].min}%`,
                        right: `${100 - targets["plasma-x"].max}%`,
                      }}
                    />

                    {/* Current value marker block */}
                    <div
                      className="absolute top-0 bottom-0 w-1.5 bg-violet-500 shadow-md shadow-violet-500/50 transition-all duration-75"
                      style={{ left: `${localControlValues["plasma-x"]}%` }}
                    />
                    
                    {/* Helper text display overlay */}
                    <span className="text-[10px] font-mono font-bold text-slate-500 absolute pointer-events-none select-none">
                      {localControlValues["plasma-x"]}%
                    </span>
                  </div>
                </div>

                {/* 2. VERTICAL SLIDER CARD */}
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 relative transition-all ${
                    myLockedControl === "harmonic-y" ? "ring-1 ring-violet-500/50 bg-slate-900/50" : "bg-slate-900/20"
                  } ${getAlignedColor("harmonic-y")}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-200">Foco Harmônico-Y</h3>
                      <span className="text-[9px] text-slate-500 block">Alvo: {targets["harmonic-y"].min}% - {targets["harmonic-y"].max}%</span>
                    </div>
                    <button
                      onClick={() => handleLockControl("harmonic-y")}
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border transition-colors ${
                        myLockedControl === "harmonic-y"
                          ? "bg-violet-600 text-white border-violet-500"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      {myLockedControl === "harmonic-y" ? "LOCKED" : "LOCK"}
                    </button>
                  </div>

                  {/* Vertical Slide track */}
                  <div
                    ref={sliderVContainerRef}
                    onMouseMove={(e) => {
                      if (e.buttons === 1) handleSliderVMove(e.clientY);
                    }}
                    onTouchMove={(e) => {
                      if (e.touches[0]) handleSliderVMove(e.touches[0].clientY);
                    }}
                    className="h-32 w-full bg-slate-950/80 rounded-xl relative border border-slate-900 cursor-pointer overflow-hidden flex items-center justify-center"
                  >
                    {/* Target highlight zone */}
                    <div
                      className="absolute left-0 right-0 bg-emerald-500/10 border-t border-b border-emerald-500/30"
                      style={{
                        // Inverted vertical calculation
                        bottom: `${targets["harmonic-y"].min}%`,
                        top: `${100 - targets["harmonic-y"].max}%`,
                      }}
                    />

                    {/* Current value marker block */}
                    <div
                      className="absolute left-0 right-0 h-1.5 bg-violet-500 shadow-md shadow-violet-500/50 transition-all duration-75"
                      style={{ bottom: `${localControlValues["harmonic-y"]}%` }}
                    />

                    <span className="text-[10px] font-mono font-bold text-slate-500 absolute pointer-events-none select-none">
                      {localControlValues["harmonic-y"]}%
                    </span>
                  </div>
                </div>

                {/* 3. ROTARY DIAL CARD */}
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 relative transition-all ${
                    myLockedControl === "phase-dial" ? "ring-1 ring-violet-500/50 bg-slate-900/50" : "bg-slate-900/20"
                  } ${getAlignedColor("phase-dial")}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-200">Defletor de Fase (Graus)</h3>
                      <span className="text-[9px] text-slate-500 block">Alvo: {targets["phase-dial"].min}° - {targets["phase-dial"].max}°</span>
                    </div>
                    <button
                      onClick={() => handleLockControl("phase-dial")}
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border transition-colors ${
                        myLockedControl === "phase-dial"
                          ? "bg-violet-600 text-white border-violet-500"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      {myLockedControl === "phase-dial" ? "LOCKED" : "LOCK"}
                    </button>
                  </div>

                  {/* Circular Dial Body */}
                  <div className="flex items-center justify-center py-2">
                    <div
                      ref={dialContainerRef}
                      onMouseMove={(e) => {
                        if (e.buttons === 1) handleDialRotation(e.clientX, e.clientY);
                      }}
                      onTouchMove={(e) => {
                        if (e.touches[0]) handleDialRotation(e.touches[0].clientX, e.touches[0].clientY);
                      }}
                      className="w-28 h-28 rounded-full border border-slate-900 bg-slate-950 relative flex items-center justify-center cursor-pointer shadow-inner"
                    >
                      {/* Target Ring Sector (approximate viz using svg) */}
                      <svg className="absolute inset-0 w-full h-full pointer-events-none scale-90 -rotate-90">
                        <circle
                          cx="56"
                          cy="56"
                          r="48"
                          fill="none"
                          stroke="#10b981"
                          strokeOpacity="0.15"
                          strokeWidth="10"
                          strokeDasharray={`${(targets["phase-dial"].max - targets["phase-dial"].min) * 0.83} 300`}
                          strokeDashoffset={`-${targets["phase-dial"].min * 0.83}`}
                        />
                      </svg>

                      {/* Moving Dial Indicator Knob */}
                      <div
                        className="w-full h-full absolute inset-0 flex items-center justify-center transition-transform duration-75"
                        style={{ transform: `rotate(${localControlValues["phase-dial"]}deg)` }}
                      >
                        {/* Dot indicator */}
                        <div className="w-2.5 h-2.5 rounded-full bg-violet-500 absolute top-2 shadow-md shadow-violet-500/50" />
                        {/* Center core dial pin */}
                        <div className="w-4 h-4 rounded-full bg-slate-900 border border-slate-850" />
                      </div>

                      <span className="text-[10px] font-mono font-extrabold text-slate-500 z-10 pointer-events-none">
                        {localControlValues["phase-dial"]}°
                      </span>
                    </div>
                  </div>
                </div>

                {/* 4. XY PAD CARD */}
                <div
                  className={`p-4 rounded-2xl border flex flex-col gap-3 relative transition-all ${
                    myLockedControl === "mag-pad" ? "ring-1 ring-violet-500/50 bg-slate-900/50" : "bg-slate-900/20"
                  } ${getAlignedColor("mag-pad")}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-xs font-bold text-slate-200">Campo Magnético (X/Y)</h3>
                      <span className="text-[9px] text-slate-500 block">
                        Alvo X: {targets["mag-pad"].xMin}-{targets["mag-pad"].xMax}%, Y: {targets["mag-pad"].yMin}-{targets["mag-pad"].yMax}%
                      </span>
                    </div>
                    <button
                      onClick={() => handleLockControl("mag-pad")}
                      className={`text-[9px] font-extrabold uppercase px-2 py-0.5 rounded border transition-colors ${
                        myLockedControl === "mag-pad"
                          ? "bg-violet-600 text-white border-violet-500"
                          : "bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-900"
                      }`}
                    >
                      {myLockedControl === "mag-pad" ? "LOCKED" : "LOCK"}
                    </button>
                  </div>

                  {/* 2D XY track container */}
                  <div
                    ref={padContainerRef}
                    onMouseMove={(e) => {
                      if (e.buttons === 1) handleXYPadMove(e.clientX, e.clientY);
                    }}
                    onTouchMove={(e) => {
                      if (e.touches[0]) handleXYPadMove(e.touches[0].clientX, e.touches[0].clientY);
                    }}
                    className="h-32 w-full bg-slate-950/80 rounded-xl relative border border-slate-900 cursor-pointer overflow-hidden"
                  >
                    {/* Target highlight zone block */}
                    <div
                      className="absolute bg-emerald-500/10 border border-emerald-500/20"
                      style={{
                        left: `${targets["mag-pad"].xMin}%`,
                        width: `${targets["mag-pad"].xMax - targets["mag-pad"].xMin}%`,
                        top: `${targets["mag-pad"].yMin}%`,
                        height: `${targets["mag-pad"].yMax - targets["mag-pad"].yMin}%`,
                      }}
                    />

                    {/* Draggable indicator circle */}
                    <div
                      className="w-5 h-5 rounded-full bg-gradient-to-tr from-violet-600 to-pink-600 border border-white/20 absolute -ml-2.5 -mt-2.5 shadow-lg shadow-violet-500/50 transition-all duration-75 flex items-center justify-center"
                      style={{
                        left: `${localControlValues["mag-pad-x"]}%`,
                        top: `${localControlValues["mag-pad-y"]}%`,
                      }}
                    >
                      <div className="w-1.5 h-1.5 rounded-full bg-white" />
                    </div>
                  </div>
                </div>

              </div>
            )}

          </div>
        </div>
      )}
    </main>
  );
}
