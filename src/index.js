export default {
	async fetch(request, env, ctx) {
		const url = new URL(request.url);
		if (url.pathname === "/api/hello") {
			return Response.json({ message: "Redline Tactix Pricer, running on Cloudflare Workers." });
		}
		return new Response(
			`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Redline Tactix Pricer</title></head>
<body style="font-family: system-ui, sans-serif; max-width: 640px; margin: 4rem auto; padding: 0 1rem;">
<h1>Redline Tactix Pricer</h1>
<p>Starter Cloudflare Worker. The pricing tool itself gets built here by Claude, in the cloud, from GitHub.</p>
<p><a href="/api/hello">/api/hello</a> returns a JSON greeting.</p>
</body></html>`,
			{ headers: { "content-type": "text/html; charset=utf-8" } }
		);
	},
};
