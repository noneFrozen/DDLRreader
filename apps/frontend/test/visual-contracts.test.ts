import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve(process.cwd(), "src/styles/tokens.css"), "utf8");
const global = readFileSync(resolve(process.cwd(), "src/styles/global.css"), "utf8");

function token(name: string) {
  const match = tokens.match(new RegExp(`--${name}:\\s*(#[0-9A-F]{6});`));
  if (!match) throw new Error(`Missing hex token: ${name}`);
  return match[1];
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
    const [red, green, blue] = channels.map((channel) => (
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

function expectFallback(fallback: string, enhanced: string) {
  const enhancedIndex = global.indexOf(enhanced);
  expect(enhancedIndex, `missing enhanced declaration: ${enhanced}`).toBeGreaterThan(-1);
  expect(global.slice(Math.max(0, enhancedIndex - 260), enhancedIndex)).toContain(fallback);
}

describe("Organic Productive visual contracts", () => {
  it("preserves the six confirmed base palette hex values without a later OKLCH override", () => {
    expect(token("color-bg")).toBe("#E8EDDF");
    expect(token("color-surface")).toBe("#F7F8EE");
    expect(token("color-border")).toBe("#D8E0CF");
    expect(token("color-muted")).toBe("#65795B");
    expect(token("color-accent")).toBe("#40543A");
    expect(token("color-fg")).toBe("#3E493B");
    expect(tokens).not.toMatch(/--color-(?:bg|surface|border|muted|accent|fg):\s*oklch/i);
  });

  it("provides a usable fallback before every enhanced color-mix treatment", () => {
    expectFallback("background: #E8EDDF;", "radial-gradient(circle at 12% 8%, color-mix");
    expectFallback("background: rgba(247, 248, 238, 0.82);", "background: color-mix(in oklch, var(--color-surface) 82%, transparent);");
    expectFallback("box-shadow: 0 12px 28px rgba(168, 66, 50, 0.22);", "box-shadow: 0 12px 28px color-mix(in oklch, var(--color-risk-high) 22%, transparent);");
    expectFallback("background: rgba(247, 248, 238, 0.72);", "background: color-mix(in oklch, var(--color-surface) 72%, transparent);");
    expectFallback("color: rgba(247, 248, 238, 0.78);", "color: color-mix(in oklch, var(--color-surface) 78%, transparent);");
    expectFallback("background: rgba(247, 248, 238, 0.65);", "background: color-mix(in oklch, var(--color-surface) 65%, transparent);");
    expectFallback("background: rgba(247, 248, 238, 0.76);", "background: color-mix(in oklch, var(--color-surface) 76%, transparent);");
  });

  it("keeps small text and every risk badge at WCAG AA contrast", () => {
    expect(contrastRatio(token("color-text-accessible"), token("color-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("color-fg"), token("color-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("color-surface"), token("color-risk-high"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("color-fg"), token("color-risk-warn-surface"))).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(token("color-fg"), token("color-risk-ok-surface"))).toBeGreaterThanOrEqual(4.5);
  });

  it("defines an active state for available step buttons", () => {
    expect(global).toContain(".step-navigation__button:not(:disabled):active");
    expect(global).toContain("transform: translateX(0);");
  });
});
