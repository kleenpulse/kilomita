import { isomorphic } from "@kilomita/eslint-config/isomorphic";

export default isomorphic(import.meta.dirname, {
  paths: ["react", "react-dom", "next", "@kilomita/web"],
  patterns: ["react/*", "react-dom/*", "next/*", "@kilomita/web/*"],
  message: "The engine is framework-agnostic. Keep UI code in apps/web.",
});
