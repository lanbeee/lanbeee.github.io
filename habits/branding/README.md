# Tings brand source

The October 6, 2026 user-edited Affinity Photo document and 2048 px PNG preserve the original design. `tings-logo-affinity-original.svg` preserves its original hybrid export. `../icons/tings-logo.svg` is the runtime vector master: the raster mask and arrowhead patch are replaced by a single smooth arrow outline following the edited silhouette. The centered eight-point star retains its vector geometry. Both paths are directly editable and contain no embedded bitmaps.

Runtime PNGs are exported from the smooth SVG, including the PWA install icons and Android resources. The original PNG and Affinity file remain unchanged as design references. After a design edit, update the runtime SVG before regeneration.

The mark is a circular return arrow surrounding a centered eight-point star (two overlapping squares), with no sparkle cutout. Do not replace it with an earlier generated logo.

Regenerate runtime resources from the Android wrapper with `npm run brand:assets`, then `npm run sync:android`. This updates PWA favicons/install icons and Android launcher, monochrome, notification and splash images. Bump the PWA service-worker cache when replacing cached artwork. Android adaptive foregrounds are inset to keep the mark in the safe region; the store icon retains a full square charcoal background.

The branding directory is authoring material and is excluded from the Android runtime allowlist. Edit the canonical source here; `dist/` and copied Android web assets remain generated.
