/* Budget Control — jeux par defaut et icones (repris des modeles Django). */

const Seed = (function () {
  'use strict';

  const ICONS = {
    // Categories de depenses
    restaurant: '🍲', school: '🎓', family: '👪', transport: '🚌', home: '🏠',
    health: '💊', leisure: '🎉', phone: '📱', bill: '🧾', saving: '🐖', other: '📦',
    // Sources de revenus
    salary: '💼', freelance: '💻', business: '🏪', scholarship: '🎓', rent: '🏘️',
    sale: '🏷️', interest: '📈', gift: '🎁',
    // Comptes / portefeuilles
    cash: '💵', bank: '🏦', wallet: '👛',
  };

  function icon(name) { return ICONS[name] || ICONS.other; }

  const CATEGORIES = [
    ['Nourriture', '#f97316', 'restaurant'], ['Etudes', '#6366f1', 'school'],
    ['Famille', '#ec4899', 'family'], ['Transport', '#0ea5e9', 'transport'],
    ['Logement', '#14b8a6', 'home'], ['Sante', '#ef4444', 'health'],
    ['Loisirs', '#a855f7', 'leisure'], ['Communication', '#3b82f6', 'phone'],
    ['Factures', '#eab308', 'bill'], ['Epargne', '#22c55e', 'saving'],
    ['Autres', '#64748b', 'other'],
  ];

  const SOURCES = [
    ['Salaire', '#0f766e', 'salary'], ['Freelance', '#6366f1', 'freelance'],
    ['Commerce', '#f97316', 'business'], ['Bourse', '#3b82f6', 'scholarship'],
    ['Aide familiale', '#ec4899', 'family'], ['Location', '#14b8a6', 'rent'],
    ['Vente', '#eab308', 'sale'], ['Interets', '#22c55e', 'interest'],
    ['Cadeau', '#a855f7', 'gift'], ['Autres', '#64748b', 'other'],
  ];

  async function bootstrap() {
    const cats = await DB.all('categories');
    if (cats.length === 0) {
      await DB.bulkAdd('categories', CATEGORIES.map(([name, color, ic]) =>
        ({ name, color, icon: ic, archived: false })));
    }
    const srcs = await DB.all('sources');
    if (srcs.length === 0) {
      await DB.bulkAdd('sources', SOURCES.map(([name, color, ic]) =>
        ({ name, color, icon: ic, archived: false })));
    }
    if ((await DB.metaGet('currency')) == null) await DB.metaSet('currency', 'FCFA');
    if ((await DB.metaGet('threshold')) == null) await DB.metaSet('threshold', 80);
  }

  return { ICONS, icon, CATEGORIES, SOURCES, bootstrap };
})();
