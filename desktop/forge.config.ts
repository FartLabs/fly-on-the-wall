import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { VitePlugin } from "@electron-forge/plugin-vite";
import { FusesPlugin } from "@electron-forge/plugin-fuses";
import { AutoUnpackNativesPlugin } from "@electron-forge/plugin-auto-unpack-natives";
import { FuseV1Options, FuseVersion } from "@electron/fuses";
import { PublisherGithub } from "@electron-forge/publisher-github";
import path from "node:path";
import fs from "node:fs";

interface PackageResult {
  platform: string;
  arch: string;
  outputPaths: string[];
}

const config: ForgeConfig = {
  packagerConfig: {
    executableName: "fly-on-the-wall",
    asar: {
      // https://node-llama-cpp.withcat.ai/guide/electron
      // unpacking the following dependencies since they contain binaries or need to preserve file structure:
      // 1. node-llama-cpp, @node-llama-cpp
      // 2. onnxruntime-node, onnxruntime-common
      // 3. sharp (and its dependency @img)
      unpack:
        "{**/node_modules/{node-llama-cpp,@node-llama-cpp}/**,**/node_modules/{onnxruntime-node,onnxruntime-common}/**,**/node_modules/sharp/**,**/node_modules/@img/**}"
    },
    ignore: (file) => {
      if (!file) return false;

      // Ignore unnecessary files to reduce package size and avoid Windows path length issues
      if (
        file.endsWith(".d.ts") ||
        file.endsWith(".map") ||
        file.endsWith(".md") ||
        file.toLowerCase().endsWith("license")
      ) {
        return true;
      }
      
      const isX64 = process.arch === "x64";
      const isArm64 = process.arch === "arm64";

      // Exclude irrelevant architecture-specific binaries in node_modules
      if (file.includes("node_modules")) {
        const segments = file.split(/[/\\]/);
        // Exclude arm64 binaries if we are building for x64
        if (isX64 && segments.some(s => s.toLowerCase().includes("arm64") || s.toLowerCase().includes("aarch64"))) {
          return true;
        }
        // Exclude x64 binaries if we are building for arm64
        if (isArm64 && segments.some(s => s.toLowerCase().includes("x64") || s.toLowerCase().includes("x86_64"))) {
          return true;
        }
      }

      const allowedList = ["/.vite", "/node_modules"];
      if (allowedList.some((allowedPath) => file.startsWith(allowedPath))) {
        return false;
      }

      return true;
    }
  },
  rebuildConfig: {},
  // TODO: configure later when app is good enough for 1.0
  // may need to look into flatpaks or other solutions to support other linux distros
  // moreover, look over this github action for node-llama-cpp cross compilation:
  // https://node-llama-cpp.withcat.ai/guide/electron#cross-compilation
  makers: [
    new MakerSquirrel(),
    new MakerZIP(),
    new MakerRpm({
      options: {
        name: "fly-on-the-wall",
        bin: "fly-on-the-wall"
      }
    }),
    new MakerDeb({
      options: {
        name: "fly-on-the-wall",
        bin: "fly-on-the-wall"
      }
    }),
    new MakerDMG()
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: "FartLabs",
        name: "fly-on-the-wall"
      },
      prerelease: true
    })
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
    prePackage: async (_config: ForgeConfig) => {
      console.log("[prePackage] Running prePackage hook...");
      const llamaPaths = [
        path.join(__dirname, "node_modules", "node-llama-cpp"),
        path.join(__dirname, "node_modules", "@node-llama-cpp")
      ];
      if (!llamaPaths.some((p) => fs.existsSync(p))) {
        console.warn(
          "[prePackage] node-llama-cpp or @node-llama-cpp not found in node_modules"
        );
      } else {
        console.log(
          "[prePackage] both @node-llama-cpp and node-llama-cpp found."
        );
      }
    },
    postPackage: async (_config: ForgeConfig, packageResult: PackageResult) => {
      console.log("[postPackage] Running postPackage hook...");
      for (const outputPath of packageResult.outputPaths) {
        // check if app.asar.unpacked exists
        const unpackedPath = path.join(
          outputPath,
          "resources",
          "app.asar.unpacked"
        );
        console.log("[postPackage] Checking for unpacked path:", unpackedPath);
        if (!fs.existsSync(unpackedPath)) {
          console.warn(
            "[postPackage] app.asar.unpacked not found after packaging"
          );
        } else {
          console.log("[postPackage] app.asar.unpacked found.");
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
