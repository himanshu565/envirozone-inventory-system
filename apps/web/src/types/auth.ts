export type Role = "ADMIN" | "STORE_MANAGER" | "STAFF" | "VIEWER";

export type SessionPayload = {
  userId: number;
  email: string;
  role: Role;
};
