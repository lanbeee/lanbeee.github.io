# Needle 3 browser runtime

`needle.js` is unmodified Emscripten glue from Cactus Compute's Apache-2.0
Needle 3 distribution, revision `d6c7d6a2e9655505e0f8e23339356dd1705900eb`:

https://huggingface.co/Cactus-Compute/needle3/blob/d6c7d6a2e9655505e0f8e23339356dd1705900eb/wasm/needle.js

Source and model documentation: https://github.com/cactus-compute/needle

The WASM runtime and weights are downloaded only when the user presses download.
Their revision, byte sizes and SHA-256 digests are pinned in
`js/assistant-needle.js`. No model weights are committed or precached. The
dedicated `tings-needle-v1` cache survives app-shell updates. Browser storage
eviction or the remove-download button can remove the assets.
