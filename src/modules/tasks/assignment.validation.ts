import { ApiError } from '../../lib/errors';

export function validateAssignmentTenant(expectedOrgId: string, taskOrgId: string, assigneeOrgId?: string) {
  if (taskOrgId !== expectedOrgId) {
    throw new ApiError(403, 'Forbidden', 'FORBIDDEN');
  }
  if (assigneeOrgId !== expectedOrgId) {
    throw new ApiError(400, 'Assigned user must belong to the same organization', 'INVALID_ASSIGNEE');
  }
}
