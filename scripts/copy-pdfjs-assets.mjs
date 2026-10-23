// Copies pdf.js CMaps and standard fonts into public/ so thumbnails render
// correctly (CJK / non-embedded fonts) without fetching from a third-party CDN.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pdfjsRoot = dirname(require.resolve('pdfjs-dist/package.json'));
const outRoot = join(process.cwd(), 'public', 'pdfjs');

mkdirSync(outRoot, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts']) {
  const src = join(pdfjsRoot, dir);
  if (!existsSync(src)) throw new Error(`Missing ${src}`);
  cpSync(src, join(outRoot, dir), { recursive: true });
}
console.log('pdf.js assets copied to public/pdfjs');
