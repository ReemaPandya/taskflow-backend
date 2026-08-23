import { describe, expect, it } from 'vitest';
import { validateAssignmentTenant } from '../../src/modules/tasks/assignment.validation';
import { ApiError } from '../../src/lib/errors';

function capture(fn: () => void) {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe('task assignment validation', () => {
  it('allows a same-organization assignee', () => {
    expect(() => validateAssignmentTenant('org-a', 'org-a', 'org-a')).not.toThrow();
  });

  it('returns forbidden for a task owned by another tenant', () => {
    const error = capture(() => validateAssignmentTenant('org-a', 'org-b', 'org-a'));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(403);
    expect((error as ApiError).code).toBe('FORBIDDEN');
  });

  it('rejects an assignee who is not in the task organization', () => {
    const error = capture(() => validateAssignmentTenant('org-a', 'org-a', undefined));
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(400);
    expect((error as ApiError).code).toBe('INVALID_ASSIGNEE');
  });
});
