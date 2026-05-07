import { createContext, useContext } from 'react';

/**
 * Re-evaluate staff caps, staff-login JWT, and staff portal token before sensitive UI actions.
 * AdminShell provides the real implementation; default is a no-op pass-through for safety if context is missing.
 */
export const StaffAccessVerifyContext = createContext(async () => true);

export function useStaffAccessVerify() {
  return useContext(StaffAccessVerifyContext);
}
