const fs = require('fs');
const path = require('path');
const store = require('../../core/store');

const kes = (n) => 'KES ' + Number(n).toLocaleString('en-US');

const ADD_USAGE =
  'To add a product, send a photo with this caption:\nadd Category | Name | Price | Colours | Sizes | Stock\n\nExample:\nadd Women | Floral Dress | 2500 | Red/Blue | S M L | 3';

const HELP = `Owner commands:
orders
paid <id>  ready <id>  sent <id>  cancel <id>
reply <number> <message>
resume <number>

Products:
products — list with ids and stock
price <id> <new price>
restock <id> <qty> — sets every size/colour
soldout <id>
remove <id>

${ADD_USAGE}

Change a photo: send it with caption
photo <id>`;

const nextId = (products) => {
  let n = products.length + 1;
  while (products.some((p) => p.id === 'p' + n)) n++;
  return 'p' + n;
};

async function savePhoto(media, id) {
  const buf = await media.getBuffer();
  const name = 'images/' + id + '.jpg';
  await store.saveImage(name, buf);
  return name;
}

// returns true if it handled the message
module.exports = async function ownerTools(cmd, rest, text, media, say) {
  const c = (cmd || '').toLowerCase();
  const products = store.getProducts();
  const find = (x) => products.find((p) => p.id.toLowerCase() === String(x || '').toLowerCase());

  if (c === 'help') { await say(HELP); return true; }

  if (media && c === 'add') {
    const [catRaw, name, priceRaw, colorsRaw, sizesRaw, stockRaw] = text.replace(/^add\s*/i, '').split('|').map((s) => s.trim());
    const price = parseInt(priceRaw, 10);
    const stock = parseInt(stockRaw === undefined ? '1' : stockRaw, 10);
    const colors = (colorsRaw || '').split('/').map((s) => s.trim()).filter(Boolean);
    const sizes = (sizesRaw || '').split(/\s+/).filter(Boolean);
    if (!catRaw || !name || !(price > 0) || !colors.length || !sizes.length || !(stock >= 0)) {
      await say('Could not read that caption.\n\n' + ADD_USAGE);
      return true;
    }
    const existing = products.find((p) => p.category.toLowerCase() === catRaw.toLowerCase());
    const category = existing ? existing.category : catRaw.charAt(0).toUpperCase() + catRaw.slice(1);
    const id = nextId(products);
    const image = await savePhoto(media, id);
    const variants = [];
    for (const color of colors) for (const size of sizes) variants.push({ size, color, stock });
    products.push({ id, category, name, price, image, variants });
    store.saveProducts(products);
    await say(`✅ Added ${id}: ${name} (${category}) — ${kes(price)}\n${variants.length} options, ${stock} each.`);
    return true;
  }

  if (media && c === 'photo') {
    const p = find(rest[0]);
    if (!p) { await say('Product not found. Type products to see ids.'); return true; }
    p.image = await savePhoto(media, p.id);
    store.saveProducts(products);
    await say(`📷 Photo updated for ${p.id}: ${p.name}`);
    return true;
  }

  if (media) { await say('Got the photo, but I need a caption.\n\n' + ADD_USAGE); return true; }
  if (c === 'add') { await say('Send it together with a photo.\n\n' + ADD_USAGE); return true; }

  if (c === 'products') {
    if (!products.length) { await say('No products yet.\n\n' + ADD_USAGE); return true; }
    const rows = products.map((p) => `${p.id} — ${p.name} — ${kes(p.price)} — ${p.variants.reduce((t, v) => t + v.stock, 0)} in stock`);
    await say(rows.join('\n'));
    return true;
  }

  if (c === 'price') {
    const p = find(rest[0]);
    const price = parseInt(rest[1], 10);
    if (!p || !(price > 0)) { await say('Usage: price <id> <new price>'); return true; }
    p.price = price;
    store.saveProducts(products);
    await say(`${p.name} is now ${kes(price)}.`);
    return true;
  }

  if (c === 'restock') {
    const p = find(rest[0]);
    const qty = parseInt(rest[1], 10);
    if (!p || !(qty >= 0)) { await say('Usage: restock <id> <qty>'); return true; }
    p.variants.forEach((v) => { v.stock = qty; });
    store.saveProducts(products);
    await say(`${p.name}: every option set to ${qty} in stock.`);
    return true;
  }

  if (c === 'soldout') {
    const p = find(rest[0]);
    if (!p) { await say('Usage: soldout <id>'); return true; }
    p.variants.forEach((v) => { v.stock = 0; });
    store.saveProducts(products);
    await say(`${p.name} marked sold out.`);
    return true;
  }

  if (c === 'remove') {
    const p = find(rest[0]);
    if (!p) { await say('Usage: remove <id>'); return true; }
    store.saveProducts(products.filter((x) => x.id !== p.id));
    await say(`${p.name} removed.`);
    return true;
  }

  return false;
};
