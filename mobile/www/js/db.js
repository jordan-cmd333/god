/* Budget Control — couche de stockage locale (IndexedDB).
 *
 * Aucun reseau : toutes les donnees vivent sur l'appareil. Le dataset d'un
 * budget personnel restant petit, chaque collection est chargee en memoire puis
 * filtree en JavaScript — ce qui reproduit fidelement la logique du service
 * Python d'origine, sans curseurs IndexedDB.
 */

const DB = (function () {
  'use strict';

  const NAME = 'budget-control';
  const VERSION = 2;
  const STORES = ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts', 'recurrences', 'meta'];
  let db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        for (const name of ['categories', 'sources', 'expenses', 'incomes', 'limits', 'alerts', 'recurrences']) {
          if (!d.objectStoreNames.contains(name)) {
            d.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
          }
        }
        if (!d.objectStoreNames.contains('meta')) {
          d.createObjectStore('meta', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => { db = req.result; resolve(db); };
      req.onerror = () => reject(req.error);
    });
  }

  function tx(store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function toPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function all(store) {
    await open();
    return toPromise(tx(store, 'readonly').getAll());
  }

  async function get(store, id) {
    await open();
    return toPromise(tx(store, 'readonly').get(id));
  }

  async function put(store, obj) {
    await open();
    const os = tx(store, 'readwrite');
    const id = await toPromise(os.put(obj));
    return { ...obj, id: obj.id != null ? obj.id : id };
  }

  async function add(store, obj) {
    await open();
    const os = tx(store, 'readwrite');
    const id = await toPromise(os.add(obj));
    return { ...obj, id };
  }

  async function remove(store, id) {
    await open();
    return toPromise(tx(store, 'readwrite').delete(id));
  }

  async function bulkAdd(store, objs) {
    await open();
    const os = tx(store, 'readwrite');
    for (const obj of objs) os.add(obj);
    return new Promise((resolve, reject) => {
      os.transaction.oncomplete = () => resolve();
      os.transaction.onerror = () => reject(os.transaction.error);
    });
  }

  async function clearStores(stores) {
    await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      for (const s of stores) t.objectStore(s).clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // Efface tout, y compris meta (licence, PIN, essai). A reserver a une remise a zero.
  function clearAll() { return clearStores(STORES); }

  // Efface uniquement les donnees, en preservant meta : utilise a la restauration
  // pour ne pas perdre la licence/l'essai/le PIN de l'appareil.
  function clearData() { return clearStores(STORES.filter((s) => s !== 'meta')); }

  // --- Meta (profil, code PIN) : simple cle -> valeur ---
  async function metaGet(key, fallback) {
    const row = await get('meta', key);
    return row ? row.value : fallback;
  }
  async function metaSet(key, value) {
    return put('meta', { key, value });
  }

  return { open, all, get, put, add, remove, bulkAdd, clearAll, clearData, metaGet, metaSet };
})();
