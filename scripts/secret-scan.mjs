import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = fs.realpathSync(process.cwd());
const skippedDirs = new Set(['.git', 'node_modules', 'dist']);
const scannedExtensions = new Set(['.js', '.mjs', '.html', '.md', '.json', '.yml', '.yaml', '.conf', '.txt']);
const patterns = [
  { name: 'private_key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'generic_secret_assignment', regex: /\b(password|passwd|token|secret)\s*[:=]\s*['"][^'"\n]{12,}['"]/i }
];

const findings = [];

function trackedFiles() {
  try {
    const output = execFileSync('git', ['ls-files', '-z'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return output.split('\0').filter(Boolean).map((name) => safeRepoPath(name)).filter(Boolean);
  } catch {
    const files = [];
    walk(root, files);
    return files;
  }
}

function safeRepoPath(relativePath) {
  if (path.isAbsolute(relativePath)) return '';
  const resolved = path.resolve(root, relativePath);
  if (!isPathInside(root, resolved)) return '';
  return resolved;
}

function isPathInside(baseDir, targetPath) {
  const relative = path.relative(baseDir, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const fullPath = path.resolve(dir, entry.name);
    if (!isPathInside(root, fullPath)) continue;
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name) && !entry.isSymbolicLink()) walk(fullPath, files);
      continue;
    }
    if (!entry.isFile() || !scannedExtensions.has(path.extname(entry.name))) continue;
    files.push(fullPath);
  }
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const pattern of patterns) {
      if (pattern.regex.test(line)) {
        findings.push({
          file: path.relative(root, filePath),
          line: index + 1,
          pattern: pattern.name
        });
      }
    }
  });
}

for (const filePath of trackedFiles()) {
  if (!scannedExtensions.has(path.extname(filePath))) continue;
  scanFile(filePath);
}

if (findings.length) {
  findings.forEach((finding) => {
    console.error(`${finding.file}:${finding.line} ${finding.pattern}`);
  });
  process.exit(1);
}

console.log('secret scan ok');
