import { NextRequest, NextResponse } from "next/server";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:8000";
  const apiKey = process.env.SYNAPSE_API_KEY ?? process.env.APP_API_KEY;
  const allowServerApiKeyProxy = process.env.ALLOW_SERVER_API_KEY_PROXY === "true";
  const target = new URL(path.join("/"), apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  headers.set("Accept", "application/json");
  const contentType = request.headers.get("content-type");
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  const authorization = request.headers.get("authorization");
  if (authorization) {
    headers.set("Authorization", authorization);
  } else if (allowServerApiKeyProxy && apiKey) {
    headers.set("X-API-Key", apiKey);
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.text(),
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      {
        detail:
          "Backend do Synapse indisponivel. Inicie a task 'Dev: Backend FastAPI no VS Code' ou 'Dev: Stack completa no VS Code'.",
        target: target.toString(),
        error: error instanceof Error ? error.message : "fetch failed",
      },
      { status: 503 },
    );
  }

  const body = await response.arrayBuffer();
  const responseHeaders = new Headers();
  for (const header of ["content-type", "content-disposition", "content-length"]) {
    const value = response.headers.get(header);
    if (value) {
      responseHeaders.set(header, value);
    }
  }

  return new NextResponse(body, {
    status: response.status,
    headers: responseHeaders,
  });
}

export async function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
