// Keeps the WhatsApp login in Postgres so Heroku restarts don't log you out
module.exports = async function dbAuthState(auth, { BufferJSON, initAuthCreds, proto }) {
  const write = (value, id) => auth.set(id, JSON.stringify(value, BufferJSON.replacer));
  const read = async (id) => {
    const v = await auth.get(id);
    return v ? JSON.parse(v, BufferJSON.reviver) : null;
  };
  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            data[id] = v;
          }));
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const cat of Object.keys(data)) {
            for (const id of Object.keys(data[cat])) {
              const v = data[cat][id];
              tasks.push(v ? write(v, `${cat}-${id}`) : auth.del(`${cat}-${id}`));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write(creds, 'creds'),
  };
};
