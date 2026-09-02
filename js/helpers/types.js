/**
 * @typedef {Object} HelperFieldOption
 * @property {string} value
 * @property {string} label
 */

/**
 * @typedef {Object} HelperFieldShowWhen
 * @property {string} field
 * @property {string} value
 */

/**
 * @typedef {Object} HelperField
 * @property {string} name
 * @property {"select" | "number" | "textarea"} type
 * @property {string} label
 * @property {HelperFieldOption[]} [options]
 * @property {string} [defaultValue]
 * @property {string} [placeholder]
 * @property {number} [rows]
 * @property {number} [min]
 * @property {number} [max]
 * @property {HelperFieldShowWhen} [showWhen]
 */

/**
 * @typedef {Object} HelperResultField
 * @property {string} key
 * @property {string} label
 */

/**
 * @typedef {Object} HelperDefinition
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {"generator" | "formatter"} [mode]
 * @property {string} [resultsTitle]
 * @property {HelperField[]} fields
 * @property {HelperResultField[]} resultFields
 * @property {(values: Record<string, string>) => Record<string, string>} generate
 */

export {};
