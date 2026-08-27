(function (Helpers) {
  const getRandomInt = Helpers.getRandomInt;
  const getRandomItem = Helpers.getRandomItem;
  const padNumber = Helpers.padNumber;

  /**
   * @typedef {Object} BelarusBank
   * @property {string} id
   * @property {string} name
   * @property {string} bic
   */

  /**
   * @typedef {Object} IbanAccountType
   * @property {string} id
   * @property {string} label
   * @property {string} balance
   */

  /**
   * @typedef {Object} IbanCurrency
   * @property {string} id
   * @property {string} label
   * @property {string} numericCode
   */

  /**
   * @typedef {Object} IbanData
   * @property {string} bank
   * @property {string} bic
   * @property {string} iban
   * @property {string} ibanFormatted
   * @property {string} accountType
   * @property {string} currency
   */

  const COUNTRY_CODE = "BY";
  const LETTER_DIGIT_OFFSET = 55;
  const IBAN_PATTERN = /^BY\d{2}[A-Z0-9]{4}\d{4}[A-Z0-9]{16}$/;

  /** @type {readonly BelarusBank[]} */
  const BELARUS_BANKS = Object.freeze([
    { id: "alfa", name: "Альфа-Банк", bic: "ALFABY2X" },
    { id: "belveb", name: "Банк БелВЭБ", bic: "BELBBY2X" },
    { id: "vtb", name: "Банк ВТБ (Беларусь)", bic: "SLANBY22" },
    { id: "dabrabyt", name: "Банк Дабрабыт", bic: "MMBNBY22" },
    { id: "development", name: "Банк развития РБ", bic: "BRRBBY2X" },
    { id: "reshenie", name: "Банк «Решение»", bic: "RSHNBY2X" },
    { id: "belagroprom", name: "Белагропромбанк", bic: "BAPBBY2X" },
    { id: "belarusbank", name: "Беларусбанк", bic: "AKBBBY2X" },
    { id: "belgazprom", name: "Белгазпромбанк", bic: "OLMPBY2X" },
    { id: "belinvest", name: "Белинвестбанк", bic: "BLBBBY2X" },
    { id: "bnb", name: "БНБ-Банк", bic: "BLNBBY2X" },
    { id: "bsb", name: "БСБ Банк", bic: "UNBSBY2X" },
    { id: "mtbank", name: "МТБанк", bic: "MTBKBY22" },
    { id: "neoasia", name: "Нео Банк Азия", bic: "AEBKBY2X" },
    { id: "paritet", name: "Паритетбанк", bic: "POISBY2X" },
    { id: "prior", name: "Приорбанк", bic: "PJCBBY2X" },
    { id: "rrb", name: "РРБ-Банк", bic: "REDJBY22" },
    { id: "sber", name: "Сбер Банк", bic: "BPSBBY2X" },
    { id: "status", name: "СтатусБанк", bic: "IRJSBY22" },
    { id: "tk", name: "ТК Банк", bic: "BBTKBY2X" },
    { id: "techno", name: "Технобанк", bic: "TECNBY22" },
    { id: "zepter", name: "Цептер Банк", bic: "ZEPTBY2X" },
  ]);

  /** @type {readonly IbanAccountType[]} */
  const ACCOUNT_TYPES = Object.freeze([
    { id: "individual", label: "Физлицо", balance: "3014" },
    { id: "entrepreneur", label: "ИП", balance: "3013" },
    { id: "legal", label: "Юрлицо", balance: "3012" },
  ]);

  /** @type {readonly IbanCurrency[]} */
  const CURRENCIES = Object.freeze([
    { id: "byn", label: "BYN", numericCode: "933" },
    { id: "usd", label: "USD", numericCode: "840" },
    { id: "eur", label: "EUR", numericCode: "978" },
    { id: "rub", label: "RUB", numericCode: "643" },
  ]);

  /**
   * Первые четыре символа BIC — код банка в IBAN.
   * @param {string} bic
   * @returns {string}
   */
  function getBankCode(bic) {
    return bic.slice(0, 4);
  }

  /**
   * Заменяет буквы на числа по ISO 13616 (A=10 … Z=35).
   * @param {string} value
   * @returns {string}
   */
  function expandIbanSymbols(value) {
    return value
      .split("")
      .map((symbol) => {
        if (symbol >= "0" && symbol <= "9") {
          return symbol;
        }

        return String(symbol.charCodeAt(0) - LETTER_DIGIT_OFFSET);
      })
      .join("");
  }

  /**
   * Остаток по модулю 97 без BigInt.
   * @param {string} digits
   * @returns {number}
   */
  function mod97(digits) {
    let remainder = 0;

    for (let index = 0; index < digits.length; index += 1) {
      remainder = (remainder * 10 + Number(digits[index])) % 97;
    }

    return remainder;
  }

  /**
   * Контрольные цифры IBAN: ISO 7064 MOD 97-10.
   * @param {string} bban
   * @returns {string}
   */
  function calculateIbanCheckDigits(bban) {
    const remainder = mod97(expandIbanSymbols(`${bban}${COUNTRY_CODE}00`));

    return padNumber(98 - remainder, 2);
  }

  /**
   * Проверяет IBAN РБ по длине, структуре и модулю 97.
   * @param {string} iban
   * @returns {boolean}
   */
  function isValidBelarusIban(iban) {
    const compact = iban.replace(/\s+/g, "").toUpperCase();

    if (!IBAN_PATTERN.test(compact)) {
      return false;
    }

    const rearranged = `${compact.slice(4)}${compact.slice(0, 4)}`;

    return mod97(expandIbanSymbols(rearranged)) === 1;
  }

  /**
   * Форматирует IBAN группами по 4 символа.
   * @param {string} iban
   * @returns {string}
   */
  function formatIban(iban) {
    return iban.replace(/(.{4})/g, "$1 ").trim();
  }

  /**
   * Собирает 16-значный индивидуальный счёт с кодом валюты.
   * @param {IbanCurrency} currency
   * @returns {string}
   */
  function generateIndividualAccount(currency) {
    const prefix = padNumber(getRandomInt(0, 9999), 4);
    const unique = padNumber(getRandomInt(0, 99999999), 8);

    return `${prefix}0${currency.numericCode}${unique}`;
  }

  /**
   * Выбирает банк по значению формы. По умолчанию — Альфа-Банк.
   * @param {string | undefined} requestedId
   * @returns {BelarusBank}
   */
  function resolveBank(requestedId) {
    const selectedId = requestedId || "alfa";

    if (selectedId === "any") {
      return getRandomItem(BELARUS_BANKS);
    }

    const bank = BELARUS_BANKS.find((item) => item.id === selectedId);

    if (!bank) {
      throw new Error(`Неизвестный банк: ${selectedId}`);
    }

    return bank;
  }

  /**
   * Выбирает тип счёта по значению формы.
   * @param {string | undefined} requestedId
   * @returns {IbanAccountType}
   */
  function resolveAccountType(requestedId) {
    const selectedId = requestedId || "individual";
    const accountType = ACCOUNT_TYPES.find((item) => item.id === selectedId);

    if (!accountType) {
      throw new Error(`Неизвестный тип счёта: ${selectedId}`);
    }

    return accountType;
  }

  /**
   * Выбирает валюту по значению формы.
   * @param {string | undefined} requestedId
   * @returns {IbanCurrency}
   */
  function resolveCurrency(requestedId) {
    const selectedId = requestedId || "byn";
    const currency = CURRENCIES.find((item) => item.id === selectedId);

    if (!currency) {
      throw new Error(`Неизвестная валюта: ${selectedId}`);
    }

    return currency;
  }

  /**
   * Генерирует тестовый IBAN белорусского банка.
   * @param {{ bank?: string, accountType?: string, currency?: string }} [options]
   * @returns {IbanData}
   */
  function generateIban(options = {}) {
    const bank = resolveBank(options.bank);
    const accountType = resolveAccountType(options.accountType);
    const currency = resolveCurrency(options.currency);
    const bban = `${getBankCode(bank.bic)}${accountType.balance}${generateIndividualAccount(currency)}`;
    const iban = `${COUNTRY_CODE}${calculateIbanCheckDigits(bban)}${bban}`;

    if (!isValidBelarusIban(iban)) {
      throw new Error("Не удалось сформировать IBAN. Повторите генерацию.");
    }

    return {
      bank: bank.name,
      bic: bank.bic,
      iban,
      ibanFormatted: formatIban(iban),
      accountType: `${accountType.label} (${accountType.balance})`,
      currency: currency.label,
    };
  }

  /** @type {import("./types.js").HelperDefinition} */
  const ibanHelper = {
    id: "iban",
    title: "IBAN РБ",
    description:
      "Тестовые счета белорусских банков в формате IBAN (28 символов). Контрольные цифры по ISO 7064 MOD 97-10. По умолчанию — Альфа-Банк.",
    fields: [
      {
        name: "bank",
        type: "select",
        label: "Банк",
        defaultValue: "alfa",
        options: [
          { value: "any", label: "Любой" },
          ...BELARUS_BANKS.map((bank) => ({ value: bank.id, label: bank.name })),
        ],
      },
      {
        name: "accountType",
        type: "select",
        label: "Тип счёта",
        defaultValue: "individual",
        options: ACCOUNT_TYPES.map((item) => ({
          value: item.id,
          label: `${item.label} (${item.balance})`,
        })),
      },
      {
        name: "currency",
        type: "select",
        label: "Валюта",
        defaultValue: "byn",
        options: CURRENCIES.map((item) => ({ value: item.id, label: item.label })),
      },
    ],
    resultFields: [
      { key: "iban", label: "IBAN" },
      { key: "ibanFormatted", label: "С пробелами" },
      { key: "bank", label: "Банк" },
      { key: "bic", label: "BIC" },
      { key: "accountType", label: "Тип счёта" },
      { key: "currency", label: "Валюта" },
    ],
    generate: (values) =>
      generateIban({
        bank: values.bank,
        accountType: values.accountType,
        currency: values.currency,
      }),
  };

  Helpers.calculateIbanCheckDigits = calculateIbanCheckDigits;
  Helpers.isValidBelarusIban = isValidBelarusIban;
  Helpers.generateIban = generateIban;
  Helpers.ibanHelper = ibanHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
