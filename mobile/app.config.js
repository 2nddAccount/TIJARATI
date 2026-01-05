// Dynamic Expo config so EAS builds can inject environment-specific values.
// Keep app.json as the base, then extend it here.

const base = require('./app.json');

module.exports = ({ config }) => {
  const expo = (base && base.expo) ? base.expo : (config || {});

  const aiServerUrl = String(process.env.TIJARATI_AI_SERVER_URL || '').trim();

  return {
    ...expo,
    extra: {
      ...(expo.extra || {}),
      // Used by the bundled Web UI (index.html) via injection in mobile/App.js.
      // Example: https://your-tijarati-server.onrender.com
      aiServerUrl: aiServerUrl || (expo.extra && expo.extra.aiServerUrl) || '',
    },
  };
};
