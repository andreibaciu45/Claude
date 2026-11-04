import { it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
vi.mock('../engine', async () => { const m = await import('./_mockengine'); return m; });
import { generateDocumentPdf } from './index';
import { fakeDoc, fakeProfile } from './fixtures';
it('visual', async () => {
  const w = async (n: string, b: Blob) => writeFileSync('/tmp/claude-0/-home-user-Claude/8fc4f0b9-20f9-5afc-b363-9dc24a1720ed/scratchpad/' + n, Buffer.from(await b.arrayBuffer()));
  await w('q.pdf', await generateDocumentPdf(fakeDoc(), fakeProfile()));
  await w('f.pdf', await generateDocumentPdf(fakeDoc({ type: 'fattura', number: 'FT-0001' }), fakeProfile({ regimeForfettario: true })));
  await w('m.pdf', await generateDocumentPdf(fakeDoc({}, 40), fakeProfile()));
});
