(function (Helpers) {
  const getRandomInt = Helpers.getRandomInt;
  const getRandomItem = Helpers.getRandomItem;
  const padNumber = Helpers.padNumber;

/**
 * @typedef {"male" | "female"} Gender
 */

/**
 * @typedef {Object} PassportOptions
 * @property {string} [ageMode]
 * @property {string} [age]
 * @property {string} [minAge]
 * @property {string} [maxAge]
 * @property {string} [yearFrom]
 * @property {string} [yearTo]
 * @property {string} [gender]
 * @property {string} [numberFormat]
 */

/**
 * @typedef {Object} PassportData
 * @property {string} personalNumber
 * @property {string} seriesAndNumber
 * @property {string} birthDate
 */

const CHECK_DIGIT_WEIGHTS = Object.freeze([7, 3, 1]);
const LETTER_VALUE_OFFSET = 10;
const PERSONAL_NUMBER_SIGNATURE = "PB";
const MODERN_NUMBER_LETTER = "A";
const MODERN_NUMBER_MIN = 7000000;
const MODERN_NUMBER_MAX = 7999999;
const FIRST_PASSPORT_AGE = 14;
const NEW_FORMAT_START = new Date(2012, 0, 1);
const DEFAULT_MIN_AGE = 21;
const DEFAULT_MAX_AGE = 67;
const DEFAULT_EXACT_AGE = 25;
const DEFAULT_YEAR_FROM = 1970;
const DEFAULT_YEAR_TO = 2006;

/**
 * Код региона в личном номере → серия бланка паспорта.
 * @type {Readonly<Record<string, string>>}
 */
const SERIES_BY_REGION = Object.freeze({
  A: "MP",
  B: "MC",
  C: "AB",
  E: "BM",
  H: "HB",
  K: "KH",
  M: "KB",
});

const REGION_LETTERS = Object.freeze(Object.keys(SERIES_BY_REGION));
const PASSPORT_SERIES = Object.freeze([...Object.values(SERIES_BY_REGION), "PP"]);

/**
 * @param {string} symbol
 * @returns {number}
 */
function getSymbolValue(symbol) {
  if (symbol >= "0" && symbol <= "9") {
    return Number(symbol);
  }

  return symbol.charCodeAt(0) - "A".charCodeAt(0) + LETTER_VALUE_OFFSET;
}

/**
 * Считает контрольную цифру по модулю 10 с весовой функцией 731 731…
 * @param {string} payload
 * @returns {number}
 */
function calculateCheckDigit(payload) {
  const weightedSum = payload.split("").reduce((sum, symbol, index) => {
    const weight = CHECK_DIGIT_WEIGHTS[index % CHECK_DIGIT_WEIGHTS.length];
    return sum + getSymbolValue(symbol) * weight;
  }, 0);

  return weightedSum % 10;
}

/**
 * @param {string | undefined} value
 * @param {number} fallback
 * @returns {number}
 */
function parseBoundedInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return parsed;
}

/**
 * Первая цифра личного номера: пол и век рождения.
 * @param {number} year
 * @param {Gender} gender
 * @returns {string}
 */
function getCenturyGenderDigit(year, gender) {
  const isMale = gender === "male";

  if (year < 1900) {
    return isMale ? "1" : "2";
  }

  if (year < 2000) {
    return isMale ? "3" : "4";
  }

  return isMale ? "5" : "6";
}

/**
 * Форматирует дату как ДД.ММ.ГГГГ.
 * @param {Date} date
 * @returns {string}
 */
function formatBirthDate(date) {
  return `${padNumber(date.getDate(), 2)}.${padNumber(date.getMonth() + 1, 2)}.${date.getFullYear()}`;
}

/**
 * Случайная дата, на которую сегодня исполняется указанный возраст.
 * @param {number} age
 * @returns {Date}
 */
function getDateForExactAge(age) {
  const today = new Date();
  const latest = new Date(today.getFullYear() - age, today.getMonth(), today.getDate());
  const earliest = new Date(today.getFullYear() - age - 1, today.getMonth(), today.getDate() + 1);

  if (earliest.getTime() >= latest.getTime()) {
    return latest;
  }

  return new Date(getRandomInt(earliest.getTime(), latest.getTime()));
}

/**
 * Случайная валидная дата в указанном календарном году.
 * @param {number} year
 * @returns {Date}
 */
function getRandomDateInYear(year) {
  const month = getRandomInt(0, 11);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const day = getRandomInt(1, daysInMonth);

  return new Date(year, month, day);
}

/**
 * Строит дату рождения по режиму формы.
 * @param {PassportOptions} options
 * @returns {Date}
 */
function resolveBirthDate(options) {
  const ageMode = options.ageMode ?? "range";

  if (ageMode === "exact") {
    const age = Math.max(0, parseBoundedInt(options.age, DEFAULT_EXACT_AGE));
    return getDateForExactAge(age);
  }

  if (ageMode === "years") {
    const yearFrom = parseBoundedInt(options.yearFrom, DEFAULT_YEAR_FROM);
    const yearTo = parseBoundedInt(options.yearTo, DEFAULT_YEAR_TO);
    const minYear = Math.min(yearFrom, yearTo);
    const maxYear = Math.max(yearFrom, yearTo);

    return getRandomDateInYear(getRandomInt(minYear, maxYear));
  }

  const minAge = Math.max(0, parseBoundedInt(options.minAge, DEFAULT_MIN_AGE));
  const maxAge = Math.max(0, parseBoundedInt(options.maxAge, DEFAULT_MAX_AGE));
  const age = getRandomInt(Math.min(minAge, maxAge), Math.max(minAge, maxAge));

  return getDateForExactAge(age);
}

/**
 * Классический личный номер: пол, дата рождения ДДММГГ, регион.
 * @param {Date} birthDate
 * @param {Gender} gender
 * @param {string} regionLetter
 * @returns {string}
 */
function generateClassicPersonalNumber(birthDate, gender, regionLetter) {
  const datePart = `${padNumber(birthDate.getDate(), 2)}${padNumber(birthDate.getMonth() + 1, 2)}${padNumber(birthDate.getFullYear() % 100, 2)}`;
  const serial = padNumber(getRandomInt(1, 999), 3);
  const payload = `${getCenturyGenderDigit(birthDate.getFullYear(), gender)}${datePart}${regionLetter}${serial}${PERSONAL_NUMBER_SIGNATURE}`;

  return `${payload}${calculateCheckDigit(payload)}`;
}

/**
 * Личный номер нового образца (с 01.01.2012): случайные 7xxxxxxAxxxPB.
 * Дата рождения в номер не входит.
 * @returns {string}
 */
function generateModernPersonalNumber() {
  const randomGroup = String(getRandomInt(MODERN_NUMBER_MIN, MODERN_NUMBER_MAX));
  const sequenceGroup = padNumber(getRandomInt(0, 999), 3);
  const payload = `${randomGroup}${MODERN_NUMBER_LETTER}${sequenceGroup}${PERSONAL_NUMBER_SIGNATURE}`;

  return `${payload}${calculateCheckDigit(payload)}`;
}

/**
 * Дата предполагаемой первой выдачи паспорта (обычно в 14 лет).
 * @param {Date} birthDate
 * @returns {Date}
 */
function getFirstPassportDate(birthDate) {
  return new Date(
    birthDate.getFullYear() + FIRST_PASSPORT_AGE,
    birthDate.getMonth(),
    birthDate.getDate(),
  );
}

/**
 * Выбирает формат номера: новый — если к 01.01.2012 человеку ещё не было 14 лет.
 * @param {string | undefined} requestedFormat
 * @param {Date} birthDate
 * @returns {"classic" | "modern"}
 */
function resolveNumberFormat(requestedFormat, birthDate) {
  if (requestedFormat === "classic" || requestedFormat === "modern") {
    return requestedFormat;
  }

  return getFirstPassportDate(birthDate) >= NEW_FORMAT_START ? "modern" : "classic";
}

/**
 * Генерирует тестовые реквизиты паспорта РБ.
 * @param {PassportOptions} [options]
 * @returns {PassportData}
 */
function generatePassport(options = {}) {
  const gender =
    options.gender === "male" || options.gender === "female"
      ? options.gender
      : getRandomItem(/** @type {const} */ (["male", "female"]));
  const birthDate = resolveBirthDate(options);
  const numberFormat = resolveNumberFormat(options.numberFormat, birthDate);
  const number = padNumber(getRandomInt(0, 9999999), 7);
  const isModern = numberFormat === "modern";
  const regionLetter = getRandomItem(REGION_LETTERS);
  const series = isModern ? getRandomItem(PASSPORT_SERIES) : SERIES_BY_REGION[regionLetter];
  const personalNumber = isModern
    ? generateModernPersonalNumber()
    : generateClassicPersonalNumber(birthDate, gender, regionLetter);

  return {
    personalNumber,
    seriesAndNumber: `${series} ${number}`,
    birthDate: formatBirthDate(birthDate),
  };
}

/** @type {import("./types.js").HelperDefinition} */
const passportHelper = {
  id: "passport",
  title: "Паспорт РБ",
  description:
    "Классический номер кодирует дату рождения. Новый (с 01.01.2012) — случайный 7xxxxxxAxxxPB: дата в него не входит. В режиме «Авто» формат выбирается по дате, когда исполнилось 14 лет.",
  fields: [
    {
      name: "numberFormat",
      type: "select",
      label: "Формат личного номера",
      defaultValue: "auto",
      options: [
        { value: "auto", label: "Авто — по дате первой выдачи (14 лет)" },
        { value: "classic", label: "Классический — дата в номере" },
        { value: "modern", label: "Новый — с 2012, без даты" },
      ],
    },
    {
      name: "ageMode",
      type: "select",
      label: "Как задать возраст",
      defaultValue: "range",
      options: [
        { value: "exact", label: "Точный возраст" },
        { value: "range", label: "Диапазон возраста" },
        { value: "years", label: "Годы рождения" },
      ],
    },
    {
      name: "age",
      type: "number",
      label: "Полных лет",
      min: 0,
      max: 120,
      defaultValue: String(DEFAULT_EXACT_AGE),
      showWhen: { field: "ageMode", value: "exact" },
    },
    {
      name: "minAge",
      type: "number",
      label: "Возраст от",
      min: 0,
      max: 120,
      defaultValue: String(DEFAULT_MIN_AGE),
      showWhen: { field: "ageMode", value: "range" },
    },
    {
      name: "maxAge",
      type: "number",
      label: "Возраст до",
      min: 0,
      max: 120,
      defaultValue: String(DEFAULT_MAX_AGE),
      showWhen: { field: "ageMode", value: "range" },
    },
    {
      name: "yearFrom",
      type: "number",
      label: "Год рождения от",
      min: 1800,
      max: 2100,
      defaultValue: String(DEFAULT_YEAR_FROM),
      showWhen: { field: "ageMode", value: "years" },
    },
    {
      name: "yearTo",
      type: "number",
      label: "Год рождения до",
      min: 1800,
      max: 2100,
      defaultValue: String(DEFAULT_YEAR_TO),
      showWhen: { field: "ageMode", value: "years" },
    },
    {
      name: "gender",
      type: "select",
      label: "Пол",
      defaultValue: "any",
      options: [
        { value: "any", label: "Любой" },
        { value: "male", label: "Мужской" },
        { value: "female", label: "Женский" },
      ],
    },
  ],
  resultFields: [
    { key: "personalNumber", label: "Личный номер" },
    { key: "seriesAndNumber", label: "Серия и номер" },
    { key: "birthDate", label: "Дата рождения" },
  ],
  generate: generatePassport,
  };

  Helpers.calculateCheckDigit = calculateCheckDigit;
  Helpers.generatePassport = generatePassport;
  Helpers.passportHelper = passportHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
