import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const skippedDirs = new Set(['.git', 'node_modules', 'dist']);
const scannedExtensions = new Set(['.js', '.mjs', '.html', '.md', '.json', '.yml', '.yaml', '.conf', '.txt']);
const patterns = [
  { name: 'private_key', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'aws_access_key', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'generic_secret_assignment', regex: /\b(password|passwd|token|secret)\s*[:=]\s*['"][^'"\n]{12,}['"]/i }
];

const findings = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.gitignore') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!skippedDirs.has(entry.name)) walk(fullPath);
      continue;
    }
    if (!scannedExtensions.has(path.extname(entry.name))) continue;
    scanFile(fullPath);
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

walk(root);

if (findings.length) {
  findings.forEach((finding) => {
    console.error(`${finding.file}:${finding.line} ${finding.pattern}`);
  });
  process.exit(1);
}

console.log('secret scan ok');
