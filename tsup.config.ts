import { defineConfig } from "tsup";
import { dedent } from "radashi";

export default defineConfig({
  entry: ["src/userscript.ts"],
  format: "iife",
  outDir: "dist",
  target: "esnext",
  banner: {
    js: dedent`
      // ==UserScript==
      // @name         Product Hunt Guesser
      // @namespace    https://github.com/aleclarson
      // @version      0.1.0
      // @description  Guess Product Hunt launch scores and hop between launches.
      // @match        https://www.producthunt.com/products/*/launches/*
      // @run-at       document-end
      // @grant        none
      // ==/UserScript==
    `,
  },
});
