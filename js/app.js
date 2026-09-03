const helpers = globalThis.Helpers.helpers;
const getHelperById = globalThis.Helpers.getHelperById;
const historyStore = globalThis.Helpers.historyStore;
const highlightXml = globalThis.Helpers.highlightXml;
const compareTexts = globalThis.Helpers.compareTexts;
const renderComparePane = globalThis.Helpers.renderComparePane;
const renderCompareDiff = globalThis.Helpers.renderCompareDiff;

const navElement = document.querySelector("[data-nav]");
const titleElement = document.querySelector("[data-title]");
const descriptionElement = document.querySelector("[data-description]");
const fieldsElement = document.querySelector("[data-fields]");
const resultsElement = document.querySelector("[data-results]");
const resultsTitleElement = document.querySelector("[data-results-title]");
const formElement = document.querySelector("[data-form]");
const generateButton = document.querySelector("[data-generate]");
const historyElement = document.querySelector("[data-history]");
const historyClearButton = document.querySelector("[data-history-clear]");
const workspaceElement = document.querySelector(".workspace");
const appElement = document.querySelector(".app");

if (
  !helpers ||
  !historyStore ||
  !navElement ||
  !formElement ||
  !fieldsElement ||
  !resultsElement ||
  !resultsTitleElement ||
  !generateButton ||
  !historyElement ||
  !historyClearButton ||
  !workspaceElement ||
  !appElement
) {
  throw new Error("Не удалось инициализировать Helpers. Обновите страницу.");
}

/** @type {string} */
let activeHelperId = helpers[0]?.id ?? "";

/** @type {Record<string, string> | null} */
let currentResult = null;

/** @type {Record<string, Record<string, string>>} */
const helperResults = {};

/** @type {Record<string, Record<string, string>>} */
const helperFormState = {};

/** @type {number | null} */
let copyToastTimer = null;

/**
 * Собирает значения по умолчанию для полей хелпера.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @returns {Record<string, string>}
 */
function getFieldDefaults(helper) {
  /** @type {Record<string, string>} */
  const defaults = {};

  helper.fields.forEach((field) => {
    if (field.defaultValue !== undefined) {
      defaults[field.name] = field.defaultValue;
    }
  });

  return defaults;
}

/**
 * Читает значения полей текущей формы.
 * @returns {Record<string, string>}
 */
function getFormValues() {
  const helper = getHelperById(activeHelperId);
  /** @type {Record<string, string>} */
  const values = {
    ...(helper ? getFieldDefaults(helper) : {}),
    ...(helperFormState[activeHelperId] ?? {}),
  };
  const fields = formElement.querySelectorAll("[data-field]");

  fields.forEach((field) => {
    if (
      !(field instanceof HTMLSelectElement) &&
      !(field instanceof HTMLInputElement) &&
      !(field instanceof HTMLTextAreaElement)
    ) {
      return;
    }

    values[field.name] = field.value;
  });

  helperFormState[activeHelperId] = values;

  return values;
}

/**
 * Копирует текст в буфер обмена.
 * @param {string} value
 * @returns {Promise<boolean>}
 */
async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Копирует значение и при необходимости сохраняет карточку в историю.
 * @param {string} value
 * @param {HTMLButtonElement} button
 * @param {boolean} [shouldSave]
 * @returns {Promise<void>}
 */
async function handleCopy(value, button, shouldSave = false) {
  const copied = await copyText(value);

  if (!copied) {
    const originalLabel = button.textContent;
    button.textContent = "Ошибка";
    window.setTimeout(() => {
      button.textContent = originalLabel;
    }, 1200);
    return;
  }

  if (shouldSave) {
    saveCurrentResult();
  }

  const originalLabel = button.textContent;
  button.textContent = "Скопировано";
  button.disabled = true;

  window.setTimeout(() => {
    button.textContent = originalLabel;
    button.disabled = false;
  }, 1200);
}

/**
 * Убирает подсказку копирования над значением.
 * @returns {void}
 */
function hideCopyToast() {
  if (copyToastTimer !== null) {
    window.clearTimeout(copyToastTimer);
    copyToastTimer = null;
  }

  document.querySelectorAll(".copy-toast").forEach((toast) => {
    toast.remove();
  });
}

