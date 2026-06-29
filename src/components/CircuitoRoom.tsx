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
  XCircle,
  HelpCircle,
  Paintbrush,
  Compass,
} from "lucide-react";
import confetti from "canvas-confetti";

type PresenceUser = {
  name: string;
  color: string;
  presence_ref: string;
  activeNodeId: string | null;
};

type GameNode = {
  id: string;
  name: string;
  type: "multi" | "color" | "master" | "speed";
  requiredPlayers?: number;
  requiredColors?: string[];
  label: string;
  description: string;
  angle: number; // circular layout angle in degrees
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

const NODES: GameNode[] = [
  { id: "alpha", name: "Injetor Alpha", type: "multi", requiredPlayers: 2, label: "👥 2 Jogadores", description: "Requer 2 pessoas conectadas", angle: 0 },
  { id: "beta", name: "Bobina Beta", type: "color", requiredColors: ["#EF4444", "#3B82F6"], label: "🎨 Cores Diferentes", description: "Requer 2 pessoas de cores diferentes", angle: 72 },
  { id: "gamma", name: "Escudo Gama", type: "master", label: "👑 Mestre Elias", description: "Requer o Mestre da sala conectado", angle: 144 },
  { id: "delta", name: "Gerador Delta", type: "speed", label: "⚡ Carga Rápida", description: "Clique rápido para carregar", angle: 216 },
  { id: "omega", name: "Estabilizador Omega", type: "multi", requiredPlayers: 1, label: "👤 1 Jogador", description: "Requer 1 pessoa conectada", angle: 288 },
];

type CircuitoRoomProps = {
  roomId: string;
};

export default function CircuitoRoom({ roomId }: CircuitoRoomProps) {
  const router = useRouter();

  // Room metadata
  const cleanRoomId = decodeURIComponent(roomId);
  const roomName = cleanRoomId
    .split(/[-_]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

  // Identity state (sessionStorage based)
  const [userName, setUserName] = useState("");
  const [userColor, setUserColor] = useState(BRUSH_COLORS[0]);
  const [isJoined, setIsJoined] = useState(false);

  // Connection & Active Users
  const [activeUsers, setActiveUsers] = useState<PresenceUser[]>([]);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  // Game States (synced via Master/Host client)
  const [gameStatus, setGameStatus] = useState<"lobby" | "playing" | "won" | "lost">("lobby");
  const [coreEnergy, setCoreEnergy] = useState(0);
  const [timeRemaining, setTimeRemaining] = useState(90);
  const [overloadedNodes, setOverloadedNodes] = useState<string[]>([]);
  const [speedNodeCharge, setSpeedNodeCharge] = useState(0);

  // Active status of each node (calculated locally based on current users & game status)
  const [nodeActiveStates, setNodeActiveStates] = useState<Record<string, boolean>>({});

  // Supabase Channel
  const channelRef = useRef<any>(null);

  const isEliasMaster = userName.trim().toLowerCase() === "elias";

  // Host detection: The oldest client in presence list acts as the game engine host if Elias is not there
  const getHostName = () => {
    if (activeUsers.length === 0) return null;
    const eliasPresent = activeUsers.some((u) => u.name.toLowerCase() === "elias");
    if (eliasPresent) return "elias";
    // Otherwise, first alphabetically or by presence ref
    const sorted = [...activeUsers].sort((a, b) => a.presence_ref.localeCompare(b.presence_ref));
    return sorted[0]?.name || null;
  };

  const isHost = isEliasMaster || (getHostName() === userName && !activeUsers.some((u) => u.name.toLowerCase() === "elias"));

  // Refs for host loop to avoid closures on stale state
  const stateRef = useRef({
    gameStatus,
    coreEnergy,
    timeRemaining,
    overloadedNodes,
    speedNodeCharge,
    activeUsers,
  });

  useEffect(() => {
    stateRef.current = {
      gameStatus,
      coreEnergy,
      timeRemaining,
      overloadedNodes,
      speedNodeCharge,
      activeUsers,
    };
  }, [gameStatus, coreEnergy, timeRemaining, overloadedNodes, speedNodeCharge, activeUsers]);

  // Load color from sessionStorage on mount
  useEffect(() => {
    const savedColor = sessionStorage.getItem("quebra_gelo_color") || BRUSH_COLORS[Math.floor(Math.random() * BRUSH_COLORS.length)];
    setUserColor(savedColor);
  }, []);

  // Recalculate Node Activations whenever active users or node connection lists change
  useEffect(() => {
    const newActiveStates: Record<string, boolean> = {};

    NODES.forEach((node) => {
      const usersOnNode = activeUsers.filter((u) => u.activeNodeId === node.id);

      if (node.type === "multi") {
        const required = node.requiredPlayers || 1;
        // Scale requirement down if there are fewer players in the room
        const adjustedRequired = Math.min(required, activeUsers.length);
        newActiveStates[node.id] = usersOnNode.length >= adjustedRequired && adjustedRequired > 0;
      } else if (node.type === "color") {
        // Requires at least 2 players of different colors
        const uniqueColors = new Set(usersOnNode.map((u) => u.color));
        const required = Math.min(2, activeUsers.length);
        if (required <= 1) {
          newActiveStates[node.id] = usersOnNode.length >= 1;
        } else {
          newActiveStates[node.id] = usersOnNode.length >= 2 && uniqueColors.size >= 2;
        }
      } else if (node.type === "master") {
        // Requires the master "Elias" or whoever is host if Elias isn't in room
        const hostName = getHostName();
        newActiveStates[node.id] = usersOnNode.some((u) => u.name.toLowerCase() === (hostName || "elias").toLowerCase());
      } else if (node.type === "speed") {
        // Speed node is active if its charge is above 80%
        newActiveStates[node.id] = speedNodeCharge >= 80;
      }
    });

    setNodeActiveStates(newActiveStates);
  }, [activeUsers, speedNodeCharge]);

  // Host Game Loop logic (drives timer and energy calculation)
  useEffect(() => {
    if (!isJoined || !isHost || gameStatus !== "playing") return;

    const interval = setInterval(() => {
      const current = stateRef.current;
      if (current.gameStatus !== "playing") return;

      // 1. Drain energy slightly
      let newEnergy = current.coreEnergy - 1.5;

      // 2. Add or subtract based on node states
      let activeCount = 0;
      NODES.forEach((node) => {
        const isOverloaded = current.overloadedNodes.includes(node.id);
        const usersOnNode = current.activeUsers.filter((u) => u.activeNodeId === node.id);

        // Stabilize overloaded node if any player connected
        if (isOverloaded && usersOnNode.length > 0) {
          // Remove from overloaded list
          const index = current.overloadedNodes.indexOf(node.id);
          if (index > -1) {
            current.overloadedNodes.splice(index, 1);
          }
        }

        // Active node gives power
        const isActive = nodeActiveStates[node.id];
        if (isActive && !isOverloaded) {
          newEnergy += 3.5;
          activeCount++;
        }

        // Overloaded node drains power heavily
        if (isOverloaded) {
          newEnergy -= 4.0;
        }
      });

      // Decay speed charge slowly
      let newSpeedCharge = Math.max(0, current.speedNodeCharge - 6);

      // Clamp energy between 0 and 100
      newEnergy = Math.max(0, Math.min(100, newEnergy));

      // 3. Tick countdown
      const newTime = current.timeRemaining - 1;

      // Check win/loss
      let newStatus: "lobby" | "playing" | "won" | "lost" = current.gameStatus;
      if (newEnergy >= 100) {
        newStatus = "won";
        triggerVictoryConfetti();
        channelRef.current?.send({
          type: "broadcast",
          event: "celebrate",
          payload: {},
        });
      } else if (newTime <= 0 || (newEnergy <= 0 && current.coreEnergy > 0 && activeCount === 0)) {
        // Lose if time runs out or energy drops back to 0 completely
        newStatus = "lost";
      }

      // 4. Random Overload event trigger (15% chance every 8 seconds, max 2 overloaded at a time)
      if (newStatus === "playing" && Math.random() < 0.15 && current.overloadedNodes.length < 2 && newTime % 8 === 0) {
        const availableNodes = NODES.filter((n) => !current.overloadedNodes.includes(n.id) && n.id !== "delta");
        if (availableNodes.length > 0) {
          const target = availableNodes[Math.floor(Math.random() * availableNodes.length)];
          current.overloadedNodes.push(target.id);
        }
      }

      // 5. Broadcast new state
      const updatedState = {
        status: newStatus,
        coreEnergy: Number(newEnergy.toFixed(1)),
        timeRemaining: newTime,
        overloadedNodes: [...current.overloadedNodes],
        speedNodeCharge: newSpeedCharge,
      };

      // Set local states
      setCoreEnergy(updatedState.coreEnergy);
      setTimeRemaining(updatedState.timeRemaining);
      setOverloadedNodes(updatedState.overloadedNodes);
      setSpeedNodeCharge(updatedState.speedNodeCharge);
      setGameStatus(updatedState.status);

      channelRef.current?.send({
        type: "broadcast",
        event: "state-update",
        payload: updatedState,
      });

    }, 1000);

    return () => clearInterval(interval);
  }, [isJoined, isHost, gameStatus, nodeActiveStates]);

  // Setup Supabase Channel
  useEffect(() => {
    if (!isJoined || !userName.trim()) return;

    const channel = supabase.channel(`circuito:${roomId}`, {
      config: {
        broadcast: { self: false },
        presence: { key: userName },
      },
    });

    channelRef.current = channel;

    // Listen to game states
    channel.on("broadcast", { event: "state-update" }, (payload) => {
      const data = payload.payload;
      setGameStatus(data.status);
      setCoreEnergy(data.coreEnergy);
      setTimeRemaining(data.timeRemaining);
      setOverloadedNodes(data.overloadedNodes);
      setSpeedNodeCharge(data.speedNodeCharge);
    });

    // Request state on join (non-hosts fetch current room state)
    channel.on("broadcast", { event: "request-state" }, () => {
      if (isHost) {
        channel.send({
          type: "broadcast",
          event: "state-update",
          payload: {
            status: stateRef.current.gameStatus,
            coreEnergy: stateRef.current.coreEnergy,
            timeRemaining: stateRef.current.timeRemaining,
            overloadedNodes: stateRef.current.overloadedNodes,
            speedNodeCharge: stateRef.current.speedNodeCharge,
          },
        });
      }
    });

    channel.on("broadcast", { event: "celebrate" }, () => {
      triggerVictoryConfetti();
    });

    // Tap action broadcast for Delta Node
    channel.on("broadcast", { event: "delta-tap" }, () => {
      if (isHost) {
        setSpeedNodeCharge((prev) => Math.min(100, prev + 15));
      }
    });

    // Presence sync
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
            activeNodeId: pres[0].activeNodeId || null,
          });
        }
      });
      setActiveUsers(users);
    });

    channel.subscribe(async (status, err) => {
      if (status === "SUBSCRIBED") {
        await channel.track({
          name: userName,
          color: userColor,
          activeNodeId: selectedNode,
          online_at: new Date().toISOString(),
        });

        // Request current game state
        channel.send({
          type: "broadcast",
          event: "request-state",
          payload: {},
        });
      }
    });

    return () => {
      channel.unsubscribe();
    };
  }, [isJoined, userName, userColor, roomId, isHost]);

  // Update presence status when connecting to a node
  const connectToNode = async (nodeId: string | null) => {
    if (gameStatus === "lost" || gameStatus === "won") return;
    setSelectedNode(nodeId);
    if (channelRef.current) {
      await channelRef.current.track({
        name: userName,
        color: userColor,
        activeNodeId: nodeId,
        online_at: new Date().toISOString(),
      });
    }
  };

  // Delta click supply logic
  const handleDeltaTap = () => {
    if (selectedNode !== "delta" || gameStatus !== "playing") return;
    // Update local charge directly if host, else broadcast to host
    if (isHost) {
      setSpeedNodeCharge((prev) => Math.min(100, prev + 15));
    } else {
      channelRef.current?.send({
        type: "broadcast",
        event: "delta-tap",
        payload: {},
      });
    }
  };

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
      coreEnergy: 10,
      timeRemaining: 90,
      overloadedNodes: [],
      speedNodeCharge: 0,
    };
    setGameStatus(initial.status);
    setCoreEnergy(initial.coreEnergy);
    setTimeRemaining(initial.timeRemaining);
    setOverloadedNodes(initial.overloadedNodes);
    setSpeedNodeCharge(initial.speedNodeCharge);

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
      payload: initial,
    });
  };

  const resetGame = () => {
    if (!isHost) return;
    const initial = {
      status: "lobby" as const,
      coreEnergy: 0,
      timeRemaining: 90,
      overloadedNodes: [],
      speedNodeCharge: 0,
    };
    setGameStatus(initial.status);
    setCoreEnergy(initial.coreEnergy);
    setTimeRemaining(initial.timeRemaining);
    setOverloadedNodes(initial.overloadedNodes);
    setSpeedNodeCharge(initial.speedNodeCharge);
    connectToNode(null);

    channelRef.current?.send({
      type: "broadcast",
      event: "state-update",
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

  // Helper coordinate generator for svg connection lines
  const getNodeCoordinates = (angleDegrees: number) => {
    const radians = ((angleDegrees - 90) * Math.PI) / 180;
    const radius = 120; // Radius in SVG pixels
    const cx = 150; // Center x
    const cy = 150; // Center y
    return {
      x: cx + radius * Math.cos(radians),
      y: cy + radius * Math.sin(radians),
    };
  };

  return (
    <main className="flex-1 flex flex-col bg-slate-950 text-slate-100 font-sans select-none" style={{ minHeight: "100dvh" }}>
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
          <div className="absolute top-[-20%] left-[-20%] w-[80%] h-[80%] rounded-full bg-indigo-600/20 blur-[120px] pointer-events-none" />
          <div className="absolute bottom-[-20%] right-[-20%] w-[80%] h-[80%] rounded-full bg-cyan-600/20 blur-[120px] pointer-events-none" />

          <div className="w-full max-w-md bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-3xl p-8 shadow-2xl relative my-auto">
            <div className="text-center mb-8">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-tr from-indigo-500 to-cyan-500 flex items-center justify-center mb-4 shadow-lg shadow-indigo-500/30">
                <Zap className="w-8 h-8 text-white animate-pulse" />
              </div>
              <h1 className="text-2xl font-extrabold tracking-tight bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
                Circuito Cooperativo
              </h1>
              <p className="text-xs text-slate-400 mt-2">
                Trabalhe em equipe para carregar o reator de fusão!
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
                  className="w-full h-12 px-4 rounded-xl bg-slate-950/70 border border-slate-800 focus:border-indigo-500 text-slate-100 placeholder-slate-600 outline-none transition-all"
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
                  className="w-full h-12 bg-gradient-to-r from-indigo-600 to-cyan-600 hover:from-indigo-500 hover:to-cyan-500 text-white font-semibold rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95 transition-all"
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
                    onClick={() => router.push("/sincronia")}
                    className="h-10 bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-xl flex items-center justify-center gap-1.5 border border-slate-700/50 active:scale-95 transition-all text-xs"
                  >
                    <Compass className="w-3.5 h-3.5 text-indigo-400" />
                    Sincronia
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
                <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-500 to-cyan-500 flex items-center justify-center shrink-0">
                  <Zap className="w-4 h-4 text-white" />
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
                    Iniciar Reator
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

          {/* Connected Players list */}
          <div className="h-12 border-b border-slate-900 bg-slate-950 px-4 flex items-center gap-2 overflow-x-auto shrink-0 scrollbar-none">
            <Users className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider mr-2 shrink-0">Equipe:</span>
            <div className="flex items-center gap-2 flex-nowrap py-1">
              {activeUsers.map((user, idx) => {
                const nodeName = NODES.find((n) => n.id === user.activeNodeId)?.name || "Lobby";
                return (
                  <div
                    key={`${user.presence_ref || user.name}-${idx}`}
                    className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border border-slate-800 bg-slate-900/60 text-xs text-slate-300 shrink-0"
                  >
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: user.color }} />
                    <span className="font-bold">{user.name}</span>
                    <span className="text-[10px] text-slate-500">({nodeName})</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Main game board */}
          <div className="flex-1 flex flex-col md:flex-row relative p-4 gap-4 items-center justify-center overflow-y-auto">
            
            {/* Left/Top side: Reactor Core Visualization */}
            <div className="relative w-64 h-64 md:w-80 md:h-80 shrink-0 flex items-center justify-center">
              
              {/* SVG connection lines mapping nodes to core */}
              <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 300 300">
                <defs>
                  <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.4" />
                    <stop offset="100%" stopColor="#020617" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <circle cx="150" cy="150" r="40" fill="url(#coreGlow)" />
                {NODES.map((node) => {
                  const coords = getNodeCoordinates(node.angle);
                  const isActive = nodeActiveStates[node.id];
                  const isOverloaded = overloadedNodes.includes(node.id);
                  const isConnected = selectedNode === node.id;
                  
                  let strokeColor = "#1e293b"; // idle
                  let dashAnimation = "";
                  
                  if (isOverloaded) {
                    strokeColor = "#ef4444"; // flashing overload
                    dashAnimation = "stroke-dashoffset: 50; animation: dash 1s linear infinite;";
                  } else if (isActive) {
                    strokeColor = node.id === "delta" ? "#06b6d4" : "#10b981"; // active
                    dashAnimation = "stroke-dashoffset: -50; animation: dash 1s linear infinite reverse;";
                  } else if (isConnected) {
                    strokeColor = "#4f46e5"; // personal connect line
                  }

                  return (
                    <g key={`line-${node.id}`}>
                      {/* Base link wire */}
                      <line
                        x1="150"
                        y1="150"
                        x2={coords.x}
                        y2={coords.y}
                        stroke={strokeColor}
                        strokeWidth="2"
                        strokeDasharray={isActive || isOverloaded ? "6, 4" : "0"}
                        style={{
                          transition: "stroke 0.4s ease",
                          // @ts-ignore
                          style: dashAnimation
                        }}
                      />
                    </g>
                  );
                })}
              </svg>

              {/* Central Core Circle */}
              <div
                className={`w-28 h-28 rounded-full border-4 flex flex-col items-center justify-center shadow-2xl relative transition-all duration-300 ${
                  gameStatus === "won"
                    ? "border-emerald-500 bg-emerald-950/80 shadow-emerald-500/20"
                    : gameStatus === "lost"
                    ? "border-rose-600 bg-rose-950/80 shadow-rose-600/20"
                    : overloadedNodes.length > 0
                    ? "border-rose-500 bg-slate-900/90 shadow-rose-500/10 animate-pulse"
                    : "border-indigo-500 bg-slate-900/90 shadow-indigo-500/10"
                }`}
              >
                {/* Core glow background */}
                <div
                  className="absolute inset-0 rounded-full bg-indigo-500/10 scale-125 -z-10 animate-ping opacity-60"
                  style={{ animationDuration: gameStatus === "playing" ? `${1.5 - (coreEnergy / 100)}s` : "3s" }}
                />

                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">Reator</span>
                <span className="text-2xl font-extrabold font-mono tracking-tight bg-gradient-to-r from-slate-100 to-indigo-200 bg-clip-text text-transparent">
                  {coreEnergy}%
                </span>
                
                {/* Micro indicators */}
                <div className="flex items-center gap-1.5 mt-1.5">
                  <Clock className="w-3 h-3 text-slate-500" />
                  <span className="text-xs font-mono font-bold text-slate-300">
                    {timeRemaining}s
                  </span>
                </div>
              </div>

              {/* Circularly Placed Mini Node Dots for Visual Map */}
              {NODES.map((node) => {
                const coords = getNodeCoordinates(node.angle);
                const isActive = nodeActiveStates[node.id];
                const isOverloaded = overloadedNodes.includes(node.id);
                const count = activeUsers.filter((u) => u.activeNodeId === node.id).length;

                return (
                  <button
                    key={`map-node-${node.id}`}
                    onClick={() => connectToNode(node.id)}
                    disabled={gameStatus !== "playing"}
                    style={{
                      left: `${coords.x - 16}px`,
                      top: `${coords.y - 16}px`,
                    }}
                    className={`absolute w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 border ${
                      isOverloaded
                        ? "bg-rose-900/90 border-rose-500 shadow-lg shadow-rose-600/30 animate-bounce"
                        : isActive
                        ? "bg-emerald-950/90 border-emerald-500 shadow-md shadow-emerald-500/20"
                        : selectedNode === node.id
                        ? "bg-indigo-900/90 border-indigo-500"
                        : "bg-slate-900 border-slate-800 hover:border-slate-700"
                    }`}
                  >
                    <span className="text-xs font-bold text-slate-200">
                      {isOverloaded ? "⚠️" : count > 0 ? count : node.name.charAt(node.name.length - 1)}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Right/Bottom side: Control board / Detail listing of Modules */}
            <div className="flex-1 w-full max-w-lg flex flex-col gap-3">
              {gameStatus === "lobby" && (
                <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 text-center flex flex-col items-center justify-center">
                  <HelpCircle className="w-8 h-8 text-indigo-400 mb-2" />
                  <h3 className="font-bold text-sm">Aguardando Início</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-sm">
                    {isHost
                      ? "Você é o Host da rodada! Quando todos estiverem prontos, clique em 'Iniciar Reator' acima para ligar a fusão nucleônica."
                      : "Aguardando o Host ou Mestre iniciar a calibragem do circuito central."}
                  </p>
                </div>
              )}

              {gameStatus === "won" && (
                <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-5 text-center flex flex-col items-center justify-center">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-2" />
                  <h3 className="font-extrabold text-emerald-400">Sucesso no Circuito!</h3>
                  <p className="text-xs text-emerald-300/80 mt-1">
                    Excelente trabalho em equipe! O reator alcançou 100% de estabilidade com {timeRemaining} segundos restantes no cronômetro.
                  </p>
                  {isHost && (
                    <button
                      onClick={startGame}
                      className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/10"
                    >
                      Jogar Novamente
                    </button>
                  )}
                </div>
              )}

              {gameStatus === "lost" && (
                <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-5 text-center flex flex-col items-center justify-center">
                  <XCircle className="w-10 h-10 text-rose-500 mb-2" />
                  <h3 className="font-extrabold text-rose-400">Reator Sobrecargado!</h3>
                  <p className="text-xs text-rose-300/80 mt-1">
                    A fusão instável rompeu as bobinas de confinamento. Coordinem melhor a presença de energia nos módulos na próxima tentativa!
                  </p>
                  {isHost && (
                    <button
                      onClick={startGame}
                      className="mt-4 px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/10"
                    >
                      Tentar Novamente
                    </button>
                  )}
                </div>
              )}

              {/* Dynamic Module selector cards */}
              {gameStatus === "playing" && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Módulos de Carga</h3>
                  
                  {NODES.map((node) => {
                    const isSelected = selectedNode === node.id;
                    const isActive = nodeActiveStates[node.id];
                    const isOverloaded = overloadedNodes.includes(node.id);
                    const usersOnNode = activeUsers.filter((u) => u.activeNodeId === node.id);

                    return (
                      <div
                        key={node.id}
                        onClick={() => connectToNode(node.id)}
                        className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-4 ${
                          isOverloaded
                            ? "bg-rose-950/30 border-rose-500/50 shadow-inner shadow-rose-500/5"
                            : isSelected
                            ? "bg-indigo-950/30 border-indigo-500 shadow-md shadow-indigo-500/5"
                            : "bg-slate-900/60 border-slate-800 hover:border-slate-850"
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Indicator icon */}
                          <div
                            className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                              isOverloaded
                                ? "bg-rose-500/20 text-rose-400 animate-pulse"
                                : isActive
                                ? "bg-emerald-500/20 text-emerald-400"
                                : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {isOverloaded ? (
                              <AlertTriangle className="w-4 h-4" />
                            ) : node.type === "speed" ? (
                              <Zap className="w-4 h-4" />
                            ) : (
                              <Users className="w-4 h-4" />
                            )}
                          </div>

                          <div className="min-w-0">
                            <h4 className="text-xs font-extrabold text-slate-200">{node.name}</h4>
                            <p className="text-[10px] text-slate-400 font-medium">{node.description}</p>
                          </div>
                        </div>

                        {/* Node status / Requirements badges */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Active state label */}
                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${
                              isOverloaded
                                ? "bg-rose-500/20 text-rose-400 border-rose-500/30 animate-pulse"
                                : isActive
                                ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                                : "bg-slate-950 text-slate-500 border-slate-900"
                            }`}
                          >
                            {isOverloaded ? "SOBRECARGA" : isActive ? "GERANDO" : "OCIOSO"}
                          </span>

                          {/* Connected player dots */}
                          <div className="flex items-center gap-1 bg-slate-950/50 px-2 py-1 rounded-lg border border-slate-900">
                            <span className="text-[10px] text-slate-500 font-bold mr-1">{node.label}</span>
                            <div className="flex -space-x-1 overflow-hidden">
                              {usersOnNode.map((u, uIdx) => (
                                <div
                                  key={`dot-${u.presence_ref || u.name}-${uIdx}`}
                                  className="inline-block h-3.5 w-3.5 rounded-full ring-2 ring-slate-950"
                                  style={{ backgroundColor: u.color }}
                                  title={u.name}
                                />
                              ))}
                              {usersOnNode.length === 0 && <span className="text-[10px] text-slate-600 font-bold">0</span>}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Special interactive panel for the Delta speed charging node */}
              {gameStatus === "playing" && selectedNode === "delta" && (
                <div className="mt-2 bg-gradient-to-r from-cyan-950/20 to-indigo-950/20 border border-cyan-500/30 rounded-2xl p-4 flex flex-col items-center justify-center animate-fade-in gap-3">
                  <div className="w-full flex items-center justify-between">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest">
                      Delta Capacitor:
                    </span>
                    <span className="text-xs font-mono font-bold text-cyan-300 bg-cyan-950/40 border border-cyan-900/50 px-2 py-0.5 rounded">
                      {speedNodeCharge}%
                    </span>
                  </div>

                  {/* Charge gauge bar */}
                  <div className="w-full h-3 bg-slate-950 border border-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-cyan-500 to-indigo-500 transition-all duration-150"
                      style={{ width: `${speedNodeCharge}%` }}
                    />
                  </div>

                  <button
                    onClick={handleDeltaTap}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white font-extrabold text-sm flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/10 active:scale-95 transition-all"
                  >
                    <Zap className="w-4 h-4 animate-bounce" />
                    GERAR CARGA (CLIQUE RÁPIDO)
                  </button>
                  <p className="text-[9px] text-slate-500 text-center font-medium">
                    Carregue acima de 80% para ativar o módulo Delta. A carga decai com o tempo.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* Energy line movement styles */}
      <style jsx global>{`
        @keyframes dash {
          to {
            stroke-dashoffset: 100;
          }
        }
      `}</style>
    </main>
  );
}
