(function (Helpers) {
  const LCS_CELL_LIMIT = 150000;
  const INLINE_CELL_LIMIT = 40000;
  const RESYNC_WINDOW = 80;

  /** @type {readonly (readonly string[])[]} */
  const HOMOGLYPH_GROUPS = Object.freeze([
    Object.freeze(["A", "А", "Α"]),
    Object.freeze(["a", "а", "α"]),
    Object.freeze(["B", "В", "Β"]),
    Object.freeze(["C", "С", "Ϲ"]),
    Object.freeze(["c", "с"]),
    Object.freeze(["E", "Е", "Ε"]),
    Object.freeze(["e", "е"]),
    Object.freeze(["H", "Н", "Η"]),
    Object.freeze(["K", "К", "Κ"]),
    Object.freeze(["M", "М", "Μ"]),
    Object.freeze(["O", "О", "Ο"]),
    Object.freeze(["o", "о", "ο"]),
    Object.freeze(["P", "Р", "Ρ"]),
    Object.freeze(["p", "р", "ρ"]),
    Object.freeze(["T", "Т", "Τ"]),
    Object.freeze(["X", "Х", "Χ"]),
    Object.freeze(["x", "х", "χ"]),
    Object.freeze(["Y", "У", "Υ"]),
    Object.freeze(["y", "у"]),
    Object.freeze(["I", "І", "Ι"]),
    Object.freeze(["i", "і", "ι"]),
    Object.freeze(["J", "Ј"]),
    Object.freeze(["j", "ј"]),
    Object.freeze(["S", "Ѕ"]),
    Object.freeze(["s", "ѕ"]),
  ]);

  /** @type {Map<string, string>} */
  const HOMOGLYPH_CANON = new Map();

  HOMOGLYPH_GROUPS.forEach((group) => {
    const canon = group[0];

    group.forEach((char) => {
      HOMOGLYPH_CANON.set(char, canon);
    });
  });

  /**
   * @typedef {"equal" | "insert" | "delete" | "replace"} CompareOp
   */

  /**
   * @typedef {Object} CompareToken
   * @property {"equal" | "insert" | "delete" | "homoglyph" | "spot"} type
   * @property {string} value
   * @property {string} [script]
   * @property {string} [otherValue]
   * @property {string} [otherScript]
   */

  /**
   * @typedef {Object} CompareLine
   * @property {CompareOp} type
   * @property {string} left
   * @property {string} right
   * @property {number} leftLine
   * @property {number} rightLine
   * @property {CompareToken[] | null} leftTokens
   * @property {CompareToken[] | null} rightTokens
   */

  /**
   * @typedef {Object} CompareResult
   * @property {CompareLine[]} lines
   * @property {number} added
   * @property {number} removed
   * @property {number} changed
   * @property {number} homoglyphs
   * @property {boolean} equal
   * @property {boolean} empty
   */

  /**
   * Делит текст на строки с учётом CRLF.
   * @param {string} text
   * @returns {string[]}
   */
  function splitLines(text) {
    return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  }

  /**
   * Режет строку на слова, пробелы и знаки.
   * @param {string} line
   * @returns {string[]}
   */
  function tokenizeLine(line) {
    return line.match(/\s+|[A-Za-zА-Яа-яЁё0-9_]+|[^\s]/g) ?? [];
  }

  /**
   * Определяет алфавит буквы.
   * @param {string} char
   * @returns {string}
   */
  function getLetterScript(char) {
    const code = char.codePointAt(0) ?? 0;

    if ((code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f)) {
      return "cyrillic";
    }

    if (code >= 0x0370 && code <= 0x03ff) {
      return "greek";
    }

    if ((code >= 0x0041 && code <= 0x005a) || (code >= 0x0061 && code <= 0x007a)) {
      return "latin";
    }

    return "";
  }

  /**
   * Короткое имя алфавита для метки.
   * @param {string} script
   * @returns {string}
   */
  function scriptShortLabel(script) {
    if (script === "cyrillic") {
      return "кир";
    }

    if (script === "latin") {
      return "лат";
    }

    if (script === "greek") {
      return "греч";
    }

    return script;
  }

  /**
   * Полное имя алфавита.
   * @param {string} script
   * @returns {string}
   */
  function scriptFullLabel(script) {
    if (script === "cyrillic") {
      return "кириллица";
    }

    if (script === "latin") {
      return "латиница";
    }

    if (script === "greek") {
      return "греческий";
    }

    return script || "другой алфавит";
  }

  /**
   * Форматирует символ с кодом Unicode.
   * @param {string} char
   * @returns {string}
   */
  function formatGlyph(char) {
    const code = char.codePointAt(0) ?? 0;

    return `«${char}» U+${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  /**
   * Пара символов выглядит одинаково, но это разные алфавиты.
   * @param {string} leftChar
   * @param {string} rightChar
   * @returns {boolean}
   */
  function isHomoglyphPair(leftChar, rightChar) {
    if (leftChar === rightChar) {
      return false;
    }

    const leftCanon = HOMOGLYPH_CANON.get(leftChar);
    const rightCanon = HOMOGLYPH_CANON.get(rightChar);

    return Boolean(leftCanon && leftCanon === rightCanon);
  }

  /**
   * Создаёт токен подмены алфавита.
   * @param {string} value
   * @param {string} otherValue
   * @returns {CompareToken}
   */
  function createHomoglyphToken(value, otherValue) {
    return {
      type: "homoglyph",
      value,
      script: getLetterScript(value),
      otherValue,
      otherScript: getLetterScript(otherValue),
    };
  }

  /**
   * Посимвольно выравнивает одинаковые по длине фрагменты с подменами алфавита.
   * @param {string} left
   * @param {string} right
   * @returns {{ left: CompareToken[], right: CompareToken[] } | null}
   */
  function zipHomoglyphs(left, right) {
    return zipAlignedChars(left, right, true);
  }

  /**
   * Посимвольно выравнивает одинаковые по длине фрагменты.
   * @param {string} left
   * @param {string} right
   * @param {boolean} requireHomoglyph
   * @returns {{ left: CompareToken[], right: CompareToken[] } | null}
   */
  function zipAlignedChars(left, right, requireHomoglyph) {
    if (!left || !right || left.length !== right.length) {
      return null;
    }

    /** @type {CompareToken[]} */
    const leftTokens = [];
    /** @type {CompareToken[]} */
    const rightTokens = [];
    let foundHomoglyph = 0;

    for (let index = 0; index < left.length; index += 1) {
      const leftChar = left[index] ?? "";
      const rightChar = right[index] ?? "";

      if (leftChar === rightChar) {
        leftTokens.push({ type: "equal", value: leftChar });
        rightTokens.push({ type: "equal", value: rightChar });
        continue;
      }

      if (isHomoglyphPair(leftChar, rightChar)) {
        foundHomoglyph += 1;
        leftTokens.push(createHomoglyphToken(leftChar, rightChar));
        rightTokens.push(createHomoglyphToken(rightChar, leftChar));
        continue;
      }

      leftTokens.push({ type: "delete", value: leftChar });
      rightTokens.push({ type: "insert", value: rightChar });
    }

    if (requireHomoglyph && foundHomoglyph === 0) {
      return null;
    }

    return {
      left: mergeAdjacentTokens(leftTokens),
      right: mergeAdjacentTokens(rightTokens),
    };
  }

  /**
   * Считает символы-подмены алфавита в токенах одной стороны.
   * @param {CompareToken[] | null} tokens
   * @returns {number}
   */
  function countHomoglyphs(tokens) {
    if (!tokens) {
      return 0;
    }

    return tokens.reduce((sum, token) => {
      if (token.type !== "homoglyph") {
        return sum;
      }

      return sum + token.value.length;
    }, 0);
  }

  /**
   * Собирает текстовые пояснения по подменам алфавита.
   * @param {CompareToken[] | null} tokens
   * @returns {string[]}
   */
  function collectHomoglyphNotes(tokens) {
    if (!tokens) {
      return [];
    }

    return tokens
      .filter((token) => token.type === "homoglyph")
      .map(
        (token) =>
          `${formatGlyph(token.value)} (${scriptFullLabel(token.script ?? "")}) ≠ ${formatGlyph(token.otherValue ?? "")} (${scriptFullLabel(token.otherScript ?? "")})`,
      );
  }

  /**
   * Строит таблицу LCS для двух массивов.
   * @template T
   * @param {readonly T[]} left
   * @param {readonly T[]} right
   * @returns {Uint16Array[] | null}
   */
  function buildLcsTable(left, right) {
    const rows = left.length;
    const cols = right.length;

    if (rows * cols > LCS_CELL_LIMIT) {
      return null;
    }

    /** @type {Uint16Array[]} */
    const table = Array.from({ length: rows + 1 }, () => new Uint16Array(cols + 1));

    for (let i = rows - 1; i >= 0; i -= 1) {
      for (let j = cols - 1; j >= 0; j -= 1) {
        table[i][j] =
          left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }

    return table;
  }

  /**
   * Ищет ближайшее совпадение строки в окне.
   * @param {readonly string[]} lines
   * @param {number} start
   * @param {string} value
   * @returns {number}
   */
  function findNearbyMatch(lines, start, value) {
    const end = Math.min(lines.length, start + RESYNC_WINDOW);

    for (let index = start; index < end; index += 1) {
      if (lines[index] === value) {
        return index;
      }
    }

    return -1;
  }

  /**
   * Собирает построчный diff без полной LCS — для больших текстов.
   * @param {readonly string[]} leftLines
   * @param {readonly string[]} rightLines
   * @returns {CompareLine[]}
   */
  function diffLinesGreedy(leftLines, rightLines) {
    /** @type {CompareLine[]} */
    const chunks = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        chunks.push({
          type: "equal",
          left: leftLines[leftIndex],
          right: rightLines[rightIndex],
          leftLine: leftIndex + 1,
          rightLine: rightIndex + 1,
          leftTokens: null,
          rightTokens: null,
        });
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      const rightMatch = findNearbyMatch(rightLines, rightIndex + 1, leftLines[leftIndex]);
      const leftMatch = findNearbyMatch(leftLines, leftIndex + 1, rightLines[rightIndex]);

      if (rightMatch !== -1 && (leftMatch === -1 || rightMatch - rightIndex <= leftMatch - leftIndex)) {
        while (rightIndex < rightMatch) {
          chunks.push({
            type: "insert",
            left: "",
            right: rightLines[rightIndex],
            leftLine: leftIndex + 1,
            rightLine: rightIndex + 1,
            leftTokens: null,
            rightTokens: null,
          });
          rightIndex += 1;
        }

        continue;
      }

      if (leftMatch !== -1) {
        while (leftIndex < leftMatch) {
          chunks.push({
            type: "delete",
            left: leftLines[leftIndex],
            right: "",
            leftLine: leftIndex + 1,
            rightLine: rightIndex + 1,
            leftTokens: null,
            rightTokens: null,
          });
          leftIndex += 1;
        }

        continue;
      }

      chunks.push({
        type: "delete",
        left: leftLines[leftIndex],
        right: "",
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      chunks.push({
        type: "insert",
        left: "",
        right: rightLines[rightIndex],
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      leftIndex += 1;
      rightIndex += 1;
    }

    while (leftIndex < leftLines.length) {
      chunks.push({
        type: "delete",
        left: leftLines[leftIndex],
        right: "",
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      leftIndex += 1;
    }

    while (rightIndex < rightLines.length) {
      chunks.push({
        type: "insert",
        left: "",
        right: rightLines[rightIndex],
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      rightIndex += 1;
    }

    return chunks;
  }

  /**
   * Собирает построчный diff через LCS.
   * @param {readonly string[]} leftLines
   * @param {readonly string[]} rightLines
   * @returns {CompareLine[]}
   */
  function diffLinesLcs(leftLines, rightLines) {
    const table = buildLcsTable(leftLines, rightLines);

    if (!table) {
      return diffLinesGreedy(leftLines, rightLines);
    }

    /** @type {CompareLine[]} */
    const chunks = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftLines.length && rightIndex < rightLines.length) {
      if (leftLines[leftIndex] === rightLines[rightIndex]) {
        chunks.push({
          type: "equal",
          left: leftLines[leftIndex],
          right: rightLines[rightIndex],
          leftLine: leftIndex + 1,
          rightLine: rightIndex + 1,
          leftTokens: null,
          rightTokens: null,
        });
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
        chunks.push({
          type: "delete",
          left: leftLines[leftIndex],
          right: "",
          leftLine: leftIndex + 1,
          rightLine: rightIndex + 1,
          leftTokens: null,
          rightTokens: null,
        });
        leftIndex += 1;
        continue;
      }

      chunks.push({
        type: "insert",
        left: "",
        right: rightLines[rightIndex],
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      rightIndex += 1;
    }

    while (leftIndex < leftLines.length) {
      chunks.push({
        type: "delete",
        left: leftLines[leftIndex],
        right: "",
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      leftIndex += 1;
    }

    while (rightIndex < rightLines.length) {
      chunks.push({
        type: "insert",
        left: "",
        right: rightLines[rightIndex],
        leftLine: leftIndex + 1,
        rightLine: rightIndex + 1,
        leftTokens: null,
        rightTokens: null,
      });
      rightIndex += 1;
    }

    return chunks;
  }

  /**
   * Длина общего префикса двух строк.
   * @param {string} left
   * @param {string} right
   * @returns {number}
   */
  function commonPrefixLength(left, right) {
    const limit = Math.min(left.length, right.length);
    let index = 0;

    while (index < limit && left[index] === right[index]) {
      index += 1;
    }

    return index;
  }

  /**
   * Длина общего суффикса, не пересекающегося с префиксом.
   * @param {string} left
   * @param {string} right
   * @param {number} prefixLength
   * @returns {number}
   */
  function commonSuffixLength(left, right, prefixLength) {
    const limit = Math.min(left.length - prefixLength, right.length - prefixLength);
    let index = 0;

    while (
      index < limit &&
      left[left.length - 1 - index] === right[right.length - 1 - index]
    ) {
      index += 1;
    }

    return index;
  }

  /**
   * Символ входит в слово для расширения подсветки.
   * @param {string} char
   * @returns {boolean}
   */
  function isWordChar(char) {
    return /[A-Za-zА-Яа-яЁё0-9_]/.test(char);
  }

  /**
   * Расширяет диапазон до границ слова.
   * @param {string} text
   * @param {number} start
   * @param {number} end
   * @returns {{ from: number, to: number }}
   */
  function expandToWord(text, start, end) {
    let from = start;
    let to = Math.max(start, end);

    while (from > 0 && isWordChar(text[from - 1] ?? "")) {
      from -= 1;
    }

    while (to < text.length && isWordChar(text[to] ?? "")) {
      to += 1;
    }

    return { from, to };
  }

  /**
   * Не режет общее начало/конец внутри слова (encoding / encding).
   * @param {string} left
   * @param {string} right
   * @param {number} prefixLength
   * @param {number} suffixLength
   * @returns {{ prefix: number, suffix: number }}
   */
  function shrinkAffixToWordBoundary(left, right, prefixLength, suffixLength) {
    let prefix = prefixLength;
    let suffix = suffixLength;

    while (prefix > 0) {
      const leftInWord = isWordChar(left[prefix] ?? "") && isWordChar(left[prefix - 1] ?? "");
      const rightInWord = isWordChar(right[prefix] ?? "") && isWordChar(right[prefix - 1] ?? "");

      if (!leftInWord && !rightInWord) {
        break;
      }

      prefix -= 1;
    }

    while (suffix > 0) {
      const leftPos = left.length - suffix;
      const rightPos = right.length - suffix;
      const leftInWord = isWordChar(left[leftPos] ?? "") && isWordChar(left[leftPos - 1] ?? "");
      const rightInWord = isWordChar(right[rightPos] ?? "") && isWordChar(right[rightPos - 1] ?? "");

      if (!leftInWord && !rightInWord) {
        break;
      }

      suffix -= 1;
    }

    if (prefix + suffix > Math.min(left.length, right.length)) {
      return { prefix: 0, suffix: 0 };
    }

    return { prefix, suffix };
  }

  /**
   * Слово вокруг изменения; на границе слов пустой диапазон — для жёлтого пробела.
   * @param {string} text
   * @param {number} changeStart
   * @param {number} changeEnd
   * @returns {{ from: number, to: number }}
   */
  function wordAroundChange(text, changeStart, changeEnd) {
    const hasRange = changeEnd > changeStart;
    const touchesWord =
      (changeStart > 0 && isWordChar(text[changeStart - 1] ?? "")) ||
      (changeStart < text.length && isWordChar(text[changeStart] ?? ""));

    if (!hasRange && !touchesWord) {
      return { from: changeStart, to: changeEnd };
    }

    return expandToWord(text, changeStart, changeEnd);
  }

  /**
   * Склеивает соседние токены одного типа.
   * @param {CompareToken[]} tokens
   * @returns {CompareToken[]}
   */
  function mergeAdjacentTokens(tokens) {
    /** @type {CompareToken[]} */
    const merged = [];

    tokens.forEach((token) => {
      const last = merged[merged.length - 1];
      const canMergeHomoglyph =
        token.type === "homoglyph" && last?.type === "homoglyph" && last.script === token.script;
      const canMergePlain = last && last.type === token.type && token.type !== "homoglyph";

      if (last && (canMergePlain || canMergeHomoglyph)) {
        last.value += token.value;

        if (token.type === "homoglyph") {
          last.otherValue = `${last.otherValue ?? ""}${token.otherValue ?? ""}`;
        }

        return;
      }

      merged.push({
        type: token.type,
        value: token.value,
        script: token.script ?? "",
        otherValue: token.otherValue ?? "",
        otherScript: token.otherScript ?? "",
      });
    });

    return merged;
  }

  /**
   * Для опечатки внутри слова подсвечивает слово целиком.
   * @param {string} left
   * @param {string} right
   * @param {number} prefix
   * @param {number} suffix
   * @returns {{ left: CompareToken[], right: CompareToken[] } | null}
   */
  function expandTinyEditToWord(left, right, prefix, suffix) {
    const leftMiddle = left.slice(prefix, left.length - suffix);
    const rightMiddle = right.slice(prefix, right.length - suffix);
    const combined = `${leftMiddle}${rightMiddle}`;

    if (!combined || combined.length > 12 || /\s/.test(combined)) {
      return null;
    }

    const leftSpan = expandToWord(left, prefix, left.length - suffix);
    const rightSpan = expandToWord(right, prefix, right.length - suffix);

    if (leftSpan.from !== rightSpan.from) {
      return null;
    }

    /** @type {CompareToken[]} */
    const leftTokens = [];
    /** @type {CompareToken[]} */
    const rightTokens = [];

    if (leftSpan.from > 0) {
      const prefixText = left.slice(0, leftSpan.from);
      leftTokens.push({ type: "equal", value: prefixText });
      rightTokens.push({ type: "equal", value: prefixText });
    }

    const leftWord = left.slice(leftSpan.from, leftSpan.to);
    const rightWord = right.slice(rightSpan.from, rightSpan.to);

    if (leftWord) {
      leftTokens.push({ type: "delete", value: leftWord });
    }

    if (rightWord) {
      rightTokens.push({ type: "insert", value: rightWord });
    }

    if (leftSpan.to < left.length) {
      leftTokens.push({ type: "equal", value: left.slice(leftSpan.to) });
    }

    if (rightSpan.to < right.length) {
      rightTokens.push({ type: "equal", value: right.slice(rightSpan.to) });
    }

    return { left: leftTokens, right: rightTokens };
  }

  /**
   * Похожесть двух токенов для спаривания version/versin, а не [ и versin.
   * @param {string} left
   * @param {string} right
   * @returns {number}
   */
  function tokenSimilarity(left, right) {
    if (!left || !right) {
      return 0;
    }

    if (left === right) {
      return 1;
    }

    const prefix = commonPrefixLength(left, right);
    const suffix = commonSuffixLength(left, right, prefix);

    return (prefix + suffix) / Math.max(left.length, right.length);
  }

  /**
   * Жадный пословный diff, когда полная LCS слишком большая.
   * @param {readonly string[]} leftTokens
   * @param {readonly string[]} rightTokens
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function diffTokenArraysGreedy(leftTokens, rightTokens) {
    /** @type {CompareToken[]} */
    const leftMarks = [];
    /** @type {CompareToken[]} */
    const rightMarks = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftTokens.length && rightIndex < rightTokens.length) {
      if (leftTokens[leftIndex] === rightTokens[rightIndex]) {
        leftMarks.push({ type: "equal", value: leftTokens[leftIndex] });
        rightMarks.push({ type: "equal", value: rightTokens[rightIndex] });
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      const rightMatch = findNearbyMatch(rightTokens, rightIndex + 1, leftTokens[leftIndex] ?? "");
      const leftMatch = findNearbyMatch(leftTokens, leftIndex + 1, rightTokens[rightIndex] ?? "");

      if (rightMatch !== -1 && (leftMatch === -1 || rightMatch - rightIndex <= leftMatch - leftIndex)) {
        while (rightIndex < rightMatch) {
          rightMarks.push({ type: "insert", value: rightTokens[rightIndex] ?? "" });
          rightIndex += 1;
        }

        continue;
      }

      if (leftMatch !== -1) {
        while (leftIndex < leftMatch) {
          leftMarks.push({ type: "delete", value: leftTokens[leftIndex] ?? "" });
          leftIndex += 1;
        }

        continue;
      }

      leftMarks.push({ type: "delete", value: leftTokens[leftIndex] ?? "" });
      rightMarks.push({ type: "insert", value: rightTokens[rightIndex] ?? "" });
      leftIndex += 1;
      rightIndex += 1;
    }

    while (leftIndex < leftTokens.length) {
      leftMarks.push({ type: "delete", value: leftTokens[leftIndex] ?? "" });
      leftIndex += 1;
    }

    while (rightIndex < rightTokens.length) {
      rightMarks.push({ type: "insert", value: rightTokens[rightIndex] ?? "" });
      rightIndex += 1;
    }

    return { left: leftMarks, right: rightMarks };
  }

  /**
   * Считает пословный LCS по уже нарезанным токенам.
   * @param {readonly string[]} leftTokens
   * @param {readonly string[]} rightTokens
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function diffTokenArrays(leftTokens, rightTokens) {
    if (leftTokens.length * rightTokens.length > INLINE_CELL_LIMIT) {
      return diffTokenArraysGreedy(leftTokens, rightTokens);
    }

    const table = buildLcsTable(leftTokens, rightTokens);

    if (!table) {
      return diffTokenArraysGreedy(leftTokens, rightTokens);
    }

    /** @type {CompareToken[]} */
    const leftMarks = [];
    /** @type {CompareToken[]} */
    const rightMarks = [];
    let leftIndex = 0;
    let rightIndex = 0;

    while (leftIndex < leftTokens.length && rightIndex < rightTokens.length) {
      if (leftTokens[leftIndex] === rightTokens[rightIndex]) {
        leftMarks.push({ type: "equal", value: leftTokens[leftIndex] });
        rightMarks.push({ type: "equal", value: rightTokens[rightIndex] });
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      if (table[leftIndex + 1][rightIndex] >= table[leftIndex][rightIndex + 1]) {
        leftMarks.push({ type: "delete", value: leftTokens[leftIndex] });
        leftIndex += 1;
        continue;
      }

      rightMarks.push({ type: "insert", value: rightTokens[rightIndex] });
      rightIndex += 1;
    }

    while (leftIndex < leftTokens.length) {
      leftMarks.push({ type: "delete", value: leftTokens[leftIndex] });
      leftIndex += 1;
    }

    while (rightIndex < rightTokens.length) {
      rightMarks.push({ type: "insert", value: rightTokens[rightIndex] });
      rightIndex += 1;
    }

    return { left: leftMarks, right: rightMarks };
  }

  /**
   * Diff одного слова: только конкретные символы, не весь диапазон.
   * @param {string} leftWord
   * @param {string} rightWord
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function diffWordPair(leftWord, rightWord) {
    if (leftWord === rightWord) {
      return {
        left: [{ type: "equal", value: leftWord }],
        right: [{ type: "equal", value: rightWord }],
      };
    }

    const prefix = commonPrefixLength(leftWord, rightWord);
    const suffix = commonSuffixLength(leftWord, rightWord, prefix);
    const leftChange = leftWord.slice(prefix, leftWord.length - suffix);
    const rightChange = rightWord.slice(prefix, rightWord.length - suffix);
    /** @type {CompareToken[]} */
    const leftTokens = [];
    /** @type {CompareToken[]} */
    const rightTokens = [];

    if (prefix > 0) {
      const prefixText = leftWord.slice(0, prefix);
      leftTokens.push({ type: "equal", value: prefixText });
      rightTokens.push({ type: "equal", value: prefixText });
    }

    const aligned = zipAlignedChars(leftChange, rightChange, false);

    if (aligned) {
      leftTokens.push(...aligned.left);
      rightTokens.push(...aligned.right);
    } else {
      if (leftChange) {
        leftTokens.push({ type: "delete", value: leftChange });
      } else {
        leftTokens.push({ type: "spot", value: " " });
      }

      if (rightChange) {
        rightTokens.push({ type: "insert", value: rightChange });
      } else {
        rightTokens.push({ type: "spot", value: " " });
      }
    }

    if (suffix > 0) {
      const suffixText = leftWord.slice(leftWord.length - suffix);
      leftTokens.push({ type: "equal", value: suffixText });
      rightTokens.push({ type: "equal", value: suffixText });
    }

    return {
      left: mergeAdjacentTokens(leftTokens),
      right: mergeAdjacentTokens(rightTokens),
    };
  }

  /**
   * Спаривает удаления и вставки по похожести, а не по порядку.
   * @param {number[]} leftDeletes
   * @param {number[]} rightInserts
   * @param {CompareToken[]} leftTokens
   * @param {CompareToken[]} rightTokens
   * @returns {{ leftIndex: number, rightIndex: number }[]}
   */
  function pairSimilarDeletes(leftDeletes, rightInserts, leftTokens, rightTokens) {
    const minScore = 0.4;
    /** @type {{ leftIndex: number, rightIndex: number, score: number }[]} */
    const candidates = [];

    leftDeletes.forEach((leftIndex) => {
      rightInserts.forEach((rightIndex) => {
        const score = tokenSimilarity(leftTokens[leftIndex]?.value ?? "", rightTokens[rightIndex]?.value ?? "");

        if (score >= minScore) {
          candidates.push({ leftIndex, rightIndex, score });
        }
      });
    });

    candidates.sort((left, right) => right.score - left.score);

    const usedLeft = new Set();
    const usedRight = new Set();
    /** @type {{ leftIndex: number, rightIndex: number }[]} */
    const pairs = [];

    candidates.forEach((candidate) => {
      if (usedLeft.has(candidate.leftIndex) || usedRight.has(candidate.rightIndex)) {
        return;
      }

      usedLeft.add(candidate.leftIndex);
      usedRight.add(candidate.rightIndex);
      pairs.push({ leftIndex: candidate.leftIndex, rightIndex: candidate.rightIndex });
    });

    return pairs;
  }

  /**
   * Заменяет пары delete/insert на пословный точечный diff.
   * @param {CompareToken[]} leftTokens
   * @param {CompareToken[]} rightTokens
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function refineTokenPairs(leftTokens, rightTokens) {
    /** @type {number[]} */
    const leftDeletes = [];
    /** @type {number[]} */
    const rightInserts = [];

    leftTokens.forEach((token, index) => {
      if (token.type === "delete") {
        leftDeletes.push(index);
      }
    });

    rightTokens.forEach((token, index) => {
      if (token.type === "insert") {
        rightInserts.push(index);
      }
    });

    const pairs = pairSimilarDeletes(leftDeletes, rightInserts, leftTokens, rightTokens);
    /** @type {Map<number, CompareToken[]>} */
    const leftReplacements = new Map();
    /** @type {Map<number, CompareToken[]>} */
    const rightReplacements = new Map();

    pairs.forEach((pair) => {
      const aligned = diffWordPair(leftTokens[pair.leftIndex]?.value ?? "", rightTokens[pair.rightIndex]?.value ?? "");

      leftReplacements.set(pair.leftIndex, aligned.left);
      rightReplacements.set(pair.rightIndex, aligned.right);
    });

    /** @type {CompareToken[]} */
    const nextLeft = [];
    /** @type {CompareToken[]} */
    const nextRight = [];

    leftTokens.forEach((token, index) => {
      const replacement = leftReplacements.get(index);

      if (replacement) {
        nextLeft.push(...replacement);
        return;
      }

      nextLeft.push(token);
    });

    rightTokens.forEach((token, index) => {
      const replacement = rightReplacements.get(index);

      if (replacement) {
        nextRight.push(...replacement);
        return;
      }

      nextRight.push(token);
    });

    return {
      left: nextLeft,
      right: nextRight,
    };
  }

  /**
   * Ставит жёлтый маркер напротив одиночного удаления/вставки, чтобы стороны не разъезжались.
   * @param {CompareToken[]} leftTokens
   * @param {CompareToken[]} rightTokens
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function injectAlignmentSpots(leftTokens, rightTokens) {
    /** @type {CompareToken[]} */
    const left = [];
    /** @type {CompareToken[]} */
    const right = [];
    let leftIndex = 0;
    let rightIndex = 0;

    const isChange = (/** @type {CompareToken | undefined} */ token) => Boolean(token && token.type !== "equal");

    while (leftIndex < leftTokens.length || rightIndex < rightTokens.length) {
      const leftToken = leftTokens[leftIndex];
      const rightToken = rightTokens[rightIndex];

      if (leftToken?.type === "equal" && rightToken?.type === "equal" && leftToken.value === rightToken.value) {
        left.push(leftToken);
        right.push(rightToken);
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      if (isChange(leftToken) && isChange(rightToken)) {
        left.push(leftToken);
        right.push(rightToken);
        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      if (isChange(leftToken) && !isChange(rightToken)) {
        left.push(leftToken);
        right.push({ type: "spot", value: " " });
        leftIndex += 1;
        continue;
      }

      if (isChange(rightToken) && !isChange(leftToken)) {
        left.push({ type: "spot", value: " " });
        right.push(rightToken);
        rightIndex += 1;
        continue;
      }

      if (leftToken) {
        left.push(leftToken);
        leftIndex += 1;
      }

      if (rightToken) {
        right.push(rightToken);
        rightIndex += 1;
      }
    }

    return { left, right };
  }

  /**
   * Считает внутристрочный diff по словам, каждое отличие отдельно.
   * @param {string} left
   * @param {string} right
   * @returns {{ left: CompareToken[], right: CompareToken[] } | null}
   */
  function diffTokens(left, right) {
    if (left === right) {
      return {
        left: [{ type: "equal", value: left }],
        right: [{ type: "equal", value: right }],
      };
    }

    const prefixRaw = commonPrefixLength(left, right);
    const suffixRaw = commonSuffixLength(left, right, prefixRaw);
    const affix = shrinkAffixToWordBoundary(left, right, prefixRaw, suffixRaw);
    const prefix = affix.prefix;
    const suffix = affix.suffix;
    const leftMiddle = left.slice(prefix, left.length - suffix);
    const rightMiddle = right.slice(prefix, right.length - suffix);
    const tokenDiff = diffTokenArrays(tokenizeLine(leftMiddle), tokenizeLine(rightMiddle));
    const refined = refineTokenPairs(tokenDiff.left, tokenDiff.right);
    /** @type {CompareToken[]} */
    const leftTokens = [];
    /** @type {CompareToken[]} */
    const rightTokens = [];

    if (prefix > 0) {
      const prefixText = left.slice(0, prefix);
      leftTokens.push({ type: "equal", value: prefixText });
      rightTokens.push({ type: "equal", value: prefixText });
    }

    leftTokens.push(...refined.left);
    rightTokens.push(...refined.right);

    if (suffix > 0) {
      const suffixText = left.slice(left.length - suffix);
      leftTokens.push({ type: "equal", value: suffixText });
      rightTokens.push({ type: "equal", value: suffixText });
    }

    const aligned = injectAlignmentSpots(leftTokens, rightTokens);

    return {
      left: mergeAdjacentTokens(aligned.left),
      right: mergeAdjacentTokens(aligned.right),
    };
  }

  /**
   * Обрезает длинную строку вокруг первого изменения — для списка отличий.
   * @param {CompareToken[] | null} tokens
   * @param {string} fallback
   * @returns {{ tokens: CompareToken[] | null, fallback: string }}
   */
  function clipTokensAroundChange(tokens, fallback) {
    const context = 42;

    if (!tokens || tokens.length === 0) {
      if (fallback.length <= context * 2 + 8) {
        return { tokens, fallback };
      }

      return {
        tokens: [{ type: "equal", value: `…${fallback.slice(0, context)}…` }],
        fallback,
      };
    }

    const first = tokens.findIndex((token) => token.type !== "equal");
    let last = -1;

    for (let index = tokens.length - 1; index >= 0; index -= 1) {
      if (tokens[index].type !== "equal") {
        last = index;
        break;
      }
    }

    if (first === -1) {
      if (fallback.length <= context * 2 + 8) {
        return { tokens, fallback };
      }

      return {
        tokens: [{ type: "equal", value: `${fallback.slice(0, context)}…` }],
        fallback,
      };
    }

    if (first === -1) {
      return { tokens, fallback };
    }

    /** @type {CompareToken[]} */
    const clipped = [];
    const prefixText = tokens
      .slice(0, first)
      .map((token) => token.value)
      .join("");

    if (prefixText.length > context) {
      clipped.push({ type: "equal", value: `…${prefixText.slice(-context)}` });
    } else {
      clipped.push(...tokens.slice(0, first));
    }

    clipped.push(...tokens.slice(first, last + 1));

    const suffixText = tokens
      .slice(last + 1)
      .map((token) => token.value)
      .join("");

    if (suffixText.length > context) {
      clipped.push({ type: "equal", value: `${suffixText.slice(0, context)}…` });
    } else {
      clipped.push(...tokens.slice(last + 1));
    }

    return { tokens: mergeAdjacentTokens(clipped), fallback };
  }

  /**
   * Разделитель между отдельными местами отличий в одной строке.
   * @param {string} value
   * @returns {boolean}
   */
  function isIslandSeparator(value) {
    return /[\s<>="'\\/?:;,]/.test(value);
  }

  /**
   * Отделяет буквы на краях от разделителя — чтобы слово не терялось в XML.
   * @param {string} value
   * @returns {{ lead: string, mid: string, tail: string }}
   */
  function splitWordEdges(value) {
    if (!isIslandSeparator(value)) {
      return { lead: "", mid: "", tail: value };
    }

    const leadMatch = value.match(/^[A-Za-zА-Яа-яЁё0-9_]+/);
    const tailMatch = value.match(/[A-Za-zА-Яа-яЁё0-9_]+$/);
    const lead = leadMatch?.[0] ?? "";
    const tail = tailMatch?.[0] ?? "";
    let mid = value;

    if (lead && mid.startsWith(lead)) {
      mid = mid.slice(lead.length);
    }

    if (tail && mid.endsWith(tail)) {
      mid = mid.slice(0, mid.length - tail.length);
    }

    return { lead, mid, tail };
  }

  /**
   * Режет токены на отдельные места отличий, не склеивая промежуток между ними.
   * @param {CompareToken[]} leftTokens
   * @param {CompareToken[]} rightTokens
   * @returns {{ left: CompareToken[], right: CompareToken[] }[]}
   */
  function splitHunkIslands(leftTokens, rightTokens) {
    /** @type {{ left: CompareToken[], right: CompareToken[] }[]} */
    const islands = [];
    let leftIndex = 0;
    let rightIndex = 0;
    /** @type {CompareToken[]} */
    let leftIsland = [];
    /** @type {CompareToken[]} */
    let rightIsland = [];

    const bothEqual = () => {
      const leftToken = leftTokens[leftIndex];
      const rightToken = rightTokens[rightIndex];

      return (
        leftToken?.type === "equal" &&
        rightToken?.type === "equal" &&
        leftToken.value === rightToken.value
      );
    };

    const hasChange = (tokens) => tokens.some((token) => token.type !== "equal");

    const flush = () => {
      if (hasChange(leftIsland) || hasChange(rightIsland)) {
        islands.push({
          left: mergeAdjacentTokens(leftIsland),
          right: mergeAdjacentTokens(rightIsland),
        });
      }

      leftIsland = [];
      rightIsland = [];
    };

    while (leftIndex < leftTokens.length || rightIndex < rightTokens.length) {
      if (bothEqual()) {
        const value = leftTokens[leftIndex].value;

        if (!isIslandSeparator(value)) {
          leftIsland.push(leftTokens[leftIndex]);
          rightIsland.push(rightTokens[rightIndex]);
          leftIndex += 1;
          rightIndex += 1;
          continue;
        }

        const edges = splitWordEdges(value);

        if (edges.lead) {
          leftIsland.push({ type: "equal", value: edges.lead });
          rightIsland.push({ type: "equal", value: edges.lead });
        }

        flush();

        if (edges.tail) {
          leftIsland.push({ type: "equal", value: edges.tail });
          rightIsland.push({ type: "equal", value: edges.tail });
        }

        leftIndex += 1;
        rightIndex += 1;
        continue;
      }

      const leftToken = leftTokens[leftIndex];
      const rightToken = rightTokens[rightIndex];

      if (leftToken && leftToken.type !== "equal") {
        leftIsland.push(leftToken);
        leftIndex += 1;
        continue;
      }

      if (rightToken && rightToken.type !== "equal") {
        rightIsland.push(rightToken);
        rightIndex += 1;
        continue;
      }

      if (leftToken) {
        leftIsland.push(leftToken);
        leftIndex += 1;
      }

      if (rightToken) {
        rightIsland.push(rightToken);
        rightIndex += 1;
      }
    }

    flush();
    return islands.map(finalizeIsland);
  }

  /**
   * Оставляет в карточке только слово, без всей строки.
   * @param {CompareToken[]} tokens
   * @returns {CompareToken[]}
   */
  function trimIslandTokens(tokens) {
    const limit = 48;
    /** @type {CompareToken[]} */
    const next = [];

    tokens.forEach((token) => {
      if (token.type === "spot" || token.type === "homoglyph") {
        next.push(token);
        return;
      }

      if (token.type === "equal") {
        if (token.value.length <= limit && !isIslandSeparator(token.value)) {
          next.push(token);
          return;
        }

        const edges = splitWordEdges(token.value);

        if (edges.lead && edges.lead.length <= limit) {
          next.push({ type: "equal", value: edges.lead });
        }

        return;
      }

      if (token.value.length <= limit) {
        next.push(token);
        return;
      }

      const word = token.value.match(/[A-Za-zА-Яа-яЁё0-9_]+/)?.[0];
      next.push({
        type: token.type,
        value: word && word.length <= limit ? word : token.value.slice(0, limit),
      });
    });

    return next;
  }

  /**
   * Пустая сторона острова — жёлтый маркер, а не вся строка.
   * @param {{ left: CompareToken[], right: CompareToken[] }} island
   * @returns {{ left: CompareToken[], right: CompareToken[] }}
   */
  function finalizeIsland(island) {
    const left = trimIslandTokens(island.left);
    const right = trimIslandTokens(island.right);
    const leftChanged = left.some((token) => token.type !== "equal");
    const rightChanged = right.some((token) => token.type !== "equal");

    if (leftChanged && !rightChanged) {
      right.push({ type: "spot", value: " " });
    }

    if (rightChanged && !leftChanged) {
      left.push({ type: "spot", value: " " });
    }

    return { left, right };
  }

  /**
   * Склеивает соседние удаления и вставки в замены.
   * @param {CompareLine[]} chunks
   * @returns {CompareLine[]}
   */
  function mergeReplaceChunks(chunks) {
    /** @type {CompareLine[]} */
    const merged = [];
    let index = 0;

    while (index < chunks.length) {
      const current = chunks[index];

      if (current.type !== "delete" && current.type !== "insert") {
        merged.push(current);
        index += 1;
        continue;
      }

      /** @type {CompareLine[]} */
      const deletes = [];
      /** @type {CompareLine[]} */
      const inserts = [];

      while (index < chunks.length && (chunks[index].type === "delete" || chunks[index].type === "insert")) {
        if (chunks[index].type === "delete") {
          deletes.push(chunks[index]);
        } else {
          inserts.push(chunks[index]);
        }

        index += 1;
      }

      const pairCount = Math.min(deletes.length, inserts.length);

      for (let pair = 0; pair < pairCount; pair += 1) {
        const tokens = diffTokens(deletes[pair].left, inserts[pair].right);

        merged.push({
          type: "replace",
          left: deletes[pair].left,
          right: inserts[pair].right,
          leftLine: deletes[pair].leftLine,
          rightLine: inserts[pair].rightLine,
          leftTokens: tokens?.left ?? null,
          rightTokens: tokens?.right ?? null,
        });
      }

      for (let rest = pairCount; rest < deletes.length; rest += 1) {
        merged.push(deletes[rest]);
      }

      for (let rest = pairCount; rest < inserts.length; rest += 1) {
        merged.push(inserts[rest]);
      }
    }

    return merged;
  }

  /**
   * Сравнивает два текста построчно и внутри изменённых строк.
   * @param {string} left
   * @param {string} right
   * @returns {CompareResult}
   */
  function compareTexts(left, right) {
    const empty = left.length === 0 && right.length === 0;

    if (empty) {
      return { lines: [], added: 0, removed: 0, changed: 0, homoglyphs: 0, equal: true, empty: true };
    }

    const leftLines = splitLines(left);
    const rightLines = splitLines(right);
    const lines = mergeReplaceChunks(diffLinesLcs(leftLines, rightLines));
    let added = 0;
    let removed = 0;
    let changed = 0;
    let homoglyphs = 0;

    lines.forEach((line) => {
      homoglyphs += countHomoglyphs(line.leftTokens);

      if (line.type === "insert") {
        added += 1;
      } else if (line.type === "delete") {
        removed += 1;
      } else if (line.type === "replace") {
        changed += 1;
      }
    });

    return {
      lines,
      added,
      removed,
      changed,
      homoglyphs,
      equal: added === 0 && removed === 0 && changed === 0,
      empty: false,
    };
  }

  /**
   * Склоняет числительное.
   * @param {number} value
   * @param {string} one
   * @param {string} few
   * @param {string} many
   * @returns {string}
   */
  function pluralize(value, one, few, many) {
    const abs = Math.abs(value) % 100;
    const last = abs % 10;

    if (abs > 10 && abs < 20) {
      return many;
    }

    if (last > 1 && last < 5) {
      return few;
    }

    if (last === 1) {
      return one;
    }

    return many;
  }

  /**
   * Собирает краткую сводку отличий.
   * @param {CompareResult} result
   * @returns {string}
   */
  function formatCompareSummary(result) {
    const total = result.added + result.removed + result.changed;
    /** @type {string[]} */
    const parts = [];

    if (result.added > 0) {
      parts.push(`+${result.added} добавлено`);
    }

    if (result.removed > 0) {
      parts.push(`−${result.removed} удалено`);
    }

    if (result.changed > 0) {
      parts.push(`~${result.changed} изменено`);
    }

    if (result.homoglyphs > 0) {
      parts.push(
        `${result.homoglyphs} ${pluralize(result.homoglyphs, "подмена", "подмены", "подмен")} алфавита`,
      );
    }

    return `${total} ${pluralize(total, "отличие", "отличия", "отличий")}: ${parts.join(", ")}`;
  }

  /**
   * Добавляет текстовые токены в строку подсветки.
   * @param {HTMLElement} row
   * @param {CompareToken[] | null} tokens
   * @param {string} fallback
   * @param {"left" | "right"} side
   * @param {boolean} [withBadge]
   * @param {boolean} [hunkMode]
   * @returns {void}
   */
  function appendTokens(row, tokens, fallback, side, withBadge = false, hunkMode = false) {
    if (!tokens || tokens.length === 0) {
      if (hunkMode) {
        const mark = document.createElement("mark");
        mark.className = "comparer-mark comparer-mark--spot";
        mark.title = "Здесь отличие";
        mark.textContent = "\u00a0";
        row.append(mark);
        return;
      }

      row.textContent = fallback === "" ? "\u00a0" : fallback;
      return;
    }

    tokens.forEach((token) => {
      if (token.type === "equal") {
        row.append(document.createTextNode(token.value));
        return;
      }

      if (token.type === "spot") {
        const mark = document.createElement("mark");
        mark.className = "comparer-mark comparer-mark--spot";
        mark.title = "Здесь отличие";
        mark.textContent = "\u00a0";
        row.append(mark);
        return;
      }

      if (token.type === "homoglyph") {
        const mark = document.createElement("mark");
        mark.className = hunkMode
          ? "comparer-mark comparer-mark--spot comparer-mark--homoglyph"
          : "comparer-mark comparer-mark--homoglyph";
        mark.title = `${formatGlyph(token.value)} (${scriptFullLabel(token.script ?? "")}) ≠ ${formatGlyph(token.otherValue ?? "")} (${scriptFullLabel(token.otherScript ?? "")})`;
        mark.textContent = token.value;

        if (withBadge) {
          const badge = document.createElement("span");
          badge.className = "comparer-mark-script";
          badge.textContent = scriptShortLabel(token.script ?? "");
          mark.append(badge);
        }

        row.append(mark);
        return;
      }

      if (side === "left" && token.type !== "delete") {
        row.append(document.createTextNode(token.value));
        return;
      }

      if (side === "right" && token.type !== "insert") {
        row.append(document.createTextNode(token.value));
        return;
      }

      const mark = document.createElement("mark");
      mark.className = hunkMode
        ? "comparer-mark comparer-mark--spot"
        : token.type === "delete"
          ? "comparer-mark comparer-mark--delete"
          : "comparer-mark comparer-mark--insert";
      mark.title = hunkMode ? "Здесь отличие" : "";
      mark.textContent = token.value;
      row.append(mark);
    });
  }

  /**
   * Рисует подсветку одной стороны в слое над полем ввода.
   * @param {HTMLElement} root
   * @param {string} text
   * @param {CompareResult} result
   * @param {"left" | "right"} side
   * @returns {void}
   */
  function renderComparePane(root, text, result, side) {
    root.replaceChildren();

    if (text.length === 0) {
      return;
    }

    /** @type {Map<number, CompareLine>} */
    const byLine = new Map();

    result.lines.forEach((line) => {
      const number = side === "left" ? line.leftLine : line.rightLine;

      if (number <= 0) {
        return;
      }

      if (side === "left" && line.type === "insert") {
        return;
      }

      if (side === "right" && line.type === "delete") {
        return;
      }

      byLine.set(number - 1, line);
    });

    const fragment = document.createDocumentFragment();

    splitLines(text).forEach((content, index) => {
      const row = document.createElement("div");
      const info = byLine.get(index);
      const type = info?.type ?? "equal";

      row.className = "comparer-line";

      if (type === "delete" && side === "left") {
        row.classList.add("comparer-line--delete");
        row.textContent = content === "" ? "\u00a0" : content;
      } else if (type === "insert" && side === "right") {
        row.classList.add("comparer-line--insert");
        row.textContent = content === "" ? "\u00a0" : content;
      } else if (type === "replace") {
        const detailTokens = (side === "left" ? info?.leftTokens ?? [] : info?.rightTokens ?? []).filter(
          (token) => token.type !== "spot",
        );
        const lineHasDetail =
          (info?.leftTokens ?? []).some((token) => token.type !== "equal") ||
          (info?.rightTokens ?? []).some((token) => token.type !== "equal");

        if (!lineHasDetail) {
          row.classList.add("comparer-line--replace");
        }

        if (countHomoglyphs(info?.leftTokens ?? null) > 0) {
          row.classList.add("comparer-line--homoglyph");
        }

        appendTokens(row, detailTokens, content, side);
      } else {
        row.textContent = content === "" ? "\u00a0" : content;
      }

      fragment.append(row);
    });

    root.append(fragment);
  }

  /**
   * Создаёт строку списка отличий.
   * @param {string} className
   * @param {string} meta
   * @param {string} sign
   * @param {CompareToken[] | null} tokens
   * @param {string} fallback
   * @param {"left" | "right"} side
   * @param {boolean} [skipClip]
   * @returns {HTMLElement}
   */
  function createHunkRow(className, meta, sign, tokens, fallback, side, skipClip = false) {
    const row = document.createElement("div");
    row.className = `comparer-hunk ${className}`;

    const metaElement = document.createElement("span");
    metaElement.className = "comparer-hunk-meta";
    metaElement.textContent = meta;

    const signElement = document.createElement("span");
    signElement.className = "comparer-hunk-sign";
    signElement.textContent = sign;

    const valueElement = document.createElement("span");
    valueElement.className = "comparer-hunk-value";
    const clipped = skipClip ? { tokens, fallback } : clipTokensAroundChange(tokens, fallback);
    appendTokens(valueElement, clipped.tokens, clipped.fallback, side, true, true);

    row.append(metaElement, signElement, valueElement);
    return row;
  }

  /**
   * Рисует список отличий относительно текста 1.
   * @param {HTMLElement} root
   * @param {CompareResult} result
   * @returns {void}
   */
  function renderCompareDiff(root, result) {
    root.replaceChildren();

    if (result.empty) {
      const empty = document.createElement("p");
      empty.className = "results-empty formatter-empty";
      empty.textContent = "Вставьте тексты слева и справа — ниже появятся отличия.";
      root.append(empty);
      return;
    }

    if (result.equal) {
      const same = document.createElement("p");
      same.className = "comparer-same";
      same.textContent = "Тексты совпадают.";
      root.append(same);
      return;
    }

    const stats = document.createElement("p");
    stats.className = "comparer-stats";
    stats.textContent = formatCompareSummary(result);
    root.append(stats);

    const list = document.createElement("div");
    list.className = "comparer-hunks";

    result.lines.forEach((line) => {
      if (line.type === "equal") {
        return;
      }

      if (line.type === "delete") {
        list.append(
          createHunkRow(
            "comparer-hunk--delete",
            `строка ${line.leftLine}`,
            "−",
            null,
            line.left,
            "left",
          ),
        );
        return;
      }

      if (line.type === "insert") {
        const insertAfter = line.leftLine - 1;
        list.append(
          createHunkRow(
            "comparer-hunk--insert",
            insertAfter <= 0 ? "в начале" : `после строки ${insertAfter}`,
            "+",
            null,
            line.right,
            "right",
          ),
        );
        return;
      }

      const islands = splitHunkIslands(line.leftTokens ?? [], line.rightTokens ?? []);
      const groups = islands.length > 0 ? islands : [{ left: line.leftTokens ?? [], right: line.rightTokens ?? [] }];

      groups.forEach((island, islandIndex) => {
        const group = document.createElement("div");
        const notes = collectHomoglyphNotes(island.left);
        const placeLabel = groups.length > 1 ? ` · место ${islandIndex + 1}` : "";
        group.className = notes.length > 0 ? "comparer-hunk-group comparer-hunk-group--homoglyph" : "comparer-hunk-group";
        group.append(
          createHunkRow(
            notes.length > 0 ? "comparer-hunk--homoglyph" : "comparer-hunk--delete",
            `строка ${line.leftLine}${placeLabel}`,
            "−",
            island.left,
            line.left,
            "left",
            true,
          ),
          createHunkRow(
            notes.length > 0 ? "comparer-hunk--homoglyph" : "comparer-hunk--insert",
            `строка ${line.rightLine} текста 2${placeLabel}`,
            "+",
            island.right,
            line.right,
            "right",
            true,
          ),
        );

        if (notes.length > 0) {
          const note = document.createElement("p");
          note.className = "comparer-hunk-note";
          note.textContent = `Разный алфавит: ${notes.join("; ")}`;
          group.append(note);
        }

        list.append(group);
      });
    });

    root.append(list);
  }

  /** @type {import("./types.js").HelperDefinition} */
  const compareHelper = {
    id: "compare",
    title: "Сравнение текстов",
    description:
      "Вставьте исходный текст слева и текст №2 справа. Отличающиеся фрагменты подсветятся в обоих блоках, ниже появится список изменений относительно текста 1. Буквы, которые выглядят одинаково, но относятся к разным алфавитам (латиница и кириллица), выделяются отдельно.",
    mode: "comparer",
    resultsTitle: "Отличия от текста 1",
    fields: [
      {
        name: "source",
        type: "textarea",
        label: "Текст 1",
        defaultValue: "",
        rows: 18,
        placeholder: "Исходный текст",
      },
      {
        name: "compare",
        type: "textarea",
        label: "Текст 2",
        defaultValue: "",
        rows: 18,
        placeholder: "Текст для сравнения",
      },
    ],
    resultFields: [{ key: "summary", label: "Отличия" }],
    generate: (values) => {
      const result = compareTexts(values.source ?? "", values.compare ?? "");

      return {
        summary: result.empty ? "" : result.equal ? "Тексты совпадают." : formatCompareSummary(result),
        added: String(result.added),
        removed: String(result.removed),
        changed: String(result.changed),
        homoglyphs: String(result.homoglyphs),
        equal: result.equal ? "1" : "0",
        empty: result.empty ? "1" : "0",
      };
    },
  };

  Helpers.compareTexts = compareTexts;
  Helpers.renderComparePane = renderComparePane;
  Helpers.renderCompareDiff = renderCompareDiff;
  Helpers.compareHelper = compareHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
