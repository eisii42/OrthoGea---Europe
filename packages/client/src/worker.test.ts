import { afterEach, describe, expect, it, vi } from "vitest";
import { createTileWorker } from "./worker.js";

/**
 * A no-data fill is found by flooding inwards from the tile border, and that
 * connectivity rule is the whole safety argument: a car park, a deep shadow, a
 * white roof and a snowfield are all as flat as a collar, but imagery surrounds
 * them and the flood never arrives. These build the awkward cases as pixels.
 */
type Paint = (x: number, y: number, size: number) => [number, number, number];

/** Textured ground: never flat, never uniform. */
const ground: Paint = (x, y) => [60 + ((x * 7) % 90), 90 + ((y * 5) % 70), 40 + ((x + y) % 80)];

/** White fill over the left third, as a WMS returns at a coverage edge. */
const collarLeft: Paint = (x, y, size) => (x < size / 3 ? [255, 255, 255] : ground(x, y, size));

/** Nothing but fill: the tile is entirely outside the real footprint. */
const allWhite: Paint = () => [255, 255, 255];

/** A black car park in the middle - flat, but nowhere near the border. */
const parkInside: Paint = (x, y, size) => {
  const inside = x > size * 0.4 && x < size * 0.6 && y > size * 0.4 && y < size * 0.6;
  return inside ? [2, 2, 2] : ground(x, y, size);
};

/** Installs just enough of the canvas API for the worker body to run inline. */
function stubCanvas(paint: Paint): { encoded: () => number } {
  let encodes = 0;

  vi.stubGlobal("createImageBitmap", async (_blob: Blob, options?: { resizeWidth?: number }) => ({
    width: options?.resizeWidth ?? 512,
    height: options?.resizeWidth ?? 512,
    close: () => undefined
  }));

  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(
        readonly width: number,
        readonly height: number
      ) {}
      getContext(): unknown {
        return {
          drawImage: () => undefined,
          putImageData: () => undefined,
          getImageData: (_x: number, _y: number, w: number, h: number) => {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let y = 0; y < h; y += 1) {
              for (let x = 0; x < w; x += 1) {
                const [r, g, b] = paint(x, y, w);
                const p = (y * w + x) * 4;
                data[p] = r;
                data[p + 1] = g;
                data[p + 2] = b;
                data[p + 3] = 255;
              }
            }
            return { data, width: w, height: h };
          }
        };
      }
      async convertToBlob(): Promise<Blob> {
        encodes += 1;
        return new Blob([new Uint8Array(4096)], { type: "image/png" });
      }
    }
  );

  return { encoded: () => encodes };
}

const tile = () => ({ data: new Uint8Array(40_000).buffer, contentType: "image/jpeg" });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("collar detection", () => {
  it("trims a fill that reaches the tile border", async () => {
    const canvas = stubCanvas(collarLeft);
    const worker = createTileWorker({ worker: false });

    const verdict = await worker.inspect(tile());
    expect(verdict?.verdict).toBe("trim");
    if (verdict?.verdict !== "trim") throw new Error("unreachable");
    expect(verdict.collar).toBeGreaterThan(0.3);
    expect(verdict.collar).toBeLessThan(0.4);
    expect(verdict.contentType).toBe("image/png");
    // One encode: the repaired tile. The cheap pass never encodes.
    expect(canvas.encoded()).toBe(1);
  });

  it("reports a tile that is nothing but fill, without repairing it", async () => {
    const canvas = stubCanvas(allWhite);
    const worker = createTileWorker({ worker: false });

    const verdict = await worker.inspect(tile());
    expect(verdict?.verdict).toBe("empty");
    // Nothing to repair, so nothing is decoded at full size or re-encoded.
    expect(canvas.encoded()).toBe(0);
  });

  it("leaves a flat area that the border cannot reach", async () => {
    // The connectivity rule in one test: a black car park is exactly as flat as
    // a collar, and must survive untouched.
    const canvas = stubCanvas(parkInside);
    const worker = createTileWorker({ worker: false });

    expect((await worker.inspect(tile()))?.verdict).toBe("keep");
    expect(canvas.encoded()).toBe(0);
  });

  it("leaves ordinary imagery alone", async () => {
    const canvas = stubCanvas(ground);
    const worker = createTileWorker({ worker: false });

    expect((await worker.inspect(tile()))?.verdict).toBe("keep");
    expect(canvas.encoded()).toBe(0);
  });

  it("answers undefined where pixels cannot be read", async () => {
    // Node, or a browser without OffscreenCanvas: the caller falls back to its
    // byte-size heuristic rather than failing the tile.
    const worker = createTileWorker({ worker: false });
    expect(await worker.inspect(tile())).toBeUndefined();
    expect(await worker.stitch({ urls: ["a", "b", "c", "d"], tileSize: 512 })).toBeUndefined();
  });
});
