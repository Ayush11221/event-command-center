export interface AppConfig {
  port: number;
  frontendOrigin: string;
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
    origin.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(origin.hostname) ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== "" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.origin !== rawOrigin
  ) {
    throw new Error("FRONTEND_ORIGIN must be a local HTTP origin");
  }

  return { port, frontendOrigin: origin.origin };
}
