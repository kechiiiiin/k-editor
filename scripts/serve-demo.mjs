// デモを束ねて、手元で配る（http://localhost:5178/examples/）。
import * as esbuild from 'esbuild';

await esbuild.build({
  entryPoints: ['examples/demo.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'examples/demo.js',
  minify: false,
});
if (process.argv.includes('--build-only')) process.exit(0);
const ctx = await esbuild.context({});
const { port } = await ctx.serve({ servedir: '.', port: 5178 });
console.log(`http://localhost:${port}/examples/`);
