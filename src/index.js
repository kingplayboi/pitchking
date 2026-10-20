(async () => {
  const store = require('./core/store');
  await store.init();
  const shop = store.getShop();
  const { handle } = require(`./modules/${shop.module || 'retail'}`);
  console.log(`Starting "${shop.name}" with module "${shop.module || 'retail'}"`);
  await require('./core/whatsapp').start(handle);
})().catch((e) => { console.error(e); process.exit(1); });
