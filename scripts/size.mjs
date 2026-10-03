// 束ねたときの重さ（min・gzip）を測る。
import * as esbuild from 'esbuild';
import { gzipSync } from 'node:zlib';

for (const entry of ['src/index.ts', 'src/markdown.ts']) {
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', minify: true, write: false });
  const code = r.outputFiles[0].contents;
  console.log(`${entry}: ${(code.length / 1024).toFixed(1)} KB min / ${(gzipSync(code).length / 1024).toFixed(1)} KB gzip`);
}
