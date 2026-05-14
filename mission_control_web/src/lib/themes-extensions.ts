export const MISSION_CONTROL_EXTENSIONS = [
  {
    name: "midnight",
    label: "Midnight",
    description: "Deep blue-violet twilight with cosmic accents",
    swatches: ["#e8e3ff", "#1d1644", "#a78bfa"],
    palette: {
      background: { hex: "#0a0a1f", alpha: 1 },
      midground: { hex: "#1d1644", alpha: 1 },
      foreground: { hex: "#e8e3ff", alpha: 1 },
      warmGlow: "#a78bfa",
      warmGlowDeep: "#6d4cd1",
      noiseOpacity: 0.85,
    },
  },
  {
    name: "cyberpunk",
    label: "Cyberpunk",
    description: "Neon CRT phosphor on jet black",
    swatches: ["#33ff88", "#001a0d", "#6bf199"],
    palette: {
      background: { hex: "#000000", alpha: 1 },
      midground: { hex: "#001a0d", alpha: 1 },
      foreground: { hex: "#33ff88", alpha: 1 },
      warmGlow: "#6bf199",
      warmGlowDeep: "#009955",
      noiseOpacity: 0.7,
    },
  },
  {
    name: "rose",
    label: "Rosé",
    description: "Soft pink blush with rose-gold warmth",
    swatches: ["#ffe1e8", "#3d1f2e", "#f9a8d4"],
    palette: {
      background: { hex: "#1a0f15", alpha: 1 },
      midground: { hex: "#3d1f2e", alpha: 1 },
      foreground: { hex: "#ffe1e8", alpha: 1 },
      warmGlow: "#f9a8d4",
      warmGlowDeep: "#c97a9d",
      noiseOpacity: 0.8,
    },
  },
] as const;
