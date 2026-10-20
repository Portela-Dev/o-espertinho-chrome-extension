export type DisplayMode = "panel" | "popup";

const preferenceKey = "displayMode";

export async function configureDisplayMode(mode: DisplayMode, browser = chrome) {
  if (mode !== "panel" && mode !== "popup") throw new Error("Visualização inválida.");
  const panel = mode === "panel";
  await browser.sidePanel.setOptions({ enabled: panel });
  await browser.action.setPopup({ popup: panel ? "" : "popup.html" });
  await browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: panel });
}

export async function restoreDisplayMode(browser = chrome) {
  const saved = await browser.storage.local.get(preferenceKey);
  await configureDisplayMode(saved[preferenceKey] === "popup" ? "popup" : "panel", browser);
}

export async function saveDisplayMode(mode: DisplayMode, browser = chrome) {
  if (mode !== "panel" && mode !== "popup") throw new Error("Visualização inválida.");
  // Persist first: disabling the panel can destroy its page immediately.
  await browser.storage.local.set({ [preferenceKey]: mode });
  await configureDisplayMode(mode, browser);
}
