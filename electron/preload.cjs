// Bezpieczny most między stroną a systemem (contextIsolation włączone).
const { contextBridge, ipcRenderer } = require("electron");
ipcRenderer.on("autopilot:counter", (_event, counter) => {
  window.localStorage.setItem("leadfinder.sent-messages", JSON.stringify(counter));
  window.dispatchEvent(new Event("leadfinder-sent-changed"));
});

contextBridge.exposeInMainWorld("leadfinder", {
  onLeadsChanged: (cb) => {
    const h = () => cb();
    ipcRenderer.on("leads:changed", h);
    return () => ipcRenderer.removeListener("leads:changed", h);
  },
  isDesktop: true,
  autopilot: {
    snapshot: () => ipcRenderer.invoke("autopilot:snapshot"),
    configure: value => ipcRenderer.invoke("autopilot:configure", value),
    run: day => ipcRenderer.invoke("autopilot:run", day, true),
    action: (id, command) => ipcRenderer.invoke("autopilot:action", id, command),
    test: () => ipcRenderer.invoke("autopilot:test"),
    testReport: () => ipcRenderer.invoke("autopilot:testReport"),
    remoteReport: payload => ipcRenderer.invoke("autopilot:remoteReport", payload),
    onChanged: cb => { const h=()=>cb(); ipcRenderer.on("autopilot:changed",h); return ()=>ipcRenderer.removeListener("autopilot:changed",h); },
  },
  onRemoteCommand: cb => {
    const h = (_e, cmd) => cb(cmd);
    ipcRenderer.on("remote:command", h);
    return () => ipcRenderer.removeListener("remote:command", h);
  },
  platform: process.platform,
  email: {
    list:()=>ipcRenderer.invoke("email:list"),insert:rows=>ipcRenderer.invoke("email:insert",rows),
    update:(id,patch)=>ipcRenderer.invoke("email:update",id,patch),remove:id=>ipcRenderer.invoke("email:remove",id),
    blacklist:email=>ipcRenderer.invoke("email:blacklist",email),settings:()=>ipcRenderer.invoke("email:settings"),
    configure:value=>ipcRenderer.invoke("email:configure",value),test:to=>ipcRenderer.invoke("email:test",to),
    syncReplies:()=>ipcRenderer.invoke("email:syncReplies"),status:()=>ipcRenderer.invoke("email:status"),
    control:command=>ipcRenderer.invoke("email:control",command),sendBulk:(ids,consent)=>ipcRenderer.invoke("email:sendBulk",ids,consent),
    validateDeep:email=>ipcRenderer.invoke("email:validateDeep",email),
    blocked:()=>ipcRenderer.invoke("email:blocked"),
    checkDomain:(domain,selector)=>ipcRenderer.invoke("email:checkDomain",domain,selector),
    harvestByNiche:(params,cb)=>{const h=(_e,p)=>cb?.(p);ipcRenderer.on("email:progress",h);return ipcRenderer.invoke("email:harvestByNiche",params).finally(()=>ipcRenderer.removeListener("email:progress",h));},
    onChanged:cb=>{const h=()=>cb();ipcRenderer.on("email:changed",h);return ()=>ipcRenderer.removeListener("email:changed",h);},
  },

  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    set: (value) => ipcRenderer.invoke("settings:set", value),
  },

  leads: {
    list: () => ipcRenderer.invoke("leads:list"),
    insert: (rows) => ipcRenderer.invoke("leads:insert", rows),
    update: (id, patch) => ipcRenderer.invoke("leads:update", id, patch),
    remove: (id) => ipcRenderer.invoke("leads:remove", id),
    replaceAll: (rows) => ipcRenderer.invoke("leads:replaceAll", rows),
    deleteAll: () => ipcRenderer.invoke("leads:deleteAll"),
  },

  verifyPhone: (phone) => ipcRenderer.invoke("phone:verify", phone),

  domain: {
    check: (nazwa, miasto) => ipcRenderer.invoke("domain:checkAvailability", { nazwa, miasto }),
    checkBulk: (ids, onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("domain-progress", listener);
      return ipcRenderer.invoke("domain:checkBulk", ids).finally(() => ipcRenderer.removeListener("domain-progress", listener));
    },
  },

  website: {
    check: (lead) => ipcRenderer.invoke("website:check", lead),
    verifyDDG: (nazwa, miasto) =>
      ipcRenderer.invoke("website:verifyDDG", { nazwa, miasto }),
    purge(ids, onProgress) {
      const listener = (_event, data) => {
        if (onProgress) onProgress(data);
      };
      ipcRenderer.on("website-progress", listener);
      return ipcRenderer.invoke("website:purge", ids).finally(() => {
        ipcRenderer.removeListener("website-progress", listener);
      });
    },
  },

  messages: {
    historyStatus: () => ipcRenderer.invoke("messages:historyStatus"),
    syncReplies: () => ipcRenderer.invoke("messages:syncReplies"),
  },


  prefs: {
    get: () => ipcRenderer.invoke("prefs:get"),
    set: (values) => ipcRenderer.invoke("prefs:set", values),
  },

  ceidg: {
    search: (params, onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("ceidg-progress", listener);
      return ipcRenderer.invoke("ceidg:search", params).finally(() => ipcRenderer.removeListener("ceidg-progress", listener));
    },
  },

  gmaps: {
    search: (keyword, city, options) =>
      ipcRenderer.invoke("gmaps:search", { keyword, city, auditSites: options?.auditSites === true }),
  },

  olx: {
    search: (params, onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("olx-progress", listener);
      return ipcRenderer.invoke("olx:search", params).finally(() => ipcRenderer.removeListener("olx-progress", listener));
    },
  },

  // Skrzynka odpowiedzi: klasyfikacja, szkice i decyzje właściciela.
  inbox: {
    list: (filter) => ipcRenderer.invoke("inbox:list", filter),
    counts: () => ipcRenderer.invoke("inbox:counts"),
    approve: (id, body) => ipcRenderer.invoke("inbox:approve", id, body),
    dismiss: (id) => ipcRenderer.invoke("inbox:dismiss", id),
    block: (id) => ipcRenderer.invoke("inbox:block", id),
    settings: () => ipcRenderer.invoke("inbox:settings"),
    configure: (value) => ipcRenderer.invoke("inbox:configure", value),
    testAi: () => ipcRenderer.invoke("inbox:testAi"),
    onChanged: (cb) => { const h = () => cb(); ipcRenderer.on("inbox:changed", h); return () => ipcRenderer.removeListener("inbox:changed", h); },
  },

  // Baza danych: stan, kopie zapasowe i dziennik zdarzeń leada.
  store: {
    status: () => ipcRenderer.invoke("store:status"),
    backup: () => ipcRenderer.invoke("store:backup"),
    openBackups: () => ipcRenderer.invoke("store:openBackups"),
    events: (kind, id) => ipcRenderer.invoke("store:events", kind, id),
  },

  // Rozpoznanie rynku: liczba firm z Census, próbki z Map i wyniki kampanii.
  market: {
    settings: () => ipcRenderer.invoke("market:settings"),
    configure: (value) => ipcRenderer.invoke("market:configure", value),
    test: () => ipcRenderer.invoke("market:test"),
    ranking: (filter) => ipcRenderer.invoke("market:ranking", filter),
    refresh: (onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("market-progress", listener);
      return ipcRenderer.invoke("market:refresh").finally(() => ipcRenderer.removeListener("market-progress", listener));
    },
    probe: (payload, onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("sniper-progress", listener);
      return ipcRenderer.invoke("market:probe", payload).finally(() => ipcRenderer.removeListener("sniper-progress", listener));
    },
  },

  // Wirtualny świat: sprawdzian programu bez prawdziwej wysyłki.
  simulation: {
    run: (seed) => ipcRenderer.invoke("simulation:run", seed),
  },

  // Snajper Top 50: Mapy/OLX/CEIDG + audyt HTTP/TLS/DOM + wolne domeny .pl.
  sniper: {
    runDeepScan: (params, onProgress) => {
      const listener = (_e, data) => { if (onProgress) onProgress(data); };
      ipcRenderer.on("sniper-progress", listener);
      return ipcRenderer.invoke("sniper:runDeepScan", params).finally(() => ipcRenderer.removeListener("sniper-progress", listener));
    },
  },

  blacklist: {
    add: (phone) => ipcRenderer.invoke("blacklist:add", phone),
    getAll: () => ipcRenderer.invoke("blacklist:getAll"),
  },
  cache: {
    stats: () => ipcRenderer.invoke("cache:stats"),
    clear: () => ipcRenderer.invoke("cache:clear"),
  },

  enrich: (url) => ipcRenderer.invoke("enrich:fetch", url),

  /**
   * items: [{ id, phone, body }]
   * onProgress: ({ index, total, id, ok, error? }) => void
   */
  sendBulk(items, onProgress, options) {
    const listener = (_event, data) => {
      if (onProgress) onProgress(data);
    };
    ipcRenderer.on("bulk-progress", listener);
    return ipcRenderer.invoke("bulk-send", items, options).finally(() => {
      ipcRenderer.removeListener("bulk-progress", listener);
    });
  },
  cancelBulk() {
    ipcRenderer.send("bulk-cancel");
  },
  pauseBulk() {
    return ipcRenderer.invoke("messages:pauseBulk");
  },
  resumeBulk() {
    return ipcRenderer.invoke("messages:resumeBulk");
  },
  bulkStatus() {
    return ipcRenderer.invoke("messages:bulkStatus");
  },
  setSpeedConfig(config) {
    return ipcRenderer.invoke("messages:setSpeedConfig", config);
  },

  widget: {
    show: () => ipcRenderer.invoke("widget:show"),
    getStats: () => ipcRenderer.invoke("widget:getStats"),
    openMain: () => ipcRenderer.invoke("widget:openMain"),
  },
});
