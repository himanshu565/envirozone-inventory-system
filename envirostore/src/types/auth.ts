import type { Role } from "@prisma/client";

export type SessionPayload = {
  userId: number;
  email: string;
  role: Role;
};
