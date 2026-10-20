const store = require('../../core/store');
const ownerTools = require('./ownerTools');

const sessions = new Map();
const fresh = () => ({ state: 'home', cart: [], handoff: false, cat: null, idx: 0, pid: null, variants: [], name: null, area: null, address: null });
const getSession = (id) => { if (!sessions.has(id)) sessions.set(id, fresh()); return sessions.get(id); };

const kes = (n) => 'KES ' + Number(n).toLocaleString('en-US');
const inStock = (p) => p.variants.some((v) => v.stock > 0);
const categories = (products) => [...new Set(products.filter(inStock).map((p) => p.category))];
const BARGAIN = /last price|lowest price|best price|discount|bargain|negotiat|cheaper|punguza|bei ya mwisho/i;
const GREET = ['hi', 'hello', 'hey', 'menu', 'start', 'mambo', 'niaje', 'habari'];
const looksLikeMpesa = (t) => {
  const c = t.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(c) && /\d/.test(c) && /[A-Z]/.test(c);
};

const homeTextBase = (shop) =>
  `Welcome to ${shop.name}! 👋\n\n1. Browse clothes\n2. Delivery & opening hours\n3. Exchange policy\n4. Talk to us\n\nReply with a number. Type CART anytime to see your cart.`;
const homeText = (shop) => {
  const cats = categories(store.getProducts());
  const base = homeTextBase(shop);
  return cats.length ? base + '\n\nNow in stock: ' + cats.join(', ') + '. Type ALL to see everything with prices.' : base;
};
const infoText = (shop) =>
  `🚚 Delivery fees:\n${shop.areas.map((a) => `• ${a.name}: ${a.fee ? kes(a.fee) : 'free'}`).join('\n')}\n\n🕘 Open: ${shop.hours}`;
const catTextOld = (cats) =>
  `What are you shopping for?\n\n${cats.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nReply with a number.`;
const catText = (cats) => {
  const list = store.getProducts().filter(inStock);
  const rows = cats.map((c, i) => {
    const items = list.filter((p) => p.category === c);
    const from = Math.min(...items.map((p) => p.price));
    return (i + 1) + '. ' + c + ' (' + items.length + (items.length === 1 ? ' item' : ' items') + ', from ' + kes(from) + ')';
  });
  return 'What are you shopping for?\n\n' + rows.join('\n') + '\n\nReply with a number.';
};
const itemText = (p) =>
  `*${p.name}*\n${kes(p.price)}\nAvailable: ${p.variants.filter((v) => v.stock > 0).map((v) => `${v.color} ${v.size}`).join(', ')}\n\nReply ADD to pick size/colour, NEXT or PREV to browse, BACK for categories.`;

function lines(products, s) {
  return s.cart
    .map((l) => {
      const p = products.find((x) => x.id === l.productId);
      const v = p && p.variants.find((x) => x.size === l.size && x.color === l.color);
      return p && v ? { l, p, v } : null;
    })
    .filter(Boolean);
}
const subtotal = (products, s) => lines(products, s).reduce((sum, x) => sum + x.p.price * x.l.qty, 0);

function cartText(s) {
  const products = store.getProducts();
  const ls = lines(products, s);
  if (!ls.length) return 'Your cart is empty. Type MENU to start shopping.';
  const rows = ls.map((x, i) => `${i + 1}. ${x.p.name} (${x.l.color} / ${x.l.size}) x${x.l.qty} — ${kes(x.p.price * x.l.qty)}`);
  return `🛒 Your cart\n${rows.join('\n')}\n\nSubtotal: ${kes(subtotal(products, s))}\n\nReply CHECKOUT to order, CLEAR to empty it, or MENU to keep browsing.`;
}

function addToCart(s, p, v) {
  const line = s.cart.find((l) => l.productId === p.id && l.size === v.size && l.color === v.color);
  if ((line ? line.qty : 0) + 1 > v.stock) return false;
  if (line) line.qty += 1;
  else s.cart.push({ productId: p.id, size: v.size, color: v.color, qty: 1 });
  return true;
}

const showItem = (c, p) => c.send(c.from, { image: p.image, text: itemText(p) });

