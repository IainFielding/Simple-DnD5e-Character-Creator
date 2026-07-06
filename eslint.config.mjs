import js from "@eslint/js";
import globals from "globals";

/**
 * Flat ESLint config for the Character Creator.
 *
 * The module is browser ESM running inside Foundry VTT, so on top of the standard browser
 * globals we declare the Foundry / dnd5e globals the code reaches for (`game`, `CONFIG`,
 * `foundry`, `dnd5e`, `Roll`, `Hooks`, `fromUuid`, …). Tests additionally see Vitest's
 * globals and Node built-ins.
 */

const foundryGlobals = {
  game: "readonly",
  CONFIG: "readonly",
  CONST: "readonly",
  foundry: "readonly",
  dnd5e: "readonly",
  Roll: "readonly",
  Hooks: "readonly",
  fromUuid: "readonly",
  fromUuidSync: "readonly",
  ui: "readonly",
  canvas: "readonly",
  Actor: "readonly",
  Item: "readonly",
  Dialog: "readonly",
  Application: "readonly",
  Handlebars: "readonly",
  FilePicker: "readonly",
  ChatMessage: "readonly"
};

export default [
  { ignores: ["node_modules/**"] },
  js.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "tools/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node, ...foundryGlobals }
    },
    rules: {
      // Unused args are common in Foundry hook/callback signatures; ignore leading-underscore
      // names and trailing unused args rather than forcing churn on every handler.
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", args: "after-used" }],
      "no-empty": ["error", { allowEmptyCatch: true }]
    }
  },
  {
    files: ["test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node, ...foundryGlobals }
    }
  }
];
