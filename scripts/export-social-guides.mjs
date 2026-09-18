#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { socialInstructions } from '../lib/social-instructions.mjs';
import { socialGuideFile } from '../lib/social-guide-files.mjs';

const output = new URL('../docs/creator-guides/', import.meta.url);
await mkdir(output, { recursive: true });
for (const platform of [undefined, ...Object.keys(socialInstructions)]) {
  const file = socialGuideFile(platform);
  await writeFile(new URL(file.filename, output), `\uFEFF${file.text}`, 'utf8');
}
console.log(`Инструкции сохранены: ${fileURLToPath(output)}`);
