module.exports = function browserOptions() {
  const channel = process.env.CASA_BROWSER_CHANNEL;
  return Object.assign({ headless: true }, channel && channel !== 'chromium' ? { channel } : {});
};
