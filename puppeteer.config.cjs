const { join } = require('path');
/**
* @type {import("puppeteer").Configuration}
*/
if (process.env.RENDER === "true") {
    module.exports = {cacheDirectory: join(__dirname, '.cache', 'puppeteer')};
}