/**
 * SVG filter backing the liquid glass controls.
 *
 * `backdrop-filter: url(#netlet-liquid-glass)` bends whatever sits behind a
 * control instead of only blurring it, which is what separates glass from
 * frosted plastic. A single smoothed-noise displacement does the bending; the
 * colour split that suggests dispersion is handled by the rim gradient in
 * index.css, which cannot produce the channel-separation artefacts a
 * per-channel displacement does on light backdrops.
 *
 * Only Chromium resolves an SVG filter inside backdrop-filter today. Safari and
 * Firefox fail the `@supports` test in index.css and keep the plain blur, so
 * this markup is inert there — it costs one hidden, empty-size SVG.
 *
 * Rendered once, from App.
 */
export default function LiquidGlassFilters() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      // Kept out of layout and out of the a11y tree; the filter is referenced
      // by id, so the element itself never needs to be visible.
      style={{
        position: "absolute",
        width: 0,
        height: 0,
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter
          id="netlet-liquid-glass"
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
          colorInterpolationFilters="sRGB"
        >
          {/* A slow, smooth noise field — the "surface" light passes through.
              Low frequency and heavy smoothing keep it a gentle lens rather
              than a ripple. */}
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.005 0.009"
            numOctaves="2"
            seed="11"
            result="turbulence"
          />
          <feGaussianBlur in="turbulence" stdDeviation="6" result="lens" />

          {/* One displacement pass, modest scale. An earlier version split R/G/B
              across three passes at different strengths to mimic dispersion;
              on a light backdrop the 12px spread between channels reconstructed
              as a saturated cyan band down the trailing edge rather than a fine
              fringe. The warm/cool rim gradient in index.css carries that hint
              instead, with no colour separation to go wrong. */}
          <feDisplacementMap
            in="SourceGraphic"
            in2="lens"
            scale="9"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
    </svg>
  );
}
