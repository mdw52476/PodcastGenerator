import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

// Bundled OFL fonts (see docs/licenses.md). Loaded once per render tab.
export const TITLE_FONT = "Oswald";
export const BODY_FONT = "Inter";

const FONTS: Array<[string, string]> = [
  [TITLE_FONT, "fonts/Oswald.ttf"],
  [BODY_FONT, "fonts/Inter.ttf"],
];

if (typeof document !== "undefined") {
  const handle = delayRender("Loading fonts");
  Promise.all(
    FONTS.map(async ([family, src]) => {
      const face = new FontFace(family, `url(${staticFile(src)})`, { weight: "100 900" });
      document.fonts.add(await face.load());
    }),
  )
    .then(() => continueRender(handle))
    .catch((err) => cancelRender(err));
}
