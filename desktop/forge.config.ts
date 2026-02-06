import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import path from "node:path";
import fs from "node:fs";

interface PackageResult {
  platform: string;
  arch: string;
  outputPaths: string[];
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // https://node-llama-cpp.withcat.ai/guide/electron
      unpack:
        "{**/node_modules/{node-llama-cpp,@node-llama-cpp}/**,**/node_modules/{onnxruntime-node,onnxruntime-common}/**,**/node_modules/sharp/**,**/node_modules/@img/**}"
    },
    ignore: (file) => {
      if (!file) return false;

      const allowedList = ["/.vite", "/node_modules"];
      if (allowedList.some((allowedPath) => file.startsWith(allowedPath))) {
        return false;
      }

      return true;
    }
  },
  rebuildConfig: {},
  // TODO: configure later when app is good enough for 1.0
  makers: [
    // new MakerSquirrel({}),
    new MakerZIP({})
    // new MakerRpm({}),
    // new MakerDeb({})
  ],
  hooks: {
    /**
     * Patch node-llama-cpp's `testBindingBinary.js` before it gets sealed into
     * the asar archive.
     *
     * Background: `testBindingBinary` forks a subprocess to verify the native
     * addon loads correctly. Inside an Electron utility process, this always
     * fails because:
     *   1. `utilityProcess.fork()` is a main-process-only API.
     *   2. `child_process.fork()` requires RunAsNode, which is disabled via Fuses.
     *
     * The library already has a built-in skip path: if the file's own basename
     * doesn't start with "testBindingBinary" (i.e. it was bundled/renamed), the
     * function logs a warning and returns `true` without forking.
     *
     * We exploit this by renaming the file to `_testBindingBinary.js` in the
     * build directory *before* asar creation. The internal import graph inside
     * node-llama-cpp never imports this file by name — it's only referenced
     * via `__filename` at runtime — so the rename is safe.
     *
     * We also update any static `import` statements that reference the old name
     * in neighbouring files, just in case.
     */
    packageAfterCopy: async (_config, buildPath) => {
      console.log(
        "[packageAfterCopy] Patching testBindingBinary for utility-process compatibility..."
      );

      const testBindingDir = path.join(
        buildPath,
        "node_modules",
        "node-llama-cpp",
        "dist",
        "bindings",
        "utils"
      );
      const oldFile = path.join(testBindingDir, "testBindingBinary.js");
      const newFile = path.join(testBindingDir, "_testBindingBinary.js");

      if (!fs.existsSync(oldFile)) {
        console.warn(
          "[packageAfterCopy] testBindingBinary.js not found at:",
          oldFile
        );
        return;
      }

      // Rename the file so its basename no longer starts with "testBindingBinary"
      fs.renameSync(oldFile, newFile);
      console.log(
        "[packageAfterCopy] Renamed testBindingBinary.js → _testBindingBinary.js"
      );

      // Fix any import/require references in sibling and parent files
      const dirsToScan = [
        testBindingDir,
        path.join(
          buildPath,
          "node_modules",
          "node-llama-cpp",
          "dist",
          "bindings"
        )
      ];

      for (const dir of dirsToScan) {
        if (!fs.existsSync(dir)) continue;
        for (const entry of fs.readdirSync(dir)) {
          if (!entry.endsWith(".js") && !entry.endsWith(".mjs")) continue;
          const filePath = path.join(dir, entry);
          const content = fs.readFileSync(filePath, "utf-8");
          // Match imports like "./testBindingBinary.js" or "../utils/testBindingBinary.js"
          if (content.includes("testBindingBinary.js")) {
            const patched = content.replace(
              /testBindingBinary\.js/g,
              "_testBindingBinary.js"
            );
            fs.writeFileSync(filePath, patched, "utf-8");
            console.log(
              `[packageAfterCopy] Updated import references in: ${entry}`
            );
          }
        }
      }

      console.log("[packageAfterCopy] testBindingBinary patch complete.");
    },
    // check if node-llama-cpp or @node-llama-cpp exists in node_modules before packaging
    prePackage: async (config: ForgeConfig) => {
      console.log("Running prePackage hook...");
      const fs = await import("node:fs");
      const path = await import("node:path");
      const llamaPaths = [
        path.join(__dirname, "node_modules", "node-llama-cpp"),
        path.join(__dirname, "node_modules", "@node-llama-cpp")
      ];
      if (!llamaPaths.some((p) => fs.existsSync(p))) {
        console.warn(
          "node-llama-cpp or @node-llama-cpp not found in node_modules"
        );
      } else {
        console.log("both @node-llama-cpp and node-llama-cpp found.");
      }
    },
    postPackage: async (config: ForgeConfig, packageResult: PackageResult) => {
      console.log("Running postPackage hook...");
      const fs = await import("node:fs");
      const path = await import("node:path");

      for (const outputPath of packageResult.outputPaths) {
        // check if app.asar.unpacked exists
        const unpackedPath = path.join(
          outputPath,
          "resources",
          "app.asar.unpacked"
        );
        console.log("Checking for unpacked path:", unpackedPath);
        if (!fs.existsSync(unpackedPath)) {
          console.warn("app.asar.unpacked not found after packaging");
        } else {
          console.log("app.asar.unpacked found.");
        }
      }
    }
  },
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main/main.ts",
          config: "vite.main.config.ts",
          target: "main"
        },
        {
          entry: "src/preload/preload.ts",
          config: "vite.preload.config.ts",
          target: "preload"
        },
        {
          entry: "src/summarization/utility-process.ts",
          config: "vite.utility.config.ts",
          target: "main"
        },
        {
          entry: "src/transcription/utility-process.ts",
          config: "vite.utility.config.ts",
          target: "main"
        }
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts"
        }
      ]
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true
    })
  ]
};

export default config;
