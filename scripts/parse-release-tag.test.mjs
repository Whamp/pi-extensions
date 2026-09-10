import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, after } from "node:test";
import { parseReleaseTag, resolvePackageDir } from "./parse-release-tag.mjs";
import { existsSync, readdirSync, readFileSync } from "node:fs";

describe("parseReleaseTag", () => {
  it("parses package tag", () => {
    assert.deepEqual(parseReleaseTag("@zenspc/pi-quiet@0.1.0"), {
      packageName: "@zenspc/pi-quiet",
      version: "0.1.0",
    });
  });

  it("parses prerelease", () => {
    assert.deepEqual(parseReleaseTag("@zenspc/pi-pstack@0.3.2-rc.1"), {
      packageName: "@zenspc/pi-pstack",
      version: "0.3.2-rc.1",
    });
  });

  it("strips refs/tags/", () => {
    assert.deepEqual(parseReleaseTag("refs/tags/@zenspc/pi-quiet@1.2.3"), {
      packageName: "@zenspc/pi-quiet",
      version: "1.2.3",
    });
  });

  it("rejects bad tags", () => {
    assert.throws(() => parseReleaseTag("v0.1.0"), /invalid release tag/);
    assert.throws(() => parseReleaseTag("@zenspc/pi-quiet"), /invalid release tag/);
    assert.throws(() => parseReleaseTag(""), /non-empty/);
  });
});

describe("resolvePackageDir", () => {
  const root = mkdtempSync(join(tmpdir(), "pi-ext-"));
  const packagesDir = join(root, "packages");
  mkdirSync(join(packagesDir, "pi-quiet"), { recursive: true });
  writeFileSync(
    join(packagesDir, "pi-quiet", "package.json"),
    JSON.stringify({ name: "@zenspc/pi-quiet", version: "0.1.0" }),
  );

  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("finds package by name", () => {
    const found = resolvePackageDir(packagesDir, "@zenspc/pi-quiet", {
      readdirSync,
      readFileSync,
      existsSync,
      join,
    });
    assert.equal(found.folderName, "pi-quiet");
    assert.equal(found.packageJson.version, "0.1.0");
  });

  it("throws when missing", () => {
    assert.throws(
      () =>
        resolvePackageDir(packagesDir, "@zenspc/nope", {
          readdirSync,
          readFileSync,
          existsSync,
          join,
        }),
      /no workspace package/,
    );
  });
});
