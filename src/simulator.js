const readline = require('readline');
const store = require('./core/store');

(async () => {
  await store.init();
  const shop = store.getShop();
  const { handle } = require(`./modules/${shop.module || 'retail'}`);
  let customer = '254711111111';

  const send = async (to, m) => {
    const who = to === shop.ownerNumber ? '📱 OWNER' : `🤖 BOT → ${to}`;
    console.log(`\n${who}`);
    if (m.image) console.log(`   [📷 ${m.image}]`);
    console.log(m.text.split('\n').map((l) => '   ' + l).join('\n'));
  };

  console.log(`ShopBot simulator — ${shop.name}`);
  console.log(`You are customer ${customer}`);
  console.log('  o: <command>   speak as the owner (e.g. o: orders)');
  console.log('  /as <number>   switch customer     /quit   exit\n');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.setPrompt('you> ');
  rl.prompt();
  for await (const line of rl) {
    const input = line.trim();
    if (input === '/quit') break;
    if (input.startsWith('/as ')) {
      customer = input.slice(4).trim();
      console.log(`Now chatting as ${customer}`);
    } else if (/^o:/i.test(input)) {
      await handle(shop.ownerNumber, input.slice(2), send);
    } else if (input) {
      await handle(customer, input, send);
    }
    rl.prompt();
  }
  rl.close();
  process.exit(0);
})();
