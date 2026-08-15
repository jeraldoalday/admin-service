import type { TeamMembership } from '../generated/prisma/client.js';
import type { TeamPermission, UserRole } from '../generated/prisma/enums.js';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        role: UserRole;
      };
      teamMembership?: TeamMembership;
      apiKey?: {
        id: string;
        teamId: string;
        permissions: TeamPermission[];
      };
    }
  }
}

export {};
