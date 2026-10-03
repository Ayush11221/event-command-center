export interface AppConfig {
  port: number;
  frontendOrigin: string;
  bindHost?: string;
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const rawPort = env.PORT;
  if (!rawPort || !/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const port = Number(rawPort);
  if (port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const rawOrigin = env.FRONTEND_ORIGIN;
  if (!rawOrigin) {
    throw new Error("FRONTEND_ORIGIN must be a local HTTP origin");
  }

  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    throw new Error("FRONTEND_ORIGIN must be a local HTTP origin");
  }

  if (
    (env.NODE_ENV === "production"
      ? origin.protocol !== "https:"
      : origin.protocol !== "http:" ||
        !["127.0.0.1", "localhost"].includes(origin.hostname)) ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.origin !== rawOrigin
  ) {
    throw new Error("FRONTEND_ORIGIN must be a local HTTP origin");
  }

  if (env.NODE_ENV === "production") {
    const bindHost = env.BIND_HOST ?? "127.0.0.1";
    if (!["127.0.0.1", "0.0.0.0"].includes(bindHost))
      throw new Error("Invalid BIND_HOST");
    return { port, frontendOrigin: origin.origin, bindHost };
  }
  return { port, frontendOrigin: origin.origin };
}
