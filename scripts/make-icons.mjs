// Gera build/icon.png e build/icon.ico a partir de build/icon.svg.
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { readFileSync, writeFileSync } from 'node:fs';

const svg = readFileSync(new URL('../build/icon.svg', import.meta.url));
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png().toBuffer();

writeFileSync(new URL('../build/icon.png', import.meta.url), await png(512));
const sizes = await Promise.all([256, 128, 64, 48, 32, 16].map(png));
writeFileSync(new URL('../build/icon.ico', import.meta.url), await pngToIco(sizes));
console.log('Ícones gerados em build/');
