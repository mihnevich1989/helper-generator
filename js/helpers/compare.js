(function (Helpers) {
  const LCS_CELL_LIMIT = 150000;
  const INLINE_CELL_LIMIT = 40000;
  const RESYNC_WINDOW = 80;

  /**
   * @typedef {"equal" | "insert" | "delete" | "replace"} CompareOp
   */

  /**
   * @typedef {Object} CompareToken
   * @property {"equal" | "insert" | "delete"} type
   * @property {string} value
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
   * Считает пословный diff двух строк.
   * @param {string} left
   * @param {string} right
   * @returns {{ left: CompareToken[], right: CompareToken[] } | null}
   */
  function diffTokens(left, right) {
    const leftTokens = tokenizeLine(left);
    const rightTokens = tokenizeLine(right);

    if (leftTokens.length * rightTokens.length > INLINE_CELL_LIMIT) {
      return null;
    }

    const table = buildLcsTable(leftTokens, rightTokens);

    if (!table) {
      return null;
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
      return { lines: [], added: 0, removed: 0, changed: 0, equal: true, empty: true };
    }

    const leftLines = splitLines(left);
    const rightLines = splitLines(right);
    const lines = mergeReplaceChunks(diffLinesLcs(leftLines, rightLines));
    let added = 0;
    let removed = 0;
    let changed = 0;

    lines.forEach((line) => {
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

    return `${total} ${pluralize(total, "отличие", "отличия", "отличий")}: ${parts.join(", ")}`;
  }

  /**
   * Добавляет текстовые токены в строку подсветки.
   * @param {HTMLElement} row
   * @param {CompareToken[] | null} tokens
   * @param {string} fallback
   * @param {"left" | "right"} side
   * @returns {void}
   */
  function appendTokens(row, tokens, fallback, side) {
    if (!tokens || tokens.length === 0) {
      row.textContent = fallback === "" ? "\u00a0" : fallback;
      return;
    }

    tokens.forEach((token) => {
      if (token.type === "equal") {
        row.append(document.createTextNode(token.value));
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
      mark.className = token.type === "delete" ? "comparer-mark comparer-mark--delete" : "comparer-mark comparer-mark--insert";
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
        row.classList.add("comparer-line--replace");
        appendTokens(row, side === "left" ? info?.leftTokens ?? null : info?.rightTokens ?? null, content, side);
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
   * @returns {HTMLElement}
   */
  function createHunkRow(className, meta, sign, tokens, fallback, side) {
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
    appendTokens(valueElement, tokens, fallback, side);

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

      const group = document.createElement("div");
      group.className = "comparer-hunk-group";
      group.append(
        createHunkRow(
          "comparer-hunk--delete",
          `строка ${line.leftLine}`,
          "−",
          line.leftTokens,
          line.left,
          "left",
        ),
        createHunkRow(
          "comparer-hunk--insert",
          `строка ${line.rightLine} текста 2`,
          "+",
          line.rightTokens,
          line.right,
          "right",
        ),
      );
      list.append(group);
    });

    root.append(list);
  }

  /** @type {import("./types.js").HelperDefinition} */
  const compareHelper = {
    id: "compare",
    title: "Сравнение текстов",
    description:
      "Вставьте исходный текст слева и текст №2 справа. Отличающиеся фрагменты подсветятся в обоих блоках, ниже появится список изменений относительно текста 1.",
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