/**
 * Показывает подсказку над скопированным текстом.
 * @param {HTMLElement} anchor
 * @param {string} message
 * @returns {void}
 */
function showCopyToast(anchor, message) {
  hideCopyToast();

  const toast = document.createElement("span");
  toast.className = "copy-toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  anchor.append(toast);

  copyToastTimer = window.setTimeout(() => {
    toast.remove();
    copyToastTimer = null;
  }, 1200);
}

/**
 * Копирует значение по клику на текст и показывает подсказку над ним.
 * @param {string} value
 * @param {HTMLElement} anchor
 * @returns {Promise<void>}
 */
async function handleCopyFromValue(value, anchor) {
  const copied = await copyText(value);

  if (!copied) {
    showCopyToast(anchor, "Ошибка");
    return;
  }

  saveCurrentResult();
  showCopyToast(anchor, "Скопировано");
}

/**
 * Форматирует время копирования.
 * @param {number} timestamp
 * @returns {string}
 */
function formatCopiedAt(timestamp) {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

/**
 * Сохраняет текущий результат генератора после копирования.
 * @returns {void}
 */
function saveCurrentResult() {
  const helper = getHelperById(activeHelperId);

  if (!helper || !currentResult) {
    return;
  }

  historyStore.add(helper.id, helper.title, currentResult);
  renderHistory();
}

/**
 * Рисует компактную историю скопированных результатов.
 * @returns {void}
 */
function renderHistory() {
  const items = historyStore.load();
  historyElement.innerHTML = "";

  if (items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Скопируйте поле — карточка появится здесь.";
    historyElement.append(empty);
    return;
  }

  items.forEach((item) => {
    const helper = getHelperById(item.helperId);
    const card = document.createElement("article");
    card.className = "history-card";

    const top = document.createElement("div");
    top.className = "history-card-top";

    const title = document.createElement("span");
    title.className = "history-card-title";
    title.textContent = `${item.title} · ${formatCopiedAt(item.copiedAt)}`;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "history-card-remove";
    removeButton.textContent = "Удалить";
    removeButton.addEventListener("click", () => {
      historyStore.remove(item.id);
      renderHistory();
    });

    top.append(title, removeButton);
    card.append(top);

    const fields = helper?.resultFields ?? Object.keys(item.data).map((key) => ({ key, label: key }));

    fields.forEach((field) => {
      const value = item.data[field.key] ?? "";

      if (!value) {
        return;
      }

      const row = document.createElement("button");
      row.type = "button";
      row.className = "history-row";
      row.title = "Копировать";

      const label = document.createElement("span");
      label.className = "history-row-label";
      label.textContent = field.label;

      const valueElement = document.createElement("span");
      valueElement.className = "history-row-value";
      valueElement.textContent = value;

      row.append(label, valueElement);
      row.addEventListener("click", async () => {
        const copied = await copyText(value);

        if (!copied) {
          return;
        }

        const original = label.textContent;
        label.textContent = "Скопировано";
        window.setTimeout(() => {
          label.textContent = original;
        }, 1200);
      });
      card.append(row);
    });

    historyElement.append(card);
  });
}

/**
 * Рисует одну группу вкладок в сайдбаре.
 * @param {string} title
 * @param {readonly import("./helpers/types.js").HelperDefinition[]} items
 * @param {boolean} [withSeparator]
 * @returns {void}
 */
function appendNavGroup(title, items, withSeparator = false) {
  if (items.length === 0) {
    return;
  }

  if (withSeparator) {
    const separator = document.createElement("div");
    separator.className = "nav-separator";
    separator.setAttribute("role", "separator");
    navElement.append(separator);
  }

  const group = document.createElement("div");
  group.className = "nav-group";

  const caption = document.createElement("p");
  caption.className = "nav-group-title";
  caption.textContent = title;
  group.append(caption);

  items.forEach((helper) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.helperId = helper.id;
    button.setAttribute("aria-current", helper.id === activeHelperId ? "page" : "false");
    button.textContent = helper.title;
    group.append(button);
  });

  navElement.append(group);
}

