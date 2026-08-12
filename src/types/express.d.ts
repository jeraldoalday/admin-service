import type { TeamMembership } from '../generated/prisma/client.js';
import type { UserRole } from '../generated/prisma/enums.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
      };
      teamMembership?: TeamMembership;
    }
  }
}

export {};
