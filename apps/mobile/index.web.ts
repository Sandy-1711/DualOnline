// Web entry. Skia on web is backed by CanvasKit (a WASM build of Skia) which
// must be downloaded and initialised BEFORE any <Canvas> renders. We load it
// first, then mount the app. Metro picks this file over index.ts when bundling
// for the web platform.
import { registerRootComponent } from "expo";
import { LoadSkiaWeb } from "@shopify/react-native-skia/lib/module/web";

// The Expo dev server serves the local canvaskit.wasm with the wrong MIME type,
// which breaks WebAssembly streaming compile. Loading CanvasKit from a CDN (with
// a correct application/wasm MIME) sidesteps that. Version must match the
// installed canvaskit-wasm.
void LoadSkiaWeb({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@0.41.0/bin/full/${file}`,
}).then(() => {
  // Imported lazily so App (and Skia components) only evaluate after CanvasKit
  // is ready.
  const App = require("./App").default;
  registerRootComponent(App);
});