function handoff(c, text) {
  c.s.handoff = true;
  c.say("I'm connecting you to the owner, who'll reply here shortly. Type MENU to go back to the bot anytime.");
  return c.send(c.shop.ownerNumber, {
    text: `🙋 ${c.from} needs you: "${text}"\nReply with: reply ${c.from} your message\nHand back to bot: resume ${c.from}`,
  });
}

function askArea(c) {
  c.s.state = 'area';
  const rows = c.shop.areas.map((a, i) => `${i + 1}. ${a.name} — ${a.fee ? kes(a.fee) : 'free'}`);
  return c.say(`How would you like to receive your order?\n\n${rows.join('\n')}\n\nReply with a number.`);
}

function startCheckout(c) {
  if (!c.s.cart.length) return c.say('Your cart is empty. Type MENU to start shopping.');
  if (!c.s.name) {
    c.s.state = 'name';
    return c.say('Great! What name should we put on the order?');
  }
  return askArea(c);
}

function showConfirm(c) {
  const { s, shop } = c;
  const products = store.getProducts();
  const ls = lines(products, s);
  const sub = subtotal(products, s);
  const rows = ls.map((x) => `${x.l.qty}x ${x.p.name} (${x.l.color} / ${x.l.size}) — ${kes(x.p.price * x.l.qty)}`);
  s.state = 'confirm';
  return c.say(
    `📋 Order summary\n${rows.join('\n')}\n\n${s.area.pickup ? 'Pickup: ' + s.area.name : `Delivery: ${s.area.name} (${kes(s.area.fee)})\nAddress: ${s.address}`}\nName: ${s.name}\n\n*Total: ${kes(sub + s.area.fee)}*\n\nReply YES to confirm or NO to cancel.`
  );
}

async function placeOrder(c) {
  const { from, s, say, send, shop } = c;
  const products = store.getProducts();
  const ls = lines(products, s);

  // re-check stock; trim the cart if something sold out meanwhile
  let changed = false;
  s.cart = [];
  for (const x of ls) {
    const qty = Math.min(x.l.qty, x.v.stock);
    if (qty !== x.l.qty) changed = true;
    if (qty > 0) s.cart.push({ ...x.l, qty });
  }
  if (changed || !s.cart.length) {
    s.state = 'home';
    return say('Sorry, stock changed while you were ordering, so I updated your cart. Type CART to review it.');
  }

  const items = ls.map((x) => ({ productId: x.p.id, name: x.p.name, size: x.l.size, color: x.l.color, qty: x.l.qty, price: x.p.price }));
  const sub = items.reduce((t, i) => t + i.price * i.qty, 0);
  const order = store.createOrder({
    customer: from, name: s.name, area: s.area.name, pickup: !!s.area.pickup, address: s.address,
    items, subtotal: sub, fee: s.area.fee, total: sub + s.area.fee,
  });
  ls.forEach((x) => { x.v.stock -= x.l.qty; });
  store.saveProducts(products);
  s.cart = [];
  s.state = 'home';

  await say(`✅ Order #${order.id} placed!\n\nTotal: ${kes(order.total)}\n\n${shop.payment}\n\nWe'll confirm as soon as we verify your payment.`);
  const rows = items.map((i) => `${i.qty}x ${i.name} (${i.color} / ${i.size})`);
  return send(shop.ownerNumber, {
    text: `🆕 Order #${order.id}\n${order.name} (${from})\n${rows.join('\n')}\n${order.pickup ? 'Pickup' : `Deliver: ${order.area} — ${order.address}`}\nTotal: ${kes(order.total)}\n\nWhen paid, reply: paid ${order.id}\nTo cancel: cancel ${order.id}`,
  });
}

function restoreStock(order) {
  const products = store.getProducts();
  for (const it of order.items) {
    const p = products.find((x) => x.id === it.productId);
    const v = p && p.variants.find((x) => x.size === it.size && x.color === it.color);
    if (v) v.stock += it.qty;
  }
  store.saveProducts(products);
}

