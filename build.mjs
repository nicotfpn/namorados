import { buildSync } from 'esbuild';
import { mkdirSync } from 'fs';

mkdirSync('dist', { recursive: true });

buildSync({
    entryPoints: ['js/main.js'],
    bundle: false,
    outfile: 'dist/main.min.js',
    minify: true,
});

buildSync({
    entryPoints: ['css/style.css'],
    bundle: false,
    outfile: 'dist/style.min.css',
    minify: true,
});

console.log('Build complete: dist/main.min.js, dist/style.min.css');