/**
 * Рисует навигацию по хелперам.
 * @returns {void}
 */
function renderNav() {
  navElement.innerHTML = "";

  const generators = helpers.filter(
    (helper) => helper.mode !== "formatter" && helper.mode !== "comparer",
  );
  const formatters = helpers.filter((helper) => helper.mode === "formatter");
  const comparers = helpers.filter((helper) => helper.mode === "comparer");

  appendNavGroup("Генераторы", generators);
  appendNavGroup("Форматтеры", formatters, true);
  appendNavGroup("Сравнение", comparers, true);
}

/**
 * Выбирает хелпер по идентификатору.
 * @param {string} helperId
 * @returns {void}
 */
function selectHelper(helperId) {
  if (!getHelperById(helperId) || helperId === activeHelperId) {
    return;
  }

  activeHelperId = helperId;
  window.location.hash = helperId;
  renderWorkspace();
}

/**
 * Выделяет весь текст при первом клике в поле.
 * Повторный клик в уже активном поле ставит курсор как обычно.
 * @param {HTMLTextAreaElement} textarea
 * @returns {void}
 */
function bindSelectAllOnFocus(textarea) {
  let suppressMouseUp = false;

  textarea.addEventListener("focus", () => {
    suppressMouseUp = true;
    textarea.select();
  });

  textarea.addEventListener("mouseup", (event) => {
    if (!suppressMouseUp) {
      return;
    }

    suppressMouseUp = false;
    event.preventDefault();
    textarea.select();
  });
}

/**
 * Создаёт элемент поля формы.
 * @param {import("./helpers/types.js").HelperField} field
 * @param {string} currentValue
 * @returns {HTMLSelectElement | HTMLInputElement | HTMLTextAreaElement}
 */
function createFieldControl(field, currentValue) {
  if (field.type === "textarea") {
    const textarea = document.createElement("textarea");
    textarea.className = "field-control field-control-textarea";
    textarea.name = field.name;
    textarea.dataset.field = field.name;
    textarea.value = currentValue;
    textarea.placeholder = field.placeholder ?? "";
    textarea.rows = field.rows ?? 16;
    textarea.spellcheck = false;
    textarea.wrap = "off";

    if (field.selectAllOnFocus) {
      bindSelectAllOnFocus(textarea);
    }

    return textarea;
  }

  if (field.type === "number") {
    const input = document.createElement("input");
    input.type = "number";
    input.className = "field-control";
    input.name = field.name;
    input.dataset.field = field.name;
    input.min = String(field.min ?? 0);
    input.max = String(field.max ?? 120);
    input.value = currentValue;
    return input;
  }

  const select = document.createElement("select");
  select.className = "field-control";
  select.name = field.name;
  select.dataset.field = field.name;

  (field.options ?? []).forEach((option) => {
    const optionElement = document.createElement("option");
    optionElement.value = option.value;
    optionElement.textContent = option.label;
    select.append(optionElement);
  });

  const hasCurrentValue = (field.options ?? []).some((option) => option.value === currentValue);
  select.value = hasCurrentValue ? currentValue : (field.options?.[0]?.value ?? "");
  return select;
}

/**
 * Рисует поля настроек выбранного хелпера.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @param {Record<string, string>} [currentValues]
 * @returns {void}
 */
function renderFields(helper, currentValues = {}) {
  const values = { ...getFieldDefaults(helper), ...currentValues };
  fieldsElement.innerHTML = "";

  helper.fields.forEach((field) => {
    if (field.showWhen && values[field.showWhen.field] !== field.showWhen.value) {
      return;
    }

    const wrapper = document.createElement("label");
    wrapper.className = "field";
    wrapper.dataset.fieldName = field.name;

    const caption = document.createElement("span");
    caption.className = "field-label";
    caption.textContent = field.label;

    const currentValue = values[field.name] ?? field.defaultValue ?? "";
    wrapper.append(caption, createFieldControl(field, currentValue));
    fieldsElement.append(wrapper);
  });
}

/**
 * Слой подсветки для поля сравнения.
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLElement | null}
 */
