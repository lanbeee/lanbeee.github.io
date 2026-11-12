Pinned launch dependencies, served locally so startup does not depend on a CDN.

- Tabler Icons webfont 3.10.0: https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.10.0/dist/ . MIT; see TABLER-LICENSE. CSS keeps only the WOFF2 source and omits the source-map reference.
- Leaflet 1.9.4: https://unpkg.com/leaflet@1.9.4/dist/ . BSD-2-Clause; see LEAFLET-LICENSE. JavaScript is in ../../lib/js/leaflet.js; CSS and images are here. Only the source-map reference was removed from the JavaScript.

The original CSS and JS downloads were verified against the integrity hashes previously in index.html. Keep versions, fonts, images, and service-worker precache entries together when updating.
