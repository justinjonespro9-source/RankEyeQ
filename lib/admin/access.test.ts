import { describe, expect, it } from "vitest";
import { ForbiddenError } from "@/lib/auth/errors";
import { assertAdminRole, canAccessAdmin } from "@/lib/admin/access";

describe("admin access", () => {
  it("allows only ADMIN role", () => {
    expect(canAccessAdmin("ADMIN")).toBe(true);
    expect(canAccessAdmin("USER")).toBe(false);
    expect(canAccessAdmin(null)).toBe(false);
    expect(canAccessAdmin(undefined)).toBe(false);
  });

  it("throws ForbiddenError for non-admin workflows", () => {
    expect(() => assertAdminRole("USER")).toThrow(ForbiddenError);
    expect(() => assertAdminRole("ADMIN")).not.toThrow();
  });
});