function getComparerHighlight(textarea) {
  const highlight = textarea.closest(".comparer-pane")?.querySelector(".comparer-highlight");

  return highlight instanceof HTMLElement ? highlight : null;
}

/**
 * Соседнее поле сравнения.
 * @param {HTMLTextAreaElement} textarea
 * @returns {HTMLTextAreaElement | null}
 */
function getComparerPairField(textarea) {
  const otherName = textarea.name === "source" ? "compare" : "source";
  const other = fieldsElement.querySelector(`[data-field='${otherName}']`);

  return other instanceof HTMLTextAreaElement ? other : null;
}

/**
 * Синхронизирует прокрутку поля ввода и слоя подсветки.
 * @param {HTMLTextAreaElement} textarea
 * @param {HTMLElement} highlight
 * @returns {void}
 */
function syncComparerScroll(textarea, highlight) {
  highlight.scrollTop = textarea.scrollTop;
  highlight.scrollLeft = textarea.scrollLeft;
}

/**
 * Выравнивает прокрутку соседнего поля и его подсветки.
 * @param {HTMLTextAreaElement} textarea
 * @returns {void}
 */
function syncComparerPair(textarea) {
  const other = getComparerPairField(textarea);

  if (!other) {
    return;
  }

  const top = textarea.scrollTop;
  const left = textarea.scrollLeft;

  if (other.scrollTop !== top) {
    other.scrollTop = top;
  }

  if (other.scrollLeft !== left) {
    other.scrollLeft = left;
  }

  const otherHighlight = getComparerHighlight(other);

  if (otherHighlight) {
    syncComparerScroll(other, otherHighlight);
  }
}

/**
 * Обрабатывает прокрутку поля сравнения.
 * @param {HTMLTextAreaElement} textarea
 * @returns {void}
 */
function handleComparerScroll(textarea) {
  const highlight = getComparerHighlight(textarea);

  if (highlight) {
    syncComparerScroll(textarea, highlight);
  }

  syncComparerPair(textarea);
}

/**
 * Оборачивает поля сравнения слоем подсветки.
 * @returns {void}
 */
function wrapComparerPanes() {
  fieldsElement.querySelectorAll("textarea[data-field]").forEach((textarea) => {
    if (!(textarea instanceof HTMLTextAreaElement) || textarea.closest(".comparer-pane")) {
      return;
    }

    const pane = document.createElement("div");
    pane.className = "comparer-pane";

    const highlight = document.createElement("div");
    highlight.className = "comparer-highlight";
    highlight.setAttribute("aria-hidden", "true");
    highlight.dataset.highlightFor = textarea.name;

    textarea.parentNode?.insertBefore(pane, textarea);
    pane.append(highlight, textarea);
    textarea.addEventListener("scroll", () => {
      handleComparerScroll(textarea);
    });
  });
}

/**
 * Рисует подсветку и список отличий сравнителя.
 * @returns {void}
 */
function renderComparerResult() {
  const sourceField = fieldsElement.querySelector("[data-field='source']");
  const compareField = fieldsElement.querySelector("[data-field='compare']");
  const leftHighlight = fieldsElement.querySelector("[data-highlight-for='source']");
  const rightHighlight = fieldsElement.querySelector("[data-highlight-for='compare']");
  const left = sourceField instanceof HTMLTextAreaElement ? sourceField.value : "";
  const right = compareField instanceof HTMLTextAreaElement ? compareField.value : "";
  const comparison =
    typeof compareTexts === "function"
      ? compareTexts(left, right)
      : { lines: [], added: 0, removed: 0, changed: 0, homoglyphs: 0, equal: true, empty: true };

  if (leftHighlight instanceof HTMLElement && typeof renderComparePane === "function") {
    renderComparePane(leftHighlight, left, comparison, "left");

    if (sourceField instanceof HTMLTextAreaElement) {
      syncComparerScroll(sourceField, leftHighlight);
    }
  }

  if (rightHighlight instanceof HTMLElement && typeof renderComparePane === "function") {
    renderComparePane(rightHighlight, right, comparison, "right");

    if (compareField instanceof HTMLTextAreaElement) {
      syncComparerScroll(compareField, rightHighlight);
    }
  }

  resultsElement.innerHTML = "";

  if (typeof renderCompareDiff === "function") {
    renderCompareDiff(resultsElement, comparison);
    return;
  }

  const empty = document.createElement("p");
  empty.className = "results-empty formatter-empty";
  empty.textContent = "Вставьте тексты слева и справа — ниже появятся отличия.";
  resultsElement.append(empty);
}

