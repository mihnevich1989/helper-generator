(function (Helpers) {
  const getRandomInt = Helpers.getRandomInt;
  const getRandomItem = Helpers.getRandomItem;
  const padNumber = Helpers.padNumber;

  /**
   * @typedef {Object} UnpRegion
   * @property {string} code
   * @property {string} name
   * @property {number} personValue
   * @property {number} organizationDigit
   */

  /**
   * @typedef {Object} UnpData
   * @property {string} selfEmployed
   * @property {string} individualEntrepreneur
   */

  const CHECK_DIGIT_WEIGHTS = Object.freeze([29, 23, 19, 17, 13, 7, 5, 3]);
  const MAX_CHECK_ATTEMPTS = 32;
  const SECOND_DIGIT_LETTERS = Object.freeze(["A", "B", "C", "E", "H", "K", "M", "O", "P", "T"]);

  /** @type {readonly UnpRegion[]} */
  const UNP_REGIONS = Object.freeze([
    { code: "A", name: "Минск", personValue: 10, organizationDigit: 1 },
    { code: "B", name: "Брестская область", personValue: 11, organizationDigit: 2 },
    { code: "C", name: "Витебская область", personValue: 12, organizationDigit: 3 },
    { code: "E", name: "Гомельская область", personValue: 14, organizationDigit: 4 },
    { code: "H", name: "Гродненская область", personValue: 17, organizationDigit: 5 },
    { code: "K", name: "Минская область", personValue: 20, organizationDigit: 6 },
    { code: "M", name: "Могилёвская область", personValue: 22, organizationDigit: 7 },
  ]);

  /**
   * @param {string} code
   * @returns {UnpRegion | undefined}
   */
  function getRegionByCode(code) {
    return UNP_REGIONS.find((region) => region.code === code);
  }

  /**
   * Контрольная цифра УНП: сумма произведений на веса по модулю 11.
   * @param {readonly number[]} digitValues
   * @returns {number}
   */
  function calculateUnpCheckDigit(digitValues) {
    const weightedSum = digitValues.reduce((sum, digit, index) => {
      return sum + digit * CHECK_DIGIT_WEIGHTS[index];
    }, 0);

    return weightedSum % 11;
  }

  /**
   * Выбирает регион по значению формы.
   * @param {string | undefined} requestedCode
   * @returns {UnpRegion}
   */
  function resolveRegion(requestedCode) {
    const selected = requestedCode ? getRegionByCode(requestedCode) : undefined;

    return selected ?? getRandomItem(UNP_REGIONS);
  }

  /**
   * Генерирует УНП физлица: X1X2XXXXXК, где X1 и X2 — латинские буквы.
   * @param {string | undefined} regionCode
   * @returns {string}
   */
  function generatePhysicalUnp(regionCode) {
    const region = resolveRegion(regionCode);

    for (let attempt = 0; attempt < MAX_CHECK_ATTEMPTS; attempt += 1) {
      const serial = padNumber(getRandomInt(0, 9999999), 7);
      const serialDigits = serial.split("").map((symbol) => Number(symbol));
      const checkDigit = calculateUnpCheckDigit([region.personValue, ...serialDigits]);

      if (checkDigit === 10) {
        continue;
      }

      const secondLetter = SECOND_DIGIT_LETTERS[serialDigits[0]];
      const serialTail = serial.slice(1);

      return `${region.code}${secondLetter}${serialTail}${checkDigit}`;
    }

    throw new Error("Не удалось сформировать УНП. Повторите генерацию.");
  }

  /**
   * Генерирует УНП ИП: 9 цифр, как регистрационный номер в ЕГР.
   * @param {string | undefined} regionCode
   * @returns {string}
   */
  function generateNumericUnp(regionCode) {
    const region = resolveRegion(regionCode);

    for (let attempt = 0; attempt < MAX_CHECK_ATTEMPTS; attempt += 1) {
      const serial = padNumber(getRandomInt(0, 9999999), 7);
      const serialDigits = serial.split("").map((symbol) => Number(symbol));
      const checkDigit = calculateUnpCheckDigit([region.organizationDigit, ...serialDigits]);

      if (checkDigit === 10) {
        continue;
      }

      return `${region.organizationDigit}${serial}${checkDigit}`;
    }

    throw new Error("Не удалось сформировать УНП. Повторите генерацию.");
  }

  /**
   * Генерирует пару тестовых УНП: самозанятый и ИП.
   * @param {{ region?: string }} [options]
   * @returns {UnpData}
   */
  function generateUnp(options = {}) {
    const regionCode = options.region && options.region !== "any" ? options.region : undefined;

    return {
      selfEmployed: generatePhysicalUnp(regionCode),
      individualEntrepreneur: generateNumericUnp(regionCode),
    };
  }

  /** @type {import("./types.js").HelperDefinition} */
  const unpHelper = {
    id: "unp",
    title: "УНП РБ",
    description:
      "Самозанятый — буквенно-цифровой УНП физлица. ИП — 9 цифр, как регистрационный номер в ЕГР. Контрольная цифра по схеме 29-23-19-17-13-7-5-3.",
    fields: [
      {
        name: "region",
        type: "select",
        label: "Регион",
        defaultValue: "any",
        options: [
          { value: "any", label: "Любой" },
          ...UNP_REGIONS.map((region) => ({ value: region.code, label: region.name })),
        ],
      },
    ],
    resultFields: [
      { key: "selfEmployed", label: "Самозанятый" },
      { key: "individualEntrepreneur", label: "ИП" },
    ],
    generate: (values) => generateUnp({ region: values.region }),
  };

  Helpers.calculateUnpCheckDigit = calculateUnpCheckDigit;
  Helpers.generatePhysicalUnp = generatePhysicalUnp;
  Helpers.generateNumericUnp = generateNumericUnp;
  Helpers.generateUnp = generateUnp;
  Helpers.unpHelper = unpHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
