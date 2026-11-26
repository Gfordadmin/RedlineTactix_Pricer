import page from "./index.html";

export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/hello") {
			return Response.json({ message: "Redline Tactix Pricer, running on Cloudflare Workers." });
		}
		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(page, {
				headers: {
					"content-type": "text/html; charset=utf-8",
					"cache-control": "no-cache",
					"x-content-type-options": "nosniff",
				},
			});
		}
		return new Response("Not found", { status: 404 });
	},
};
