(function (Helpers) {
  /**
   * Реестр хелперов. Новый генератор подключается сюда.
   * @type {readonly import("./types.js").HelperDefinition[]}
   */
  const helpers = Object.freeze([
    Helpers.passportHelper,
    Helpers.phoneHelper,
    Helpers.unpHelper,
    Helpers.ibanHelper,
  ]);

  /**
   * Возвращает хелпер по идентификатору.
   * @param {string} id
   * @returns {import("./types.js").HelperDefinition | undefined}
   */
  function getHelperById(id) {
    return helpers.find((helper) => helper.id === id);
  }

  Helpers.helpers = helpers;
  Helpers.getHelperById = getHelperById;
})(globalThis.Helpers = globalThis.Helpers || {});
