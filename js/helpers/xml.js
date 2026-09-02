(function (Helpers) {
  const INDENT = "  ";
  const TOKEN_PATTERN =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<\/[^>]+>|<[^>]+>|[^<]+/g;

  /**
   * Снимает экранирование типовых escape-последовательностей.
   * @param {string} value
   * @returns {string}
   */
  function unescapeString(value) {
    return value.replace(/\\([nrt"'\\])/g, (_match, symbol) => {
      /** @type {Record<string, string>} */
      const escapes = {
        n: "\n",
        r: "\r",
        t: "\t",
        '"': '"',
        "'": "'",
        "\\": "\\",
      };

      return escapes[symbol] ?? symbol;
    });
  }

  /**
   * Если в тексте нет настоящих переносов, но есть `\n` / `\t`, разворачивает их.
   * @param {string} value
   * @returns {string}
   */
  function expandEscapedWhitespace(value) {
    if (value.includes("\n") || value.includes("\r")) {
      return value;
    }

    if (!value.includes("\\n") && !value.includes("\\t") && !value.includes("\\r")) {
      return value;
    }

    return unescapeString(value);
  }

  /**
   * Извлекает строки из массивоподобного текста с кавычками.
   * @param {string} source
   * @returns {string[]}
   */
  function extractQuotedStrings(source) {
    /** @type {string[]} */
    const items = [];
    let index = 0;

    while (index < source.length) {
      const quote = source[index];

      if (quote !== '"' && quote !== "'") {
        index += 1;
        continue;
      }

      let value = "";
      index += 1;

      while (index < source.length) {
        const current = source[index];

        if (current === "\\") {
          const next = source[index + 1] ?? "";
          value += unescapeString(`\\${next}`);
          index += 2;
          continue;
        }

        if (current === quote) {
          items.push(value);
          index += 1;
          break;
        }

        value += current;
        index += 1;
      }
    }

    return items;
  }

  /**
   * Определяет, похож ли ввод на массив или конкатенацию строк.
   * @param {string} raw
   * @returns {boolean}
   */
  function looksLikeArray(raw) {
    const trimmed = raw.trim();

    if (
      trimmed.startsWith("<") ||
      trimmed.startsWith("&lt;") ||
      trimmed.startsWith("<?xml") ||
      trimmed.startsWith("<!--")
    ) {
      return false;
    }

    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      return true;
    }

    return (
      /String\s*\[\s*\]/.test(trimmed) ||
      /\[\s*\]\s*\{/.test(trimmed) ||
      /=\s*\{/.test(trimmed) ||
      /new\s+\w+\s*\[\s*\]/.test(trimmed) ||
      /\+\s*["']/.test(trimmed)
    );
  }

  /**
   * Пытается прочитать вход как JSON, массив или склейку строк.
   * @param {string} raw
   * @returns {string[] | null}
   */
  function parseArrayItems(raw) {
    try {
      const parsed = JSON.parse(raw);

      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item));
      }

      if (typeof parsed === "string") {
        return [parsed];
      }
    } catch {
      // Не JSON — пробуем разобрать кавычки вручную.
    }

    if (!looksLikeArray(raw)) {
      return null;
    }

    const items = extractQuotedStrings(raw);

    return items.length > 0 ? items : null;
  }

  /**
   * Декодирует HTML-сущности, если в тексте нет «живых» тегов.
   * @param {string} value
   * @returns {string}
   */
  function decodeHtmlEntities(value) {
    if (value.includes("<") || !value.includes("&lt;")) {
      return value;
    }

    const textarea = document.createElement("textarea");
    textarea.innerHTML = value;

    return textarea.value;
  }

  /**
   * @typedef {Object} XmlTagRead
   * @property {string} name
   * @property {"open" | "close"} type
   * @property {boolean} selfClosing
   * @property {number} end
   */

  /**
   * Читает тег с учётом кавычек в атрибутах.
   * @param {string} source
   * @param {number} start
   * @returns {XmlTagRead | null}
   */
  function readTag(source, start) {
    if (source[start] !== "<") {
      return null;
    }

    let index = start + 1;
    const isClose = source[index] === "/";

    if (isClose) {
      index += 1;
    }

    const nameStart = index;

    while (index < source.length && /[\w:.-]/.test(source[index] ?? "")) {
      index += 1;
    }

    const name = source.slice(nameStart, index);

    if (!name) {
      return null;
    }

    let quote = "";

    while (index < source.length) {
      const current = source[index] ?? "";

      if (quote) {
        if (current === quote) {
          quote = "";
        }

        index += 1;
        continue;
      }

      if (current === '"' || current === "'") {
        quote = current;
        index += 1;
        continue;
      }

      if (current === "/" && source[index + 1] === ">") {
        return { name, type: isClose ? "close" : "open", selfClosing: true, end: index + 2 };
      }

      if (current === ">") {
        return { name, type: isClose ? "close" : "open", selfClosing: false, end: index + 1 };
      }

      index += 1;
    }

    return null;
  }

  /**
   * Пропускает пробелы и закрывающую скобку лога `[xml]`.
   * @param {string} source
   * @param {number} index
   * @returns {number}
   */
  function skipTrailingBracket(source, index) {
    let next = index;

    while (next < source.length && /\s/.test(source[next] ?? "")) {
      next += 1;
    }

    if (source[next] === "]") {
      return next + 1;
    }

    return index;
  }

  /**
   * Ищет начало XML-документа в произвольном тексте.
   * @param {string} source
   * @param {number} from
   * @returns {number}
   */
  function findXmlStart(source, from) {
    for (let index = from; index < source.length; index += 1) {
      if (source.startsWith("<?xml", index) || source.startsWith("<?XML", index)) {
        return index;
      }

      if (source[index] === "<" && /[A-Za-z_:]/.test(source[index + 1] ?? "")) {
        return index;
      }
    }

    return -1;
  }

  /**
   * Читает один XML-документ от declaration или корневого тега.
   * @param {string} source
   * @param {number} start
   * @returns {{ xml: string, end: number } | null}
   */
  function readXmlDocument(source, start) {
    let index = start;

    if (source.startsWith("<?xml", index) || source.startsWith("<?XML", index)) {
      const declarationEnd = source.indexOf("?>", index);

      if (declarationEnd === -1) {
        return null;
      }

      index = declarationEnd + 2;

      while (index < source.length && /\s/.test(source[index] ?? "")) {
        index += 1;
      }
    }

    const root = readTag(source, index);

    if (!root || root.type === "close") {
      return null;
    }

    if (root.selfClosing) {
      return { xml: source.slice(start, root.end), end: skipTrailingBracket(source, root.end) };
    }

    let depth = 1;
    index = root.end;

    while (index < source.length && depth > 0) {
      const nextTagStart = source.indexOf("<", index);

      if (nextTagStart === -1) {
        return null;
      }

      if (source.startsWith("<!--", nextTagStart)) {
        const commentEnd = source.indexOf("-->", nextTagStart + 4);

        if (commentEnd === -1) {
          return null;
        }

        index = commentEnd + 3;
        continue;
      }

      if (source.startsWith("<![CDATA[", nextTagStart)) {
        const cdataEnd = source.indexOf("]]>", nextTagStart + 9);

        if (cdataEnd === -1) {
          return null;
        }

        index = cdataEnd + 3;
        continue;
      }

      if (source.startsWith("<?", nextTagStart)) {
        const instructionEnd = source.indexOf("?>", nextTagStart + 2);

        if (instructionEnd === -1) {
          return null;
        }

        index = instructionEnd + 2;
        continue;
      }

      const tag = readTag(source, nextTagStart);

      if (!tag) {
        return null;
      }

      if (tag.type === "close" && tag.name === root.name) {
        depth -= 1;
      } else if (tag.type === "open" && tag.name === root.name && !tag.selfClosing) {
        depth += 1;
      }

      index = tag.end;
    }

    if (depth !== 0) {
      return null;
    }

    return { xml: source.slice(start, index), end: skipTrailingBracket(source, index) };
  }

  /**
   * Достаёт все XML-документы из лога, скобок `[xml]` и смешанного текста.
   * @param {string} raw
   * @returns {string[]}
   */
  function extractXmlDocuments(raw) {
    /** @type {string[]} */
    const documents = [];
    let index = 0;

    while (index < raw.length) {
      const start = findXmlStart(raw, index);

      if (start === -1) {
        break;
      }

      const document = readXmlDocument(raw, start);

      if (!document) {
        index = start + 1;
        continue;
      }

      documents.push(document.xml);
      index = document.end;
    }

    return documents;
  }

  /**
   * Форматирует список XML-документов.
   * @param {string[]} documents
   * @returns {string}
   */
  function formatDocuments(documents) {
    return documents
      .map((document, index) => {
        const formatted = formatXmlDocument(expandEscapedWhitespace(decodeHtmlEntities(document)));

        if (documents.length === 1) {
          return formatted;
        }

        return `<!-- документ ${index + 1} -->\n${formatted}`;
      })
      .join("\n\n");
  }

  /**
   * Собирает исходный XML из чистого текста или массива строк.
   * @param {string} raw
   * @returns {string}
   */
  function resolveXmlSource(raw) {
    const trimmed = raw.trim();

    if (!trimmed) {
      return "";
    }

    const items = parseArrayItems(trimmed);

    if (items) {
      return expandEscapedWhitespace(items.join(""));
    }

    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      const inner = trimmed.slice(1, -1).trim();

      if (inner.startsWith("<") || inner.startsWith("&lt;") || inner.startsWith("<?xml")) {
        return expandEscapedWhitespace(decodeHtmlEntities(inner));
      }
    }

    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
      return expandEscapedWhitespace(unescapeString(trimmed.slice(1, -1)));
    }

    return expandEscapedWhitespace(decodeHtmlEntities(trimmed));
  }

  /**
   * @typedef {"open" | "close" | "empty" | "declare" | "comment" | "cdata" | "text"} XmlTokenType
   */

  /**
   * @typedef {Object} XmlToken
   * @property {XmlTokenType} type
   * @property {string} value
   */

  /**
   * Имя тега без префикса пространства имён не трогаем — берём как есть.
   * @param {string} tag
   * @returns {string}
   */
  function getTagName(tag) {
    const match = tag.match(/^<\/?\s*([^\s>/]+)/);

    return match?.[1] ?? "";
  }

  /**
   * Разбивает XML на теги, текст, комментарии и CDATA.
   * @param {string} xml
   * @returns {XmlToken[]}
   */
  function tokenizeXml(xml) {
    /** @type {XmlToken[]} */
    const tokens = [];
    const matches = xml.match(TOKEN_PATTERN) ?? [];

    matches.forEach((value) => {
      if (value.startsWith("<!--")) {
        tokens.push({ type: "comment", value });
        return;
      }

      if (value.startsWith("<![CDATA[")) {
        tokens.push({ type: "cdata", value });
        return;
      }

      if (value.startsWith("<?")) {
        tokens.push({ type: "declare", value });
        return;
      }

      if (value.startsWith("</")) {
        tokens.push({ type: "close", value });
        return;
      }

      if (value.startsWith("<")) {
        const isEmpty = /\/\s*>$/.test(value) || /^<!/.test(value);
        tokens.push({ type: isEmpty ? "empty" : "open", value });
        return;
      }

      tokens.push({ type: "text", value });
    });

    return tokens;
  }

  /**
   * Собирает читаемый XML с переносами и отступами по токенам.
   * @param {XmlToken[]} tokens
   * @returns {string}
   */
  function formatTokens(tokens) {
    /** @type {string[]} */
    const lines = [];
    let level = 0;
    let index = 0;

    while (index < tokens.length) {
      const token = tokens[index];
      const next = tokens[index + 1];
      const afterNext = tokens[index + 2];

      if (token.type === "text") {
        const text = token.value.trim();

        if (text) {
          lines.push(`${INDENT.repeat(level)}${text}`);
        }

        index += 1;
        continue;
      }

      if (token.type === "close") {
        level = Math.max(0, level - 1);
        lines.push(`${INDENT.repeat(level)}${token.value.trim()}`);
        index += 1;
        continue;
      }

      const openThenClose =
        token.type === "open" &&
        next?.type === "close" &&
        getTagName(token.value) === getTagName(next.value);

      if (openThenClose) {
        lines.push(`${INDENT.repeat(level)}${token.value}${next.value}`);
        index += 2;
        continue;
      }

      const openTextClose =
        token.type === "open" &&
        next?.type === "text" &&
        afterNext?.type === "close" &&
        getTagName(token.value) === getTagName(afterNext.value) &&
        !next.value.includes("<");

      if (openTextClose) {
        const text = next.value.trim();
        lines.push(`${INDENT.repeat(level)}${token.value}${text}${afterNext.value}`);
        index += 3;
        continue;
      }

      if (token.type === "open") {
        lines.push(`${INDENT.repeat(level)}${token.value.trim()}`);
        level += 1;
        index += 1;
        continue;
      }

      lines.push(`${INDENT.repeat(level)}${token.value.trim()}`);
      index += 1;
    }

    return lines.join("\n");
  }

  /**
   * Создаёт span для подсветки XML.
   * @param {string} className
   * @param {string} text
   * @returns {HTMLSpanElement}
   */
  function createHighlightSpan(className, text) {
    const span = document.createElement("span");
    span.className = className;
    span.textContent = text;
    return span;
  }

  /**
   * Подсвечивает имя тега или атрибута с префиксом пространства имён.
   * @param {DocumentFragment} fragment
   * @param {string} name
   * @param {string} nameClass
   * @param {string} prefixClass
   * @returns {void}
   */
  function appendHighlightedName(fragment, name, nameClass, prefixClass) {
    const colonIndex = name.indexOf(":");

    if (colonIndex === -1) {
      fragment.append(createHighlightSpan(nameClass, name));
      return;
    }

    fragment.append(createHighlightSpan(prefixClass, name.slice(0, colonIndex)));
    fragment.append(createHighlightSpan("xh-punct", ":"));
    fragment.append(createHighlightSpan(nameClass, name.slice(colonIndex + 1)));
  }

  /**
   * Подсвечивает тег вместе с атрибутами.
   * @param {DocumentFragment} fragment
   * @param {string} tag
   * @returns {void}
   */
  function appendHighlightedTag(fragment, tag) {
    let index = 0;

    if (tag.startsWith("</")) {
      fragment.append(createHighlightSpan("xh-punct", "</"));
      index = 2;
    } else if (tag.startsWith("<")) {
      fragment.append(createHighlightSpan("xh-punct", "<"));
      index = 1;
    }

    const nameMatch = tag.slice(index).match(/^([^\s>/]+)/);

    if (nameMatch) {
      appendHighlightedName(fragment, nameMatch[1], "xh-tag", "xh-ns");
      index += nameMatch[1].length;
    }

    while (index < tag.length) {
      const rest = tag.slice(index);

      if (/^\/?>/.test(rest)) {
        fragment.append(createHighlightSpan("xh-punct", rest));
        return;
      }

      const spaces = rest.match(/^\s+/);

      if (spaces) {
        fragment.append(document.createTextNode(spaces[0]));
        index += spaces[0].length;
        continue;
      }

      const attribute = rest.match(/^([^\s=/>]+)(\s*)(=)(\s*)(("[^"]*"|'[^']*'))?/);

      if (attribute) {
        appendHighlightedName(fragment, attribute[1], "xh-attr", "xh-ns");

        if (attribute[2]) {
          fragment.append(document.createTextNode(attribute[2]));
        }

        if (attribute[3]) {
          fragment.append(createHighlightSpan("xh-punct", attribute[3]));
        }

        if (attribute[4]) {
          fragment.append(document.createTextNode(attribute[4]));
        }

        if (attribute[5]) {
          fragment.append(createHighlightSpan("xh-value", attribute[5]));
        }

        index += attribute[0].length;
        continue;
      }

      fragment.append(document.createTextNode(tag.slice(index)));
      return;
    }
  }

  /**
   * Подсвечивает XML-декларацию или processing instruction.
   * @param {DocumentFragment} fragment
   * @param {string} value
   * @returns {void}
   */
  function appendHighlightedDeclaration(fragment, value) {
    const match = value.match(/^(<\?\s*)([^\s?]+)([\s\S]*?)(\?>)$/);

    if (!match) {
      fragment.append(createHighlightSpan("xh-decl", value));
      return;
    }

    fragment.append(createHighlightSpan("xh-punct", match[1]));
    fragment.append(createHighlightSpan("xh-tag", match[2]));
    appendHighlightedTag(fragment, ` ${match[3].trim()} `);
    fragment.append(createHighlightSpan("xh-punct", match[4]));
  }

  /**
   * Собирает подсвеченный XML без вставки сырого HTML.
   * @param {string} xml
   * @returns {DocumentFragment}
   */
  function highlightXml(xml) {
    const fragment = document.createDocumentFragment();

    tokenizeXml(xml).forEach((token) => {
      if (token.type === "comment") {
        fragment.append(createHighlightSpan("xh-comment", token.value));
        return;
      }

      if (token.type === "cdata") {
        fragment.append(createHighlightSpan("xh-cdata", token.value));
        return;
      }

      if (token.type === "declare") {
        appendHighlightedDeclaration(fragment, token.value);
        return;
      }

      if (token.type === "text") {
        fragment.append(createHighlightSpan("xh-text", token.value));
        return;
      }

      appendHighlightedTag(fragment, token.value);
    });

    return fragment;
  }

  /**
   * Форматирует XML переносами и отступами.
   * @param {string} xml
   * @returns {string}
   */
  function formatXmlDocument(xml) {
    const source = xml.replace(/^\uFEFF/, "").trim();

    if (!source) {
      return "";
    }

    return formatTokens(tokenizeXml(source));
  }

  /**
   * Форматирует вход: чистый XML, массив строк или лог с несколькими документами.
   * @param {string} raw
   * @returns {string}
   */
  function formatXmlInput(raw) {
    const trimmed = raw.trim();

    if (!trimmed) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed);

      if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
        const joined = parsed.join("");
        const nestedDocuments = extractXmlDocuments(joined);

        if (nestedDocuments.length > 0) {
          return formatDocuments(nestedDocuments);
        }

        return formatXmlDocument(expandEscapedWhitespace(joined));
      }

      if (typeof parsed === "string") {
        return formatXmlInput(parsed);
      }
    } catch {
      // Не JSON — ищем XML в тексте лога.
    }

    const documents = extractXmlDocuments(trimmed);

    if (documents.length > 0) {
      return formatDocuments(documents);
    }

    const source = resolveXmlSource(trimmed);

    if (!source.trim()) {
      return "";
    }

    return formatXmlDocument(source);
  }

  /** @type {import("./types.js").HelperDefinition} */
  const xmlHelper = {
    id: "xml",
    title: "XML форматтер",
    description:
      "Вставьте XML слева — справа появится читаемый документ с переносами и отступами. Подходят одна строка, массив строк и логи вида [xml] for request [xml].",
    mode: "formatter",
    resultsTitle: "Отформатированный XML",
    fields: [
      {
        name: "source",
        type: "textarea",
        label: "Исходный XML",
        defaultValue: "",
        rows: 22,
        placeholder: "<root><item>значение</item></root>\nили\n[\"<root><item>значение</item></root>\"]",
      },
    ],
    resultFields: [{ key: "formatted", label: "XML" }],
    generate: (values) => {
      const formatted = formatXmlInput(values.source ?? "");

      return { formatted };
    },
  };

  Helpers.formatXmlInput = formatXmlInput;
  Helpers.highlightXml = highlightXml;
  Helpers.xmlHelper = xmlHelper;
})(globalThis.Helpers = globalThis.Helpers || {});
