/**
 * Dev-server proxy: `npm --prefix web start` serves the UI on :4200, while the API and
 * the bot live in the Express process on :3000. Without this, every /api call 404s and
 * the connection banner never leaves "Desconectado".
 *
 * Not needed in production — `src/web/server.ts` serves the built bundle and the API
 * from the same origin on :3000.
 */
export default {
  '/api': {
    target: 'http://localhost:3000',
    // The API is plain HTTP on loopback; there is no certificate to verify.
    secure: false,
    changeOrigin: true,
    /**
     * /api/events is a Server-Sent Events stream (see ConnectionService). Buffering it
     * would hold the connection-status events until the response closed, i.e. never —
     * so the proxy must flush as it receives.
     */
    selfHandleResponse: false,
    buffer: false,
  },
};
