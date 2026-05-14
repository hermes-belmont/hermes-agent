import { describe, expect, it } from "vitest";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const publicDir = path.resolve(process.cwd(), "public");

describe("PWA manifest", () => {
  it("contains required install metadata and existing icon files", async () => {
    const manifestPath = path.join(publicDir, "manifest.webmanifest");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    expect(manifest).toMatchObject({
      name: "Umbrella Mission Control",
      short_name: "Mission Control",
      description: "Operator console for Umbrella Holdings agent network",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      theme_color: "#ffbd38",
      background_color: "#041c1c",
    });
    expect(manifest.display_override).toEqual(["window-controls-overlay", "standalone"]);
    expect(manifest.icons).toHaveLength(3);
    expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === "maskable")).toBe(true);

    await Promise.all(manifest.icons.map((icon: { src: string }) => access(path.join(publicDir, icon.src))));
  });
});

describe("service worker", () => {
  it("is valid JavaScript and registers listeners without throwing", async () => {
    const sw = await readFile(path.join(publicDir, "sw.js"), "utf8");
    const listeners: string[] = [];
    const context = {
      self: {
        location: { origin: "https://app.umbrellacorporation.co" },
        addEventListener: (name: string) => listeners.push(name),
        skipWaiting: () => undefined,
        clients: { claim: () => Promise.resolve() },
      },
      caches: {
        keys: () => Promise.resolve([]),
        delete: () => Promise.resolve(true),
        open: () => Promise.resolve({ match: () => undefined, put: () => Promise.resolve() }),
      },
      fetch: () => Promise.resolve(new Response()),
      URL,
      Promise,
      Response,
    };
    vm.runInNewContext(sw, context);
    expect(listeners).toEqual(expect.arrayContaining(["install", "activate", "fetch"]));
  });
});
