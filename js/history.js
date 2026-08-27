(function (Helpers) {
  const STORAGE_KEY = "helpers.copiedHistory";
  const MAX_ITEMS = 40;

  /**
   * @typedef {Object} HistoryItem
   * @property {string} id
   * @property {string} helperId
   * @property {string} title
   * @property {number} copiedAt
   * @property {Record<string, string>} data
   */

  /**
   * Ключ для дедупликации одинаковых результатов.
   * @param {string} helperId
   * @param {Record<string, string>} data
   * @returns {string}
   */
  function getIdentity(helperId, data) {
    if (helperId === "passport") {
      return `passport:${data.personalNumber ?? ""}`;
    }

    if (helperId === "phone") {
      return `phone:${data.e164 ?? data.digits ?? ""}`;
    }

    if (helperId === "unp") {
      return `unp:${data.selfEmployed ?? ""}:${data.individualEntrepreneur ?? ""}`;
    }

    return `${helperId}:${JSON.stringify(data)}`;
  }

  /**
   * @returns {HistoryItem[]}
   */
  function loadHistory() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);

      if (!raw) {
        return [];
      }

      const parsed = JSON.parse(raw);

      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed;
    } catch (error) {
      return [];
    }
  }

  /**
   * @param {HistoryItem[]} items
   * @returns {void}
   */
  function persistHistory(items) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  /**
   * Добавляет полный результат генератора в историю копирования.
   * @param {string} helperId
   * @param {string} title
   * @param {Record<string, string>} data
   * @returns {HistoryItem[]}
   */
  function addHistoryItem(helperId, title, data) {
    const identity = getIdentity(helperId, data);
    const withoutCurrent = loadHistory().filter((item) => getIdentity(item.helperId, item.data) !== identity);
    /** @type {HistoryItem} */
    const item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      helperId,
      title,
      copiedAt: Date.now(),
      data: { ...data },
    };
    const items = [item, ...withoutCurrent].slice(0, MAX_ITEMS);
    persistHistory(items);

    return items;
  }

  /**
   * @param {string} id
   * @returns {HistoryItem[]}
   */
  function removeHistoryItem(id) {
    const items = loadHistory().filter((item) => item.id !== id);
    persistHistory(items);

    return items;
  }

  /**
   * @returns {HistoryItem[]}
   */
  function clearHistory() {
    persistHistory([]);
    return [];
  }

  Helpers.historyStore = {
    load: loadHistory,
    add: addHistoryItem,
    remove: removeHistoryItem,
    clear: clearHistory,
  };
})(globalThis.Helpers = globalThis.Helpers || {});
