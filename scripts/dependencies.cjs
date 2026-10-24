const path = require('node:path');

module.exports = function dependency(name) {
  try { return require(name); } catch (error) {
    if (process.env.CASA_NODE_MODULES) return require(path.join(process.env.CASA_NODE_MODULES, name));
    throw new Error(`Run npm ci to install ${name}, or point CASA_NODE_MODULES to a shared Node packages directory. Original error: ${error.message}`);
  }
};
