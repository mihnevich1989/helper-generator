/**
 * CLI-обёртка генератора паспорта.
 */

import "./js/utils.js";
import "./js/helpers/passport.js";

const generatePassport = globalThis.Helpers.generatePassport;
const calculateCheckDigit = globalThis.Helpers.calculateCheckDigit;

export { generatePassport, calculateCheckDigit };

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log(JSON.stringify(generatePassport(), null, 2));
}