async function owner(text, send, shop, media) {
  const [cmd, ...rest] = text.trim().split(/\s+/);
  const say = (m) => send(shop.ownerNumber, { text: m });
  if (await ownerTools(cmd, rest, text, media, say)) return;
  const id = parseInt(rest[0], 10);
  const withOrder = (fn) => {
    const o = store.getOrder(id);
    return o ? fn(o) : say(`Order ${rest[0] || ''} not found.`);
  };

  switch ((cmd || '').toLowerCase()) {
    case 'orders': {
      const list = store.listOrders().slice(-10).reverse();
      if (!list.length) return say('No orders yet.');
      return say(list.map((o) => `#${o.id} ${o.name} — ${kes(o.total)} — ${o.status}${o.mpesaCode ? ' (code ' + o.mpesaCode + ')' : ''}`).join('\n'));
    }
    case 'paid':
      return withOrder(async (o) => {
        store.updateOrder(o.id, { status: 'paid' });
        await say(`Order #${o.id} marked paid ✅`);
        return send(o.customer, { text: `Payment received for order #${o.id} ✅ Thank you! We're preparing your order.` });
      });
    case 'ready':
      return withOrder(async (o) => {
        store.updateOrder(o.id, { status: 'ready' });
        await say(`Order #${o.id} marked ready.`);
        return send(o.customer, { text: o.pickup ? `Your order #${o.id} is ready for pickup! 🛍️` : `Your order #${o.id} is packed and will be dispatched shortly. 📦` });
      });
    case 'sent':
      return withOrder(async (o) => {
        store.updateOrder(o.id, { status: 'sent' });
        await say(`Order #${o.id} marked sent.`);
        return send(o.customer, { text: `Your order #${o.id} is on its way! 🚚` });
      });
    case 'cancel':
      return withOrder(async (o) => {
        if (o.status === 'cancelled') return say('Already cancelled.');
        restoreStock(o);
        store.updateOrder(o.id, { status: 'cancelled' });
        await say(`Order #${o.id} cancelled and stock restored.`);
        return send(o.customer, { text: `Your order #${o.id} was cancelled. Please contact us if you have questions.` });
      });
    case 'reply': {
      const to = rest[0];
      const msg = rest.slice(1).join(' ');
      if (!to || !msg) return say('Usage: reply <number> <message>');
      return send(to, { text: msg });
    }
    case 'resume': {
      const s = sessions.get(rest[0]);
      if (s) { s.handoff = false; s.state = 'home'; }
      await say(`Bot resumed for ${rest[0]}.`);
      return send(rest[0], { text: 'You are back with our assistant. Type MENU to continue.' });
    }
    default:
      return say('Owner commands:\norders\npaid <id>\nready <id>\nsent <id>\ncancel <id>\nreply <number> <message>\nresume <number>');
  }
}

