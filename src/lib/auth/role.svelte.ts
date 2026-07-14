/**
 * Reactive role store for RBAC in the frontend.
 *
 * Initialized from localStorage on app mount. Components use this to
 * show/hide UI based on the current user's role.
 */

import { getAuthRole } from "./token";

type Role = "viewer" | "editor" | "admin";

const LEVELS: Record<Role, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

class RoleStore {
  role = $state<Role>("viewer");

  init() {
    const stored = getAuthRole();
    if (stored === "viewer" || stored === "editor" || stored === "admin") {
      this.role = stored;
    }
  }

  get isAdmin() {
    return this.role === "admin";
  }

  get canEdit() {
    return LEVELS[this.role] >= LEVELS.editor;
  }

  /** Check if the current role meets the minimum requirement. */
  atLeast(min: Role) {
    return LEVELS[this.role] >= LEVELS[min];
  }
}

export const roleStore = new RoleStore();
