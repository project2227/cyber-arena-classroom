'use strict';

// Render terminates TLS/proxying before the Node process. Configure Express
// applications created by this process to trust the first proxy hop so
// express-rate-limit can safely use the forwarded client address.
const expressPath = require.resolve('express');
const originalExpress = require(expressPath);

function expressWithRenderProxy(...args) {
  const app = originalExpress(...args);
  app.set('trust proxy', 1);
  return app;
}

Object.assign(expressWithRenderProxy, originalExpress);
Object.setPrototypeOf(expressWithRenderProxy, originalExpress);
require.cache[expressPath].exports = expressWithRenderProxy;

require('./server');
