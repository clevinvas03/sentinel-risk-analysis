import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        // editorial transitional serif for display + reading
        display: ["var(--font-serif)", "Georgia", "ui-serif", "serif"],
        sans: ["ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      colors: {
        // warm "whitish-brown" (oat / latte) light surface scale
        ink: {
          900: "#E6DDCB", // app background (whitish brown)
          850: "#E0D6C1",
          800: "#F2ECDF", // panel surface (soft warm off-white above the bg)
          750: "#DBD0B9", // raised / active
          700: "#CDC1A6", // hairline / border (defined taupe)
          hair: "#BCAF9140",
        },
        fg: {
          DEFAULT: "#322C22", // primary warm brown-charcoal
          dim: "#6A6051", // secondary
          faint: "#998D74", // tertiary / labels
        },
        signal: "#AE5430", // Claude-ish clay / terracotta accent (deepened)
        kb: "#677650", // knowledge-base tint (sage)
        web: "#566E89", // web tint (muted denim)
        parcel: "#9C7330", // parcel tint (ochre)
      },
      letterSpacing: {
        label: "0.14em",
      },
      boxShadow: {
        panel:
          "0 1px 2px rgba(70,58,40,0.04), 0 14px 40px -28px rgba(70,58,40,0.35)",
        focus:
          "0 0 0 1px rgba(182,92,57,0.45), 0 0 0 4px rgba(182,92,57,0.10)",
      },
    },
  },
  plugins: [],
};

export default config;
