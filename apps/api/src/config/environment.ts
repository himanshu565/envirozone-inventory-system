function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function validateEnvironment(): void {
  const databaseUrl = required("DATABASE_URL");
  required("JWT_SECRET");
  const webOrigin = required("WEB_ORIGIN");

  try {
    const database = new URL(databaseUrl);
    if (database.protocol !== "postgresql:" && database.protocol !== "postgres:") {
      throw new Error("DATABASE_URL must use a PostgreSQL URL");
    }
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  try {
    new URL(webOrigin);
  } catch {
    throw new Error("WEB_ORIGIN must be a valid URL");
  }

  if (process.env.NODE_ENV === "production" && webOrigin.startsWith("http://")) {
    throw new Error("WEB_ORIGIN must use HTTPS in production");
  }
}
