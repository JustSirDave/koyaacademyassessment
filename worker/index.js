/*
 * Worker entrypoint: the host calls fetch for each HTTP request.
 * Keep transport-level routing and unexpected-error handling here;
 * api.js contains booking rules, while page.js contains the browser UI.
 */
import { api, json } from "./api.js";
import { page } from "./page.js";
export default {
  async fetch(request, env) {
    /*
     * Serve the HTML page at the root URL. Visitors enter the assessment key
     * in the page; the HTML contains no embedded API secret. nosniff tells the
     * browser to respect the supplied content type.
     */
    if (new URL(request.url).pathname === "/" && request.method === "GET")
      return new Response(page, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        },
      });
    /*
     * Malformed JSON gets the required JSON error shape with HTTP 400.
     * Log unexpected failures server-side and return a generic 500 message so
     * internal exception details are not exposed to API callers.
     */
    try {
      return await api(request, env);
    } catch (e) {
      if (e instanceof SyntaxError) return json({ error: "invalid JSON" }, 400);
      console.error(e);
      return json({ error: "internal server error" }, 500);
    }
  },
};
