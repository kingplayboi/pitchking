const fs = require('fs');
const path = require('path');

const CLIENT = process.env.CLIENT || 'demo';
const root = path.join(__dirname, '..');
const dir = path.join(root, 'clients', CLIENT);
const seedDir = path.join(root, 'seed');
const list = path.join(seedDir, 'catalog.txt');

if (!fs.existsSync(list)) { console.error('Create seed/catalog.txt first'); process.exit(1); }
fs.mkdirSync(path.join(dir, 'images'), { recursive: true });

const lines = fs.readFileSync(list, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const products = [];
lines.forEach((line, i) => {
  const [photo, category, name, priceRaw, colorsRaw, sizesRaw, stockRaw] = line.split('|').map((x) => x.trim());
  const price = parseInt(priceRaw, 10);
  const stock = parseInt(stockRaw === undefined ? '1' : stockRaw, 10);
  const colors = (colorsRaw || '').split('/').map((x) => x.trim()).filter(Boolean);
  const sizes = (sizesRaw || '').split(/\s+/).filter(Boolean);
  const src = path.join(seedDir, photo || '');
  if (!photo || !category || !name || !(price > 0) || !colors.length || !sizes.length || !(stock >= 0) || !fs.existsSync(src)) {
    console.error(`Skipped (check format and that the photo is in seed/): ${line}`);
    return;
  }
  const id = 's' + (i + 1);
  const ext = path.extname(photo).toLowerCase() || '.jpg';
  fs.copyFileSync(src, path.join(dir, 'images', id + ext));
  const variants = [];
  for (const color of colors) for (const size of sizes) variants.push({ size, color, stock });
  products.push({ id, category, name, price, image: 'images/' + id + ext, variants });
});

fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(products, null, 2));
console.log(`Seeded ${products.length} products for "${CLIENT}" ✅`);
