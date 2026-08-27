(function (Helpers) {
  /**
   * Возвращает случайное целое в диапазоне [min, max].
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * Возвращает случайный элемент массива.
   * @template T
   * @param {readonly T[]} items
   * @returns {T}
   */
  function getRandomItem(items) {
    return items[getRandomInt(0, items.length - 1)];
  }

  /**
   * Дополняет число ведущими нулями.
   * @param {number} value
   * @param {number} length
   * @returns {string}
   */
  function padNumber(value, length) {
    return String(value).padStart(length, "0");
  }

  Helpers.getRandomInt = getRandomInt;
  Helpers.getRandomItem = getRandomItem;
  Helpers.padNumber = padNumber;
})(globalThis.Helpers = globalThis.Helpers || {});
