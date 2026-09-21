/** @type {import('tailwindcss').Config} */
export default {
  // The app is light-only. This stays on "class" rather than being removed so
  // that any stray `dark:` utility is inert — dropping it would fall back to
  // the `media` strategy and switch dark styles on from an OS preference.
  darkMode: ["class"],
  content: [
    "./pages/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./app/**/*.{ts,tsx}",
    "./src/**/*.{ts,tsx}",
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: { "2xl": "1400px" },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Without these, `bg-popover` / `bg-card` generate no CSS at all and
        // the surfaces render transparent. index.css declares the variables;
        // Tailwind only emits a class if the colour is in the theme too.
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        health: {
          green: "hsl(142, 71%, 45%)",
          yellow: "hsl(38, 92%, 50%)",
          red: "hsl(0, 84%, 60%)",
          unknown: "hsl(270, 9%, 46%)",
        },

        /*
         * The purple identity. White and `brand-600` are the two main colours;
         * everything else here is an accent used sparingly.
         *
         * Three of the ramp stops are the exact requested shades, placed where
         * their lightness belongs so the scale stays perceptually even:
         *   brand-600     #7F00FF  Violet        primary actions, links
         *   brand-200     #E0B0FF  Mauve         tinted fills, selected rows
         *   periwinkle-200 #CCCCFF Periwinkle    focus rings, soft surfaces
         *   orchid-500    #BF40BF  Bright Purple secondary accent
         *
         * Contrast note: white text clears AA on brand-600 (6.3:1) but only
         * reaches 4.5:1 on orchid-500, so orchid is for accents and dark-text
         * chips — never a background for small white text. Button hovers go
         * darker (brand-700) rather than sideways to orchid.
         */
        brand: {
          /*
           * 50 is the panel/inset surface, so it is deliberately the faintest
           * step on the ramp — just enough purple to not read as grey at
           * full-panel size. Full saturation here (it was 100%) tints large
           * boxes visibly lavender, which is louder than a surface should be.
           * Anything needing an actually visible fill — a skeleton pulse, a
           * highlighted row — uses 100, not 50.
           */
          50: "hsl(272, 80%, 98.8%)",
          100: "hsl(272, 100%, 96%)",
          200: "hsl(276, 100%, 85%)",
          300: "hsl(273, 100%, 76%)",
          400: "hsl(271, 100%, 65%)",
          500: "hsl(270, 100%, 57%)",
          600: "hsl(270, 100%, 50%)",
          700: "hsl(270, 100%, 41%)",
          800: "hsl(270, 95%, 33%)",
          900: "hsl(270, 90%, 25%)",
        },
        orchid: {
          50: "hsl(300, 60%, 97%)",
          100: "hsl(300, 60%, 94%)",
          200: "hsl(300, 58%, 87%)",
          300: "hsl(300, 55%, 77%)",
          400: "hsl(300, 52%, 63%)",
          500: "hsl(300, 50%, 50%)",
          600: "hsl(300, 52%, 42%)",
          700: "hsl(300, 55%, 34%)",
        },
        /*
         * The dark rail neutral, tinted toward the brand hue.
         *
         * Stops sit at the same lightness as the Tailwind `slate` stops they
         * replaced, so the sidebar's existing contrast hierarchy is preserved
         * exactly — this is a hue change, not a redesign.
         */
        plum: {
          200: "hsl(270, 35%, 84%)",
          300: "hsl(270, 30%, 74%)",
          400: "hsl(270, 25%, 65%)",
          500: "hsl(270, 20%, 47%)",
          700: "hsl(270, 30%, 27%)",
          800: "hsl(270, 38%, 18%)",
          900: "hsl(270, 45%, 11%)",
        },
        periwinkle: {
          50: "hsl(240, 100%, 98%)",
          100: "hsl(240, 100%, 96%)",
          200: "hsl(240, 100%, 90%)",
          300: "hsl(240, 85%, 82%)",
          400: "hsl(240, 70%, 72%)",
          500: "hsl(240, 60%, 62%)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [],
}