/**
 * Рисует результат форматтера без копирования и истории.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @param {Record<string, string>} result
 * @returns {void}
 */
function renderFormatterResult(helper, result) {
  resultsElement.innerHTML = "";
  const value = result[helper.resultFields[0]?.key ?? "formatted"] ?? "";
  const errorMessage = result.error ?? "";
  const errorIndex = Number(result.errorIndex ?? "-1");
  const errorLength = Number(result.errorLength ?? "0");
  const errorLine = result.errorLine ?? "";
  const errorColumn = result.errorColumn ?? "";
  const sourceField = fieldsElement.querySelector("[data-field='source']");

  if (sourceField instanceof HTMLTextAreaElement) {
    sourceField.classList.toggle("field-control--invalid", Boolean(errorMessage));
    sourceField.setAttribute("aria-invalid", errorMessage ? "true" : "false");
  }

  if (!value && !errorMessage) {
    const empty = document.createElement("p");
    empty.className = "results-empty formatter-empty";
    empty.textContent = "Вставьте XML слева — справа появится форматирование.";
    resultsElement.append(empty);
    return;
  }

  if (errorMessage) {
    const banner = document.createElement("p");
    banner.className = "formatter-error";
    banner.setAttribute("role", "alert");
    banner.textContent =
      errorLine && errorColumn
        ? `Строка ${errorLine}, колонка ${errorColumn}: ${errorMessage}`
        : errorMessage;
    resultsElement.append(banner);
  }

  if (!value) {
    return;
  }

  const sourceValue = sourceField instanceof HTMLTextAreaElement ? sourceField.value : "";
  const displayValue = errorMessage && sourceValue ? sourceValue : value;
  /** @type {{ index: number, length: number, expected?: string } | null} */
  const errorRange =
    errorMessage && errorIndex >= 0
      ? {
          index: errorIndex,
          length: Number.isFinite(errorLength) ? errorLength : 0,
          expected: result.errorExpected ?? "",
        }
      : null;

  const output = document.createElement("pre");
  output.className = "formatter-output formatter-highlight";

  if (errorMessage) {
    output.classList.add("formatter-highlight--invalid");
  }

  const code = document.createElement("code");
  code.className = "formatter-highlight-code";

  if (typeof highlightXml === "function") {
    code.append(highlightXml(displayValue, errorRange));
  } else {
    code.textContent = displayValue;
  }

  output.append(code);
  resultsElement.append(output);

  if (errorRange) {
    window.requestAnimationFrame(() => {
      const mark = output.querySelector(".xh-error");

      if (mark instanceof HTMLElement) {
        mark.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    });
  }
}

/**
 * Рисует результаты генерации.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @param {Record<string, string>} result
 * @returns {void}
 */
function renderResults(helper, result) {
  if (helper.mode === "formatter") {
    renderFormatterResult(helper, result);
    return;
  }

  if (helper.mode === "comparer") {
    renderComparerResult();
    return;
  }

  resultsElement.innerHTML = "";

  helper.resultFields.forEach((field) => {
    const value = result[field.key] ?? "";
    const row = document.createElement("div");
    row.className = "result-row";

    const label = document.createElement("span");
    label.className = "result-label";
    label.textContent = field.label;

    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-button";
    copyButton.textContent = "Копировать";
    copyButton.addEventListener("click", () => {
      void handleCopy(value, copyButton, true);
    });

    const valueWrap = document.createElement("div");
    valueWrap.className = "result-value-wrap";

    const valueElement = document.createElement("code");
    valueElement.className = "result-value";
    valueElement.textContent = value;
    valueElement.title = "Копировать";
    valueElement.addEventListener("click", () => {
      void handleCopyFromValue(value, valueWrap);
    });

    valueWrap.append(valueElement);
    row.append(label, valueWrap, copyButton);
    resultsElement.append(row);
  });
}

/**
 * Запускает генерацию текущего хелпера.
 * @returns {void}
 */
function handleGenerate() {
  const helper = getHelperById(activeHelperId);

  if (!helper) {
    return;
  }

  try {
    const result = helper.generate(getFormValues());
    helperResults[helper.id] = result;
    currentResult = result;
    renderResults(helper, result);
  } catch (error) {
    currentResult = null;
    delete helperResults[helper.id];
    const message = error instanceof Error ? error.message : String(error);
    resultsElement.innerHTML = "";
    const row = document.createElement("div");
    row.className = "result-row";
    row.textContent = message;
    resultsElement.append(row);
  }
}

/**
 * Показывает сохранённый результат вкладки или пустое состояние.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @returns {void}
 */
function showHelperResult(helper) {
  const saved = helperResults[helper.id] ?? null;
  currentResult = saved;

  if (!saved) {
    resultsElement.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "results-empty";
    empty.textContent =
      helper.mode === "formatter"
        ? "Вставьте XML слева — справа появится форматирование."
        : helper.mode === "comparer"
          ? "Вставьте тексты слева и справа — ниже появятся отличия."
          : "Нажмите «Сгенерировать».";
    resultsElement.append(empty);
    return;
  }

  renderResults(helper, saved);
}

/**
 * Обновляет рабочую область выбранного хелпера.
 * @returns {void}
 */
function renderWorkspace() {
  const helper = getHelperById(activeHelperId);

  if (!helper) {
    return;
  }

  const isFormatter = helper.mode === "formatter";
  const isComparer = helper.mode === "comparer";
  const isLive = isFormatter || isComparer;

  titleElement.textContent = helper.title;
  descriptionElement.textContent = helper.description;
  resultsTitleElement.textContent = helper.resultsTitle ?? "Результат";
  generateButton.textContent = "Сгенерировать";
  generateButton.hidden = isLive;
  workspaceElement.classList.toggle("workspace-formatter", isFormatter);
  workspaceElement.classList.toggle("workspace-comparer", isComparer);
  appElement.classList.toggle("app-formatter", isFormatter);
  appElement.classList.toggle("app-comparer", isComparer);
  renderNav();
  renderFields(helper, helperFormState[activeHelperId] ?? getFieldDefaults(helper));

  if (isComparer) {
    wrapComparerPanes();
  }

  if (isLive) {
    handleGenerate();
    return;
  }

  showHelperResult(helper);
}

formElement.addEventListener("submit", (event) => {
  event.preventDefault();
  handleGenerate();
});

fieldsElement.addEventListener("input", () => {
  const helper = getHelperById(activeHelperId);

  if (!helper || (helper.mode !== "formatter" && helper.mode !== "comparer")) {
    return;
  }

  handleGenerate();
});

fieldsElement.addEventListener("change", (event) => {
  const helper = getHelperById(activeHelperId);

  if (!helper) {
    return;
  }

  const values = getFormValues();
  const target = event.target;
  const changedName =
    target instanceof HTMLSelectElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
      ? target.name
      : "";
  const shouldRenderFields = helper.fields.some(
    (field) => field.showWhen && field.showWhen.field === changedName,
  );

  if (shouldRenderFields) {
    renderFields(helper, values);
  }
});

navElement.addEventListener("click", (event) => {
  const target = event.target;

  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest("[data-helper-id]");

  if (!(button instanceof HTMLElement) || !button.dataset.helperId) {
    return;
  }

  selectHelper(button.dataset.helperId);
});

window.addEventListener("hashchange", () => {
  const helperId = window.location.hash.replace("#", "");

  if (getHelperById(helperId)) {
    selectHelper(helperId);
  }
});

const initialHelperId = window.location.hash.replace("#", "");
activeHelperId = getHelperById(initialHelperId) ? initialHelperId : helpers[0]?.id ?? "";
renderHistory();
renderWorkspace();

historyClearButton.addEventListener("click", () => {
  historyStore.clear();
  renderHistory();
});
