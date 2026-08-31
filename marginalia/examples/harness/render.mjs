// Degradation harness: renders a markdown snippet under the parsers the
// Marginalia spec's "verified" claims were tested against.
//   npm install && node render.mjs 'SNIPPET'      (or pipe stdin)
// pandoc rows need pandoc on PATH (or PANDOC=/path/to/pandoc); they are
// skipped with a note when it is absent.
import MarkdownIt from 'markdown-it';
import mark from 'markdown-it-mark';
import footnote from 'markdown-it-footnote';
import { remark } from 'remark';
import remarkGfm from 'remark-gfm';
import remarkHtml from 'remark-html';
import { execFileSync } from 'node:child_process';

const input = process.argv[2] ?? (await import('node:fs')).readFileSync(0, 'utf8');
const PANDOC = process.env.PANDOC || 'pandoc';

function section(title, body) {
  console.log(`\n===== ${title} =====`);
  console.log(body.trim());
}

section('markdown-it (strict CommonMark-ish, no extensions)', new MarkdownIt().render(input));
section('markdown-it + mark + footnote (~Obsidian reading view)',
  new MarkdownIt().use(mark).use(footnote).render(input));
const gfmOut = await remark().use(remarkGfm).use(remarkHtml).process(input);
section('remark + gfm (~GitHub)', String(gfmOut));

for (const fmt of ['markdown', 'gfm', 'commonmark_x']) {
  try {
    const out = execFileSync(PANDOC, ['-f', fmt, '-t', 'html'], { input, encoding: 'utf8' });
    section(`pandoc -f ${fmt}`, out);
  } catch (e) {
    section(`pandoc -f ${fmt}`, `(skipped: pandoc not available — ${e.code ?? e.message})`);
  }
}
