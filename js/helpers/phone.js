(function (Helpers) {
  const getRandomInt = Helpers.getRandomInt;
  const getRandomItem = Helpers.getRandomItem;
  const padNumber = Helpers.padNumber;

  /**
   * @typedef {Object} PhonePrefix
   * @property {string} code
   * @property {readonly string[] | null} firstDigits
   */

  /**
   * @typedef {Object} PhoneProvider
   * @property {string} id
   * @property {string} name
   * @property {readonly PhonePrefix[]} prefixes
   */

  /** @type {readonly PhoneProvider[]} */
  const PHONE_PROVIDERS = Object.freeze([
    {
      id: "a1",
      name: "A1",
      prefixes: Object.freeze([
        { code: "29", firstDigits: Object.freeze(["1", "3", "6", "9"]) },
        { code: "44", firstDigits: null },
      ]),
    },
    {
      id: "mts",
      name: "МТС",
      prefixes: Object.freeze([
        { code: "29", firstDigits: Object.freeze(["2", "5", "7", "8"]) },
        { code: "33", firstDigits: null },
      ]),
    },
    {
      id: "life",
      name: "life:)",
      prefixes: Object.freeze([
        { code: "25", firstDigits: null },
      ]),
    },
  ]);

  /**
   * Собирает 7 цифр абонентского номера.
   * @param {PhonePrefix} prefix
   * @returns {string}
   */
  function generateSubscriber(prefix) {
    const tail = padNumber(getRandomInt(0, 999999), 6);

    if (prefix.firstDigits === null) {
      const firstDigit = String(getRandomInt(0, 9));
      return `${firstDigit}${tail}`;
    }

    return `${getRandomItem(prefix.firstDigits)}${tail}`;
  }

  /**
   * Форматирует номер в нескольких общепринятых видах.
   * @param {string} operatorCode
   * @param {string} subscriber
   * @returns {{ international: string, national: string, e164: string, digits: string }}
   */
  function formatPhone(operatorCode, subscriber) {
    const grouped = `${subscriber.slice(0, 3)}-${subscriber.slice(3, 5)}-${subscriber.slice(5)}`;

    return {
      international: `+375 ${operatorCode} ${grouped}`,
      national: `8 (0${operatorCode}) ${grouped}`,
      e164: `+375${operatorCode}${subscriber}`,
      digits: `375${operatorCode}${subscriber}`,
    };
  }

  /**
   * Генерирует тестовый белорусский мобильный номер.
   * @param {{ provider?: string }} [options]
   * @returns {{ provider: string, international: string, national: string, e164: string, digits: string }}
   */
  function generatePhone(options = {}) {
    const selectedId = options.provider || "any";
    const provider =
      selectedId === "any"
        ? getRandomItem(PHONE_PROVIDERS)
        : PHONE_PROVIDERS.find((item) => item.id === selectedId);

    if (!provider) {
      throw new Error(`Неизвестный оператор: ${selectedId}`);
    }

    const prefix = getRandomItem(provider.prefixes);
    const subscriber = generateSubscriber(prefix);
    const formatted = formatPhone(prefix.code, subscriber);

    return {
      provider: provider.name,
      ...formatted,
    };
  }

  /** @type {import("./types.js").HelperDefinition} */
  const phoneHelper = {
    id: "phone",
    title: "Телефон РБ",
    description:
      "Тестовые мобильные номера белорусских операторов A1, МТС и life:) в международных и национальных форматах.",
    fields: [
      {
        name: "provider",
        type: "select",
        label: "Оператор",
        defaultValue: "any",
        options: [
          { value: "any", label: "Любой" },
          { value: "a1", label: "A1" },
          { value: "mts", label: "МТС" },
          { value: "life", label: "life:)" },
        ],
      },
    ],
    resultFields: [
      { key: "provider", label: "Оператор" },
      { key: "international", label: "Международный" },
      { key: "national", label: "Национальный" },
      { key: "e164", label: "E.164" },
      { key: "digits", label: "Только цифры" },
    ],
    generate: (values) => generatePhone({ provider: values.provider }),
  };

  Helpers.generatePhone = generatePhone;
  Helpers.phoneHelper = phoneHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
