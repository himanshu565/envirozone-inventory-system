export type Role = "ADMIN" | "STORE_MANAGER" | "ACCOUNTS" | "VIEWER";

export type SessionPayload = {
  userId: number;
  email: string;
  role: Role;
};
