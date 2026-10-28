#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseScenario } from "../../engine/js/parser.js";
import { validateScenario } from "../../engine/js/validator.js";

const [scenarioPath, resourcesPath, displayName = scenarioPath] = process.argv.slice(2);
if (!scenarioPath || !resourcesPath) {
  console.error("usage: node validate_scenario.mjs <scenario> <resources.json> [display-name]");
  process.exit(2);
}
try {
  const [source, rawResources] = await Promise.all([
    readFile(scenarioPath, "utf8"),
    readFile(resourcesPath, "utf8")
  ]);
  const resources = JSON.parse(rawResources);
  validateScenario(parseScenario(source, displayName), resources);
  process.stdout.write(JSON.stringify({ success: true }));
} catch (error) {
  process.stdout.write(JSON.stringify({ success: false, message: error?.message ?? String(error) }));
  process.exitCode = 1;
}
