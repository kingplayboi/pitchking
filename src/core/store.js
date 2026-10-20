const fs = require('fs');
const path = require('path');

const CLIENT = process.env.CLIENT || 'urban-threads';
const DIR = path.join(__dirname, '..', '..', 'clients', CLIENT);
const file = (f) => path.join(DIR, f);
const readFile = (f) => (fs.existsSync(file(f)) ? JSON.parse(fs.readFileSync(file(f), 'utf8')) : null);

const KEYS = { products: 'products.json', orders: 'orders.json' };
const defaults = () => ({ products: [], orders: { counter: 1000, orders: [] } });

let pool = null;
let shop = null;
const mem = {};
const chains = {};
const imgCache = new Map();
const UPSERT = (t, col) => `INSERT INTO ${t} (id, ${col}) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET ${col} = EXCLUDED.${col}`;

function persist(k) {
  chains[k] = (chains[k] || Promise.resolve()).then(async () => {
    try {
      if (pool) await pool.query(UPSERT('shopbot_kv', 'value') .replace('$2', '$2::jsonb'), [`${CLIENT}:${k}`, JSON.stringify(mem[k])]);
      else fs.writeFileSync(file(KEYS[k]), JSON.stringify(mem[k], null, 2));
    } catch (e) {
      console.error('Save failed:', k, e.message);
    }
  });
  return chains[k];
}

async function init() {
  shop = process.env.SHOP_CONFIG ? JSON.parse(process.env.SHOP_CONFIG) : readFile('shop.json');
  if (!shop) throw new Error(`Missing clients/${CLIENT}/shop.json`);
  const d = defaults();
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === 'off' ? false : { rejectUnauthorized: false },
    });
    await pool.query('CREATE TABLE IF NOT EXISTS shopbot_kv (id text PRIMARY KEY, value jsonb NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS shopbot_images (id text PRIMARY KEY, data bytea NOT NULL)');
    await pool.query('CREATE TABLE IF NOT EXISTS shopbot_auth (id text PRIMARY KEY, value text NOT NULL)');
    for (const k of Object.keys(KEYS)) {
      const r = await pool.query('SELECT value FROM shopbot_kv WHERE id = $1', [`${CLIENT}:${k}`]);
      if (r.rows[0]) mem[k] = r.rows[0].value;
      else {
        // first run: products start from the repo file, orders start empty
        mem[k] = (k === 'products' ? readFile(KEYS[k]) : null) || d[k];
        await persist(k);
      }
    }
    console.log(`Storage: Postgres (client ${CLIENT})`);
  } else {
    for (const k of Object.keys(KEYS)) mem[k] = readFile(KEYS[k]) || d[k];
    console.log(`Storage: local files (client ${CLIENT})`);
  }
}

async function saveImage(name, buf) {
  imgCache.set(name, buf);
  if (pool) {
    await pool.query(UPSERT('shopbot_images', 'data'), [`${CLIENT}:${name}`, buf]);
  } else {
    fs.mkdirSync(path.dirname(file(name)), { recursive: true });
    fs.writeFileSync(file(name), buf);
  }
}

async function getImage(name) {
  if (imgCache.has(name)) return imgCache.get(name);
  let buf = null;
  if (pool) {
    const r = await pool.query('SELECT data FROM shopbot_images WHERE id = $1', [`${CLIENT}:${name}`]);
    if (r.rows[0]) buf = r.rows[0].data;
  } else if (fs.existsSync(file(name))) {
    buf = fs.readFileSync(file(name));
  }
  if (buf) imgCache.set(name, buf);
  return buf;
}

module.exports = {
  CLIENT,
  init,
  getShop: () => ({ ...shop, ownerNumber: process.env.OWNER_NUMBER || shop.ownerNumber }),
  getProducts: () => mem.products,
  saveProducts(p) { mem.products = p; persist('products'); },
  createOrder(order) {
    mem.orders.counter += 1;
    const o = { ...order, id: mem.orders.counter, status: 'pending_payment', mpesaCode: null, createdAt: new Date().toISOString() };
    mem.orders.orders.push(o);
    persist('orders');
    return o;
  },
  getOrder: (id) => mem.orders.orders.find((o) => o.id === id),
  updateOrder(id, patch) {
    const o = mem.orders.orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch);
    persist('orders');
    return o;
  },
  listOrders: () => mem.orders.orders,
  findOpenOrder: (customer) => mem.orders.orders.filter((o) => o.customer === customer && o.status === 'pending_payment').pop(),
  saveImage,
  getImage,
  authStore: () => (pool ? {
    get: async (id) => {
      const r = await pool.query('SELECT value FROM shopbot_auth WHERE id = $1', [`${CLIENT}:${id}`]);
      return r.rows[0] ? r.rows[0].value : null;
    },
    set: (id, value) => pool.query(UPSERT('shopbot_auth', 'value'), [`${CLIENT}:${id}`, value]),
    del: (id) => pool.query('DELETE FROM shopbot_auth WHERE id = $1', [`${CLIENT}:${id}`]),
  } : null),
};
