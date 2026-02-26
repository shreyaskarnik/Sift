/**
 * Shared radar chart renderer (pure SVG, no dependencies).
 * Used by both side panel (compact) and full-page taste view.
 */
import type { TasteProbeResult, CategoryMap, AggregatedCategory, RadarRenderResult } from "./types";

const SVG_NS = "http://www.w3.org/2000/svg";
const GRID_RINGS = [0.25, 0.5, 0.75, 1.0];
const LABEL_PAD = 55; // extra viewBox padding for outer labels

export interface RadarOptions {
  /** SVG viewBox logical size (before label padding). Default 420. */
  size?: number;
  /** Radius of the outermost ring. Default 145. */
  radius?: number;
  /** Show 0.50 / 1.00 scale labels. Default true. */
  showScaleLabels?: boolean;
}

/**
 * Aggregate probes to category level.
 * Uses mean of top-2 probe scores per category (smooths outlier probes).
 * Sorted by category ID for stable axis order across renders.
 */
export function aggregateByCategory(
  probes: TasteProbeResult[],
  catMap: CategoryMap,
): AggregatedCategory[] {
  const scores = new Map<string, number[]>();
  for (const p of probes) {
    let arr = scores.get(p.category);
    if (!arr) { arr = []; scores.set(p.category, arr); }
    arr.push(p.score);
  }
  return [...scores.entries()]
    .map(([id, s]) => {
      s.sort((a, b) => b - a);
      const top2 = s.slice(0, 2);
      const avg = top2.reduce((sum, v) => sum + v, 0) / top2.length;
      return { id, label: catMap[id]?.label ?? id, score: avg };
    })
    .sort((a, b) => a.id.localeCompare(b.id)); // stable alphabetical order
}

/**
 * Render a radar chart SVG into the given container.
 * Returns { rendered, categories } — rendered is false if fewer than 3 categories.
 */
export function renderRadarChart(
  container: HTMLElement,
  probes: TasteProbeResult[],
  catMap: CategoryMap,
  opts: RadarOptions = {},
): RadarRenderResult {
  const size = opts.size ?? 420;
  const R = opts.radius ?? 145;
  const showScale = opts.showScaleLabels ?? true;
  const pad = LABEL_PAD;
  const vbSize = size + pad * 2;
  const cx = vbSize / 2;
  const cy = vbSize / 2;

  const cats = aggregateByCategory(probes, catMap);
  if (cats.length < 3) { container.replaceChildren(); return { rendered: false, categories: [] }; }

  const n = cats.length;
  const step = (2 * Math.PI) / n;
  const px = (angle: number, r: number) => cx + r * Math.cos(angle);
  const py = (angle: number, r: number) => cy + r * Math.sin(angle);

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${vbSize} ${vbSize}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", `Taste radar chart with ${n} categories`);

  // Accessible title
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = `Taste profile radar: ${cats.map(c => `${c.label} ${c.score.toFixed(2)}`).join(", ")}`;
  svg.appendChild(title);

  // Grid rings
  for (const pct of GRID_RINGS) {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", String(cx));
    circle.setAttribute("cy", String(cy));
    circle.setAttribute("r", String(R * pct));
    circle.setAttribute("class", "radar-grid");
    svg.appendChild(circle);
  }

  // Scale labels
  if (showScale) {
    for (const pct of [0.5, 1.0]) {
      const lbl = document.createElementNS(SVG_NS, "text");
      lbl.setAttribute("x", String(cx - 4));
      lbl.setAttribute("y", String(cy - R * pct - 3));
      lbl.setAttribute("class", "radar-score-label");
      lbl.textContent = pct.toFixed(2);
      svg.appendChild(lbl);
    }
  }

  // Axis lines, data points, labels
  const points: string[] = [];
  for (let i = 0; i < n; i++) {
    const angle = i * step - Math.PI / 2; // start from top
    const catId = cats[i].id;

    // Axis line
    const line = document.createElementNS(SVG_NS, "line");
    line.setAttribute("x1", String(cx));
    line.setAttribute("y1", String(cy));
    line.setAttribute("x2", String(px(angle, R)));
    line.setAttribute("y2", String(py(angle, R)));
    line.setAttribute("class", "radar-axis");
    line.dataset.categoryId = catId;
    svg.appendChild(line);

    // Data point (clamp to [0,1] to prevent inverted/stretched geometry)
    const r = R * Math.max(0, Math.min(1, cats[i].score));
    const dpx = px(angle, r);
    const dpy = py(angle, r);
    points.push(`${dpx},${dpy}`);

    // Vertex dot
    const dot = document.createElementNS(SVG_NS, "circle");
    dot.setAttribute("cx", String(dpx));
    dot.setAttribute("cy", String(dpy));
    dot.setAttribute("r", "3");
    dot.setAttribute("class", "radar-dot");
    dot.dataset.categoryId = catId;
    svg.appendChild(dot);

    // Category label — positioned outside ring with padding room
    const labelR = R + 18;
    const lx = px(angle, labelR);
    const ly = py(angle, labelR);
    const text = document.createElementNS(SVG_NS, "text");
    text.setAttribute("x", String(lx));
    text.setAttribute("y", String(ly));
    text.setAttribute("class", "radar-label");
    text.dataset.categoryId = catId;
    if (Math.abs(Math.cos(angle)) < 0.15) {
      text.setAttribute("text-anchor", "middle");
    } else if (Math.cos(angle) > 0) {
      text.setAttribute("text-anchor", "start");
    } else {
      text.setAttribute("text-anchor", "end");
    }
    text.textContent = cats[i].label;
    svg.appendChild(text);

    // Invisible hit area for forgiving click/hover targets
    // tabindex + role make it keyboard-focusable and announced by screen readers
    const hitArea = document.createElementNS(SVG_NS, "circle");
    hitArea.setAttribute("cx", String(lx));
    hitArea.setAttribute("cy", String(ly));
    hitArea.setAttribute("r", "20");
    hitArea.setAttribute("class", "radar-hit-area");
    hitArea.setAttribute("tabindex", "0");
    hitArea.setAttribute("role", "button");
    hitArea.setAttribute("aria-label", cats[i].label);
    hitArea.dataset.categoryId = catId;
    svg.appendChild(hitArea);
  }

  // Filled polygon (insert before dots for layering)
  const polygon = document.createElementNS(SVG_NS, "polygon");
  polygon.setAttribute("points", points.join(" "));
  polygon.setAttribute("class", "radar-polygon");
  const firstDot = svg.querySelector(".radar-dot");
  if (firstDot) svg.insertBefore(polygon, firstDot);
  else svg.appendChild(polygon);

  container.replaceChildren(svg);
  return { rendered: true, categories: cats };
}
