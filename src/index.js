import appHtml from "./app.html";
import engineJs from "./engine.client.js";
import appJs from "./app.client.js";

const JS = { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-cache" };

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		switch (url.pathname) {
			case "/api/hello":
				return Response.json({ message: "Redline Tactix Pricer, running on Cloudflare Workers." });
			case "/engine.js":
				return new Response(engineJs, { headers: JS });
			case "/app.js":
				return new Response(appJs, { headers: JS });
			case "/":
				return new Response(appHtml, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } });
			default:
				return new Response("Not found", { status: 404 });
		}
	},
};