async function handle(from, raw, send, media) {
  const text = String(raw || '').trim();
  if (!text && !media) return;
  const shop = store.getShop();
  if (from === shop.ownerNumber) return owner(text, send, shop, media);
  if (!text) return send(from, { text: 'I can only read text messages for now. Type MENU to start.' });

  const s = getSession(from);
  const t = text.toLowerCase();
  const say = (m) => send(from, typeof m === 'string' ? { text: m } : m);
  const c = { from, s, say, send, shop };

  // human has taken over: forward customer messages to the owner
  if (s.handoff) {
    if (['menu', 'bot', 'start'].includes(t)) { s.handoff = false; s.state = 'home'; return say(homeText(shop)); }
    return send(shop.ownerNumber, { text: `💬 ${from}: ${text}\n(reply with: reply ${from} your message)` });
  }

  // customer sends an M-Pesa code for an unpaid order
  const open = store.findOpenOrder(from);
  if (open && looksLikeMpesa(text)) {
    const code = text.toUpperCase();
    store.updateOrder(open.id, { mpesaCode: code });
    await say(`Thanks! We received code ${code} for order #${open.id}. We'll confirm your payment shortly. ✅`);
    return send(shop.ownerNumber, { text: `💰 Order #${open.id}: customer sent M-Pesa code ${code} (${kes(open.total)}).\nVerify it, then reply: paid ${open.id}` });
  }

  // free-text steps
  if (s.state === 'name' && t !== 'cancel') { s.name = text.slice(0, 40); return askArea(c); }
  if (s.state === 'address' && t !== 'cancel') { s.address = text.slice(0, 200); return showConfirm(c); }

  // price haggling goes to the owner
  if (BARGAIN.test(text)) return handoff(c, text);

  // global commands
  if (GREET.includes(t)) { s.state = 'home'; return say(homeText(shop)); }
  if (['all', 'catalog', 'catalogue', 'prices'].includes(t)) {
    const list = store.getProducts().filter(inStock);
    if (!list.length) return say("We're updating our stock. Check back soon!");
    const rows = categories(list).map((c) => '*' + c + '*\n' + list.filter((p) => p.category === c).map((p) => '• ' + p.name + ' — ' + kes(p.price)).join('\n'));
    return say('🛍️ What we have:\n\n' + rows.join('\n\n') + '\n\nType MENU to start shopping, or CART to see your cart.');
  }
  if (t === 'cart') return say(cartText(s));
  if (t === 'clear') { s.cart = []; s.state = 'home'; return say('Cart cleared. Type MENU to start again.'); }
  if (t === 'checkout') return startCheckout(c);
  if (t === 'cancel') { s.state = 'home'; return say('Cancelled. Your cart is saved: type CART to view it, or MENU to start over.'); }

  const products = store.getProducts();

  switch (s.state) {
    case 'home':
      switch (t) {
        case '1': {
          const cats = categories(products);
          if (!cats.length) return say("We're updating our stock. Check back soon, or type 4 to talk to us.");
          s.state = 'categories';
          return say(catText(cats));
        }
        case '2': return say(infoText(shop));
        case '3': return say(`Exchange policy:\n${shop.policy}`);
        case '4': return handoff(c, 'Customer asked to talk to you');
        default: return say(`Sorry, I didn't get that.\n\n${homeText(shop)}`);
      }

    case 'categories': {
      const cats = categories(products);
      const chosen = cats[parseInt(t, 10) - 1];
      if (!chosen) return say(`Please reply with a number from the list.\n\n${catText(cats)}`);
      s.cat = chosen; s.idx = 0; s.state = 'items';
      return showItem(c, products.filter((p) => p.category === chosen && inStock(p))[0]);
    }

    case 'items': {
      const list = products.filter((p) => p.category === s.cat && inStock(p));
      if (!list.length) { s.state = 'categories'; return say(`That section just sold out.\n\n${catText(categories(products))}`); }
      s.idx = Math.min(s.idx, list.length - 1);
      if (t === 'back') { s.state = 'categories'; return say(catText(categories(products))); }
      if (t === 'next') s.idx = (s.idx + 1) % list.length;
      else if (t === 'prev') s.idx = (s.idx - 1 + list.length) % list.length;
      else if (t === 'add') {
        const p = list[s.idx];
        s.pid = p.id;
        s.variants = p.variants.filter((v) => v.stock > 0);
        s.state = 'variant';
        const rows = s.variants.map((v, i) => `${i + 1}. ${v.color} / ${v.size} (${v.stock} left)`);
        return say(`Pick one for *${p.name}*:\n\n${rows.join('\n')}\n\nReply with a number, or BACK.`);
      } else return say('Reply ADD, NEXT, PREV or BACK. Type CART to see your cart.');
      return showItem(c, list[s.idx]);
    }

    case 'variant': {
      const p = products.find((x) => x.id === s.pid);
      if (t === 'back') { s.state = 'items'; return showItem(c, p); }
      const v = s.variants[parseInt(t, 10) - 1];
      if (!v) return say('Please reply with a number from the list, or BACK.');
      const live = p.variants.find((x) => x.size === v.size && x.color === v.color);
      if (!addToCart(s, p, live)) return say(`Sorry, only ${live.stock} of that option left and they're already in your cart.`);
      s.state = 'items';
      return say(`Added ✅ ${p.name} (${v.color} / ${v.size})\nCart subtotal: ${kes(subtotal(products, s))}\n\nReply CHECKOUT to order, NEXT to keep browsing, or CART to view.`);
    }

    case 'area': {
      const a = shop.areas[parseInt(t, 10) - 1];
      if (!a) return say('Please reply with a number from the list.');
      s.area = a;
      if (a.pickup) { s.address = null; return showConfirm(c); }
      s.state = 'address';
      return say('Please send your exact location or nearest landmark.');
    }

    case 'confirm':
      if (['yes', 'y', 'confirm'].includes(t)) return placeOrder(c);
      if (['no', 'n'].includes(t)) { s.state = 'home'; return say('No problem, order not placed. Your cart is saved: type CART to view it.'); }
      return say('Reply YES to confirm or NO to cancel.');

    default:
      s.state = 'home';
      return say(homeText(shop));
  }
}

module.exports = { handle };
