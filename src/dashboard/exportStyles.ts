// The CSS properties an exported dashboard needs (decision #61). By default html-to-image copies every computed
// property (about 380 in Chrome) onto every element, which makes a multi-megabyte image the browser freezes on while
// it draws. These are the ones that change how a card, chart or table looks; the rest are behaviour (cursor, scroll,
// pointer events) or features the dashboard doesn't use.

const sides = (prefix: string, suffix = "") => ["top", "right", "bottom", "left"].map((s) => `${prefix}-${s}${suffix}`);
const corners = ["top-left", "top-right", "bottom-right", "bottom-left"].map((c) => `border-${c}-radius`);

export const EXPORT_STYLE_PROPERTIES: string[] = [
  // Box and layout. "content" draws ::before and ::after (html-to-image only copies those when it is listed).
  "content", "counter-reset", "counter-increment", "quotes", "display", "position", "top", "right", "bottom", "left", "z-index", "float", "clear", "box-sizing",
  "width", "height", "min-width", "min-height", "max-width", "max-height", "aspect-ratio",
  ...sides("margin"), ...sides("padding"),
  "overflow-x", "overflow-y", "overflow-wrap", "scrollbar-width", "scrollbar-color", "scrollbar-gutter", "visibility", "opacity", "vertical-align", "isolation",
  "flex-direction", "flex-wrap", "flex-grow", "flex-shrink", "flex-basis", "order",
  "justify-content", "justify-items", "justify-self", "align-content", "align-items", "align-self", "row-gap", "column-gap",
  "grid-template-columns", "grid-template-rows", "grid-template-areas", "grid-auto-flow", "grid-auto-columns", "grid-auto-rows",
  "grid-column-start", "grid-column-end", "grid-row-start", "grid-row-end",
  "transform", "transform-origin", "clip", "clip-path", "object-fit", "object-position",
  // Surfaces
  "background-color", "background-image", "background-size", "background-position", "background-repeat", "background-clip", "background-origin",
  ...sides("border", "-width"), ...sides("border", "-style"), ...sides("border", "-color"), ...corners,
  "box-shadow", "outline-width", "outline-style", "outline-color", "outline-offset", "filter", "mix-blend-mode",
  // Text
  "color", "font-family", "font-size", "font-weight", "font-style", "font-stretch", "font-variant-numeric", "font-feature-settings",
  "line-height", "letter-spacing", "word-spacing", "text-align", "text-indent", "text-transform", "text-overflow", "text-shadow",
  "text-decoration-line", "text-decoration-color", "text-decoration-style", "white-space", "word-break", "hyphens", "direction",
  "-webkit-line-clamp", "-webkit-box-orient", "list-style-type", "list-style-position", "tab-size",
  "text-wrap-mode", "white-space-collapse", "text-wrap-style", "font-kerning", "font-optical-sizing", "font-variation-settings",
  "font-variant-ligatures", "font-variant-caps", "font-variant-position", "font-synthesis-weight", "font-synthesis-style",
  "font-size-adjust", "text-rendering", "-webkit-font-smoothing", "text-decoration-thickness", "text-underline-offset",
  "writing-mode", "unicode-bidi", "line-break", "-webkit-text-fill-color",
  // Tables
  "border-collapse", "border-spacing", "-webkit-border-horizontal-spacing", "-webkit-border-vertical-spacing", "table-layout", "caption-side",
  "font-variant",
  // Charts (SVG)
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-dashoffset",
  "stroke-linecap", "stroke-linejoin", "text-anchor", "dominant-baseline", "shape-rendering", "paint-order", "stop-color", "stop-opacity",
  "alignment-baseline", "baseline-shift", "vector-effect", "marker-start", "marker-mid", "marker-end", "clip-rule",
  "cx", "cy", "r", "rx", "ry", "x", "y",
];
