const helpers = globalThis.Helpers.helpers;
const getHelperById = globalThis.Helpers.getHelperById;
const historyStore = globalThis.Helpers.historyStore;

const navElement = document.querySelector("[data-nav]");
const titleElement = document.querySelector("[data-title]");
const descriptionElement = document.querySelector("[data-description]");
const fieldsElement = document.querySelector("[data-fields]");
const resultsElement = document.querySelector("[data-results]");
const formElement = document.querySelector("[data-form]");
const generateButton = document.querySelector("[data-generate]");
const historyElement = document.querySelector("[data-history]");
const historyClearButton = document.querySelector("[data-history-clear]");

if (
  !helpers ||
  !historyStore ||
  !navElement ||
  !formElement ||
  !fieldsElement ||
  !resultsElement ||
  !generateButton ||
  !historyElement ||
  !historyClearButton
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
    if (!(field instanceof HTMLSelectElement) && !(field instanceof HTMLInputElement)) {
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
 * Рисует навигацию по хелперам.
 * @returns {void}
 */
function renderNav() {
  navElement.innerHTML = "";

  helpers.forEach((helper) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "nav-item";
    button.dataset.helperId = helper.id;
    button.setAttribute("aria-current", helper.id === activeHelperId ? "page" : "false");
    button.textContent = helper.title;
    navElement.append(button);
  });
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
 * Создаёт элемент поля формы.
 * @param {import("./helpers/types.js").HelperField} field
 * @param {string} currentValue
 * @returns {HTMLSelectElement | HTMLInputElement}
 */
function createFieldControl(field, currentValue) {
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
 * Рисует результаты генерации.
 * @param {import("./helpers/types.js").HelperDefinition} helper
 * @param {Record<string, string>} result
 * @returns {void}
 */
function renderResults(helper, result) {
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
    empty.textContent = "Нажмите «Сгенерировать».";
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

  titleElement.textContent = helper.title;
  descriptionElement.textContent = helper.description;
  generateButton.textContent = "Сгенерировать";
  renderNav();
  renderFields(helper, helperFormState[activeHelperId] ?? getFieldDefaults(helper));
  showHelperResult(helper);
}

formElement.addEventListener("submit", (event) => {
  event.preventDefault();
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
    target instanceof HTMLSelectElement || target instanceof HTMLInputElement ? target.name : "";
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
