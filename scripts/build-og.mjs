// Generates the social-share unfurl card (1200x630) as an SVG, embedding the
// Dr. Fuhrman wordmark as a base64 data-URI image, then leaves rasterization
// to rsvg-convert (see npm run "og" / the inline command). On-brand cream +
// green-aurora background with the gradient "AI" sparkle lockup, tagline, and
// advisory pill — mirrors the hero so the link unfurls into a recognizable card.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const logoSvg = readFileSync(resolve(root, "public/drfuhrman-logo.svg"));
const logoB64 = logoSvg.toString("base64");

// Brand tokens (mirrors src/styles/global.css @theme).
const NAVY = "#3d4256";
const GREEN_DARK = "#3b6b3f";
const GREEN_MID = "#5a8f5f";
const GREEN_LEAF = "#9ec947";
const CREAM = "#f4efda";
const TEXT = "#1a1a1a";

// Lockup geometry — logo wordmark + gradient "AI" + sparkles, centered as a row.
const LOGO_H = 86;
const LOGO_W = (LOGO_H * 200) / 42; // preserve 200x42 aspect → ~409
const GAP = 30;
const AI_FONT = 96;
const AI_W = 122; // visual width of "AI" at 96px bold (measured-by-eye, verified in render)
const ROW_CENTER_Y = 196;
const totalW = LOGO_W + GAP + AI_W;
const startX = (1200 - totalW) / 2;
const logoX = startX;
const logoY = ROW_CENTER_Y - LOGO_H / 2;
const aiX = startX + LOGO_W + GAP;
const aiBaseline = ROW_CENTER_Y + AI_FONT * 0.34;

// 4-point sparkle path (unit ~24 viewBox), reused at two sizes near "AI".
const star = (cx, cy, s, fill) => {
  const u = s / 24;
  return `<path transform="translate(${cx - 12 * u} ${cy - 12 * u}) scale(${u})" d="M12 2L13.4 9.6 21 12L13.4 14.4 12 22 10.6 14.4 3 12 10.6 9.6Z" fill="${fill}"/>`;
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="aiGrad" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${GREEN_DARK}"/>
      <stop offset="55%" stop-color="${GREEN_MID}"/>
      <stop offset="100%" stop-color="${GREEN_LEAF}"/>
    </linearGradient>
    <radialGradient id="glowLeaf" cx="22%" cy="20%" r="55%">
      <stop offset="0%" stop-color="${GREEN_LEAF}" stop-opacity="0.30"/>
      <stop offset="100%" stop-color="${GREEN_LEAF}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glowDark" cx="82%" cy="92%" r="60%">
      <stop offset="0%" stop-color="${GREEN_DARK}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${GREEN_DARK}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- Cream base + soft green aurora (echoes the cursor-tracked body bg) -->
  <rect width="1200" height="630" fill="${CREAM}"/>
  <rect width="1200" height="630" fill="url(#glowLeaf)"/>
  <rect width="1200" height="630" fill="url(#glowDark)"/>

  <!-- Top + bottom hairline accent in the leaf green -->
  <rect x="0" y="0" width="1200" height="6" fill="${GREEN_LEAF}"/>
  <rect x="0" y="624" width="1200" height="6" fill="${GREEN_DARK}"/>

  <!-- Wordmark + AI lockup -->
  <image x="${logoX}" y="${logoY}" width="${LOGO_W}" height="${LOGO_H}" xlink:href="data:image/svg+xml;base64,${logoB64}"/>
  <text x="${aiX}" y="${aiBaseline}" font-family="Helvetica, Arial, sans-serif" font-size="${AI_FONT}" font-weight="800" letter-spacing="-2" fill="url(#aiGrad)">AI</text>
  ${star(aiX + AI_W - 6, ROW_CENTER_Y - AI_FONT * 0.34, 26, GREEN_LEAF)}
  ${star(aiX - 4, ROW_CENTER_Y + AI_FONT * 0.36, 18, GREEN_MID)}

  <!-- Tagline -->
  <text x="600" y="360" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="58" font-weight="700" letter-spacing="-1" fill="${TEXT}">Every book. Every lecture. Every answer.</text>

  <!-- Subtitle -->
  <text x="600" y="418" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="30" font-weight="400" fill="${NAVY}">AI-powered Nutritarian guidance — chat 24/7, in any language</text>

  <!-- Chat-message input illustration: rounded field with placeholder CTA +
       a green circular send button — mirrors the site's composer. -->
  <g>
    <rect x="320" y="476" width="560" height="72" rx="36" fill="#ffffff" fill-opacity="0.94" stroke="${GREEN_DARK}" stroke-opacity="0.28" stroke-width="1.5"/>
    <text x="356" y="521" font-family="Helvetica, Arial, sans-serif" font-size="26" font-weight="400" fill="#7c8390">Ask the Dr. Fuhrman AI…</text>
    <!-- send button: green disc + white paper-plane -->
    <circle cx="844" cy="512" r="28" fill="${GREEN_DARK}"/>
    <path transform="translate(830 498) scale(1.15)" d="M2 21l21-9L2 3v7l15 2-15 2v7z" fill="#ffffff"/>
  </g>
</svg>`;

const outSvg = resolve(root, "assets-source/og-card.svg");
writeFileSync(outSvg, svg);
console.log("Wrote", outSvg);
