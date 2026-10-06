# Tings brand source

The October 6, 2026 user-edited Affinity Photo document and 2048 px PNG preserve the original design. `tings-logo-affinity-original.svg` preserves its original hybrid export. `../icons/tings-logo.svg` is the runtime vector master: the raster mask and arrowhead patch are replaced by a single smooth arrow outline following the edited silhouette. The centered eight-point star retains its vector geometry. Both paths are directly editable and contain no embedded bitmaps.

The simple brand mark is `../icons/tings-logo.svg`. The install-icon variant is `../icons/tings-app-icon.svg`: the exact same arrow and star geometry, with a dark blue-charcoal arrow (#26383E), golden sun (#E4A11B), a soft blue sky and a low green horizon. Its sky and ground are editable vectors, without raster textures. The landscape is reserved for PWA/Android install icons and the store icon; in-app branding, favicon, wordmarks, splash, notification and monochrome artwork retain the simple mark. Runtime PNGs are generated from these two canonical SVGs. The original PNG and Affinity file remain unchanged as design references. After a design edit, update the runtime SVG before regeneration.

The mark is a circular return arrow surrounding a centered eight-point star (two overlapping squares), with no sparkle cutout. The center star uses warm amber-gold `#F4BC58` to also suggest the sun; this is a color-only update, with both vector paths unchanged. Do not replace it with an earlier generated logo.

Regenerate runtime resources from the Android wrapper with `npm run brand:assets`, then `npm run sync:android`. This updates PWA favicons/install icons and Android launcher, monochrome, notification and splash images. Bump the PWA service-worker cache when replacing cached artwork. Android adaptive foregrounds are inset to keep the mark in the safe region; the landscape fills a separate background layer. The store icon has a full square sky/ground background, with no baked-in corner mask.

The branding directory is authoring material and is excluded from the Android runtime allowlist. Edit the canonical source here; `dist/` and copied Android web assets remain generated.
