// Gera os ícones do app instalável (celular) em public/icons a partir de build/icon.svg.
import sharp from 'sharp';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const svg = readFileSync(new URL('../build/icon.svg', import.meta.url), 'utf8');
// Versão sem cantos arredondados (o iPhone e o Android arredondam sozinhos).
const square = svg.replace(/<rect width="512" height="512" rx="116"/, '<rect width="512" height="512" rx="0"');
const out = (name) => new URL(`../public/icons/${name}`, import.meta.url);
mkdirSync(new URL('../public/icons/', import.meta.url), { recursive: true });

const render = (source, size) => sharp(Buffer.from(source), { density: 384 }).resize(size, size).png().toBuffer();
writeFileSync(out('icon-192.png'), await render(svg, 192));
writeFileSync(out('icon-512.png'), await render(svg, 512));
writeFileSync(out('apple-touch-icon.png'), await render(square, 180));
// Maskable: o desenho ocupa só 70% do centro, o resto é amarelo cheio.
const inner = await render(svg, 360);
writeFileSync(
  out('maskable-512.png'),
  await sharp({ create: { width: 512, height: 512, channels: 4, background: '#FFC72C' } }).composite([{ input: inner, left: 76, top: 76 }]).png().toBuffer(),
);
console.log('Ícones do app de celular gerados em public/icons');
