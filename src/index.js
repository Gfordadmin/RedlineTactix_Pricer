import page from "./index.html";
import engine from "./engine.client.js";

const html = { "content-type": "text/html; charset=utf-8" };

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/hello") {
			return Response.json({ message: "Redline Tactix Pricer, running on Cloudflare Workers." });
		}
		if (url.pathname === "/engine.js") {
			return new Response(engine, { headers: { "content-type": "text/javascript; charset=utf-8" } });
		}
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(page, { headers: html });
		}
		return new Response("Not found", { status: 404 });
	},
};
