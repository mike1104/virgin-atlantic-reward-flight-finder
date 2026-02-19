#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const TARGET_DIRS = ["src", ".github", "tests"];
const TARGET_FILES = ["README.md", "package.json", "tsconfig.json"];
const ALLOWED_EXT = new Set([".ts", ".js", ".json", ".md", ".yml", ".yaml", ".css", ".html", ".svg"]);

function listFiles(dirPath, out) {
  if (!fs.existsSync(dirPath)) return;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const abs = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      listFiles(abs, out);
      continue;
    }
    const ext = path.extname(entry.name);
    if (ALLOWED_EXT.has(ext)) out.push(abs);
  }
}

function validateFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const rel = path.relative(ROOT, filePath);
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");

  for (let i = 0; i < lines.length; i++) {
    if (/\s+$/.test(lines[i])) {
      return `${rel}:${i + 1} has trailing whitespace`;
    }
  }

  return null;
}

function main() {
  const files = [];
  for (const dir of TARGET_DIRS) listFiles(path.join(ROOT, dir), files);
  for (const file of TARGET_FILES) {
    const abs = path.join(ROOT, file);
    if (fs.existsSync(abs)) files.push(abs);
  }

  const errors = [];
  for (const file of files) {
    const error = validateFile(file);
    if (error) errors.push(error);
  }

  if (errors.length > 0) {
    console.error("Lint failed:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }

  console.log(`Lint passed (${files.length} files checked)`);
}

main();
