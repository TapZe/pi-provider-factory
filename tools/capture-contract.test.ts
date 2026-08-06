import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { readCompleteSnapshot } from "./capture-contract";

const VERSION = "9.9.9";
const ROUTES = ["chat", "messages", "responses"] as const;

function completeSnapshot(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    capturedAt: "2026-01-01T00:00:00.000Z",
    droidVersion: VERSION,
    routes: Object.fromEntries(
      ROUTES.map((route) => [
        route,
        {
          method: "POST",
          path: `/api/llm/${route}`,
          headers: { "x-factory-client": "cli" },
          body: { model: "echo", stream: true },
          systemChannel: { field: "system", present: true, length: 10, sha256: "a".repeat(64) },
        },
      ]),
    ),
  };
}

describe("readCompleteSnapshot", () => {
  let dir: string;
  let snapshotPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "capture-contract-test-"));
    snapshotPath = path.join(dir, `droid-${VERSION}.json`);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const write = (value: unknown) => {
    fs.writeFileSync(snapshotPath, typeof value === "string" ? value : JSON.stringify(value));
  };

  test("returns a complete snapshot for the expected version", () => {
    const snapshot = completeSnapshot();
    write(snapshot);
    const read = readCompleteSnapshot(snapshotPath, VERSION);
    expect(read).not.toBeNull();
    expect(read?.droidVersion).toBe(VERSION);
    expect(Object.keys(read?.routes ?? {}).sort()).toEqual([...ROUTES].sort());
  });

  test("returns null when the file does not exist", () => {
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    write("{not json");
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  test("returns null for non-object JSON", () => {
    write("[]");
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  test("returns null on schemaVersion mismatch", () => {
    write({ ...completeSnapshot(), schemaVersion: 2 });
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  test("returns null on droidVersion mismatch", () => {
    write(completeSnapshot());
    expect(readCompleteSnapshot(snapshotPath, "9.9.10")).toBeNull();
  });

  test("returns null when capturedAt is not a string", () => {
    write({ ...completeSnapshot(), capturedAt: 0 });
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  test("returns null when routes is missing or not an object", () => {
    const { routes: _routes, ...withoutRoutes } = completeSnapshot();
    write(withoutRoutes);
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
    write({ ...completeSnapshot(), routes: [] });
    expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
  });

  for (const missing of ROUTES) {
    test(`returns null when the ${missing} route is absent`, () => {
      const snapshot = completeSnapshot();
      delete (snapshot.routes as Record<string, unknown>)[missing];
      write(snapshot);
      expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
    });

    test(`returns null when the ${missing} route is null`, () => {
      const snapshot = completeSnapshot();
      (snapshot.routes as Record<string, unknown>)[missing] = null;
      write(snapshot);
      expect(readCompleteSnapshot(snapshotPath, VERSION)).toBeNull();
    });
  }
});
