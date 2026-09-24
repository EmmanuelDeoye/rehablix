// Minimal fake Firebase compat SDK for browser-harness verification only.
(function () {
  const dbTree = {};
  const listeners = {}; // path -> [{event, cb}]

  function getAtPath(path) {
    const parts = path.split('/').filter(Boolean);
    let node = dbTree;
    for (const p of parts) {
      if (node == null) return undefined;
      node = node[p];
    }
    return node;
  }
  function setAtPath(path, value) {
    const parts = path.split('/').filter(Boolean);
    let node = dbTree;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (typeof node[p] !== 'object' || node[p] === null) node[p] = {};
      node = node[p];
    }
    if (parts.length === 0) return;
    node[parts[parts.length - 1]] = value;
  }
  function updateAtPath(path, patch) {
    const existing = getAtPath(path);
    const merged = Object.assign({}, typeof existing === 'object' && existing ? existing : {}, patch);
    setAtPath(path, merged);
  }
  function fireListeners(path) {
    // Fire listeners on this exact path AND any ancestor path (RTDB semantics:
    // a write to a child notifies value listeners on parents too).
    Object.keys(listeners).forEach((lp) => {
      if (path === lp || path.startsWith(lp + '/') || lp === '') {
        const val = getAtPath(lp);
        (listeners[lp] || []).forEach(({ cb }) => {
          try { cb({ val: () => val, exists: () => val !== undefined, key: lp.split('/').filter(Boolean).pop() || null }); } catch (e) { console.error(e); }
        });
      }
    });
  }

  function makeQuery(path, filterFn) {
    return {
      once: async () => {
        let val = getAtPath(path);
        if (filterFn && val && typeof val === 'object') val = filterFn(val);
        return { val: () => val, exists: () => val !== undefined, forEach: (fn) => Object.keys(val || {}).forEach(k => fn({ key: k, val: () => val[k] })) };
      },
      on: (event, cb) => {
        listeners[path] = listeners[path] || [];
        listeners[path].push({ event, cb });
        const val = getAtPath(path);
        Promise.resolve().then(() => cb({ val: () => val, exists: () => val !== undefined }));
        return cb;
      },
      off: () => { delete listeners[path]; },
      orderByChild: () => makeQuery(path, filterFn),
      orderByKey: () => makeQuery(path, filterFn),
      equalTo: () => makeQuery(path, filterFn),
      limitToLast: () => makeQuery(path, filterFn),
    };
  }

  function ref(path) {
    const q = makeQuery(path);
    return Object.assign(q, {
      key: path.split('/').filter(Boolean).pop() || null,
      set: async (v) => { setAtPath(path, v); fireListeners(path); },
      update: async (v) => { updateAtPath(path, v); fireListeners(path); },
      push: (value) => {
        const key = 'k' + Math.random().toString(36).slice(2);
        const writeDone = value !== undefined ? ref(path + '/' + key).set(value) : Promise.resolve();
        const resolvedRef = { key };
        const childRef = ref(path + '/' + key);
        childRef.key = key;
        childRef.then = (onFulfilled, onRejected) => writeDone.then(() => onFulfilled(resolvedRef), onRejected);
        return childRef;
      },
      remove: async () => { setAtPath(path, null); fireListeners(path); },
    });
  }

  let currentUser = null;
  const authListeners = [];

  window.firebase = {
    initializeApp: () => {},
    auth: Object.assign(() => ({
      currentUser,
      onAuthStateChanged: (cb) => { authListeners.push(cb); Promise.resolve().then(() => cb(currentUser)); return () => {}; },
      setPersistence: async () => {},
      signOut: async () => { currentUser = null; authListeners.forEach((cb) => cb(null)); },
    }), {
      Auth: { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } },
      GoogleAuthProvider: function () {},
    }),
    database: () => ({ ref }),
    __seed: (path, value) => setAtPath(path, value),
    __setUser: (user) => {
      currentUser = user;
      authListeners.forEach((cb) => cb(user));
    },
  };
  window.firebase.database.ServerValue = { TIMESTAMP: Date.now(), increment: (n) => ({ __isIncrement: true, __delta: n }) };
})();
